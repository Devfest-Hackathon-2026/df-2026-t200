"""PaperSummarizer for Students - ローカル API サーバー。

HTTP の入出力だけを扱い、解析と Q&A の組み立ては services.PaperService に任せる。

本番構成との対応:
  ローカルファイル保存      -> Cloud Storage（PDF）/ Firestore（状態・結果・会話）
  バックグラウンドスレッド   -> Cloud Tasks + Cloud Run Worker
  フロントのポーリング       -> Firestore のリアルタイムリスナー
"""

import hashlib
import logging
import threading
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse

from . import config, store
from .pdf_utils import TooManyPages, TooMuchText, extract_pages
from .schemas import AskRequest
from .services import AskFailed, PaperNotFound, PaperService, QuotaExceeded, retryable

log = logging.getLogger("paper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="PaperSummarizer for Students")
app.state.service = PaperService()


def get_service(request: Request) -> PaperService:
    return request.app.state.service


Service = Annotated[PaperService, Depends(get_service)]
# ブラウザごとのランダムな ID（localStorage）。論文の一覧を、そのブラウザでアップロードしたものに絞るのに使う
ClientId = Annotated[str | None, Header(alias="X-Client-Id")]

# 同時に処理するアップロード。PDF をメモリに読むので、超えたら待たせずに 503 を返す
_upload_slots = threading.BoundedSemaphore(config.MAX_CONCURRENT_UPLOADS)

QUOTA_MESSAGE = "本日の利用上限に達しました。時間をおいてからもう一度お試しください。"


def _public(paper: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in paper.items() if k not in ("sha256", "owner")}


def _load_or_404(paper_id: str) -> dict[str, Any]:
    if not store.valid_id(paper_id):
        raise HTTPException(404, "論文が見つかりません")
    paper = store.load(paper_id)
    if paper is None:
        raise HTTPException(404, "論文が見つかりません")
    return paper


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "demo_mode": config.DEMO_MODE,
        "backend": "vertex" if config.GOOGLE_CLOUD_PROJECT else ("gemini-api" if config.GEMINI_API_KEY else "demo"),
        "analysis_model": config.ANALYSIS_MODEL,
        "qa_model": config.QA_MODEL,
        "max_upload_mb": config.MAX_UPLOAD_MB,
        "version": config.GIT_SHA,
    }


@app.get("/api/papers")
def list_papers(response: Response, client_id: ClientId = None) -> list[dict[str, Any]]:
    # ブラウザごとに中身が違うので、Firebase Hosting の CDN やブラウザにキャッシュさせない
    response.headers["Cache-Control"] = "private, no-store"
    return store.list_papers(store.owner_of(client_id))


# PDF の解析・ハッシュ計算・ファイル書き込みはすべて同期処理なので、普通の def にして
# FastAPI のスレッドプールで実行させる（async def だと処理中はほかのリクエストがすべて止まる）。
@app.post("/api/papers")
def upload(
    service: Service, file: UploadFile = File(...), level: str = Form("undergrad"), lang: str = Form("ja"), client_id: ClientId = None
) -> dict[str, Any]:
    if level not in ("undergrad", "grad"):
        raise HTTPException(400, "level は undergrad か grad を指定してください")
    if lang not in ("ja", "en"):
        raise HTTPException(400, "lang は ja か en を指定してください")
    if not _upload_slots.acquire(blocking=False):
        raise HTTPException(503, "アップロードが混み合っています。少し待ってからもう一度お試しください。")
    try:
        if not service.upload_quota.take():
            raise HTTPException(429, QUOTA_MESSAGE)
        return _process_upload(service, file, level, lang, store.owner_of(client_id))
    finally:
        _upload_slots.release()


def _process_upload(service: PaperService, file: UploadFile, level: str, lang: str, owner: str | None) -> dict[str, Any]:
    data = file.file.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"ファイルサイズの上限は {config.MAX_UPLOAD_MB}MB です")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "PDF ファイルをアップロードしてください")
    try:
        pages = extract_pages(data, max_pages=config.MAX_PAGES, max_chars=config.MAX_TOTAL_CHARS)
    except TooManyPages as e:
        raise HTTPException(413, f"ページ数の上限は {config.MAX_PAGES} ページです（このPDFは {e.count} ページ）") from e
    except TooMuchText as e:
        raise HTTPException(413, "PDF のテキスト量が多すぎます。論文本体だけの PDF にしてください") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "PDF を読み込めませんでした（破損または暗号化されている可能性があります）") from e
    if sum(len(p.strip()) for p in pages) < 200:
        raise HTTPException(400, "テキストを含む PDF のみ対応しています（スキャン画像のみの PDF は未対応）")

    try:
        paper_id, reused = service.create(
            data=data,
            pages=pages,
            filename=(file.filename or "paper.pdf")[:200],
            level=level,
            lang=lang,
            sha256=hashlib.sha256(data).hexdigest(),
            owner=owner,
        )
    except QuotaExceeded as e:
        raise HTTPException(429, QUOTA_MESSAGE) from e
    return {"id": paper_id, "reused": reused}


@app.get("/api/papers/{paper_id}")
def get_paper(paper_id: str) -> dict[str, Any]:
    return _public(_load_or_404(paper_id))


@app.get("/api/papers/{paper_id}/pdf", response_model=None)
def get_pdf(paper_id: str) -> FileResponse | RedirectResponse:
    _load_or_404(paper_id)
    url = store.pdf_url(paper_id)
    if url:  # Cloud Storage では署名付き URL へ転送する
        return RedirectResponse(url)
    return FileResponse(store.pdf_path(paper_id), media_type="application/pdf")


@app.post("/api/papers/{paper_id}/retry")
def retry(paper_id: str, service: Service) -> dict[str, Any]:
    # 再実行できない状態で断る分（409）は、1分あたりの回数に数えない
    if not retryable(_load_or_404(paper_id)):
        raise HTTPException(409, "失敗した解析、または止まったままの解析のみ再実行できます")
    if not service.retry_limiter.allow(paper_id):
        raise HTTPException(429, "再実行の回数が多すぎます。1分ほど待ってからもう一度お試しください。")
    try:
        retried = service.retry(paper_id)
    except QuotaExceeded as e:
        raise HTTPException(429, QUOTA_MESSAGE) from e
    if not retried:
        raise HTTPException(409, "失敗した解析、または止まったままの解析のみ再実行できます")
    return {"ok": True}


@app.post("/api/papers/{paper_id}/ask")
def ask(paper_id: str, req: AskRequest, service: Service) -> dict[str, Any]:
    _load_or_404(paper_id)
    if not service.ask_limiter.allow(paper_id) or not service.ask_global_limiter.allow("all"):
        raise HTTPException(429, "質問の回数が多すぎます。1分ほど待ってからもう一度質問してください。")
    if not service.ask_quota.take():
        raise HTTPException(429, QUOTA_MESSAGE)
    try:
        messages = service.ask(paper_id, req.question, req.current_step)
    except PaperNotFound as e:
        raise HTTPException(404, "論文が見つかりません") from e
    except AskFailed as e:
        raise HTTPException(502, e.message) from e
    return {"messages": messages}
