"""PaperSummarizer for Students - ローカル API サーバー。

HTTP の入出力だけを扱い、解析と Q&A の組み立ては services.PaperService に任せる。

本番構成との対応:
  ローカルファイル保存      -> Cloud Storage（PDF）/ Firestore（状態・結果・会話）
  バックグラウンドスレッド   -> Cloud Tasks + Cloud Run Worker
  フロントのポーリング       -> Firestore のリアルタイムリスナー
"""

import hashlib
import logging
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse

from . import config, store
from .pdf_utils import TooManyPages, TooMuchText, extract_pages
from .schemas import AskRequest
from .services import AskFailed, PaperService

log = logging.getLogger("paper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="PaperSummarizer for Students")
app.state.service = PaperService()


def get_service(request: Request) -> PaperService:
    return request.app.state.service


Service = Annotated[PaperService, Depends(get_service)]


def _public(paper: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in paper.items() if k not in ("sha256",)}


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
    }


@app.get("/api/papers")
def list_papers() -> list[dict[str, Any]]:
    return store.list_papers()


# PDF の解析・ハッシュ計算・ファイル書き込みはすべて同期処理なので、普通の def にして
# FastAPI のスレッドプールで実行させる（async def だと処理中はほかのリクエストがすべて止まる）。
@app.post("/api/papers")
def upload(service: Service, file: UploadFile = File(...), level: str = Form("undergrad")) -> dict[str, Any]:
    if level not in ("undergrad", "grad"):
        raise HTTPException(400, "level は undergrad か grad を指定してください")
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

    paper_id, reused = service.create(
        data=data,
        pages=pages,
        filename=(file.filename or "paper.pdf")[:200],
        level=level,
        sha256=hashlib.sha256(data).hexdigest(),
    )
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
    _load_or_404(paper_id)
    if not service.retry_limiter.allow(paper_id):
        raise HTTPException(429, "再実行の回数が多すぎます。1分ほど待ってからもう一度お試しください。")
    if not service.retry(paper_id):
        raise HTTPException(409, "失敗した解析、または止まったままの解析のみ再実行できます")
    return {"ok": True}


@app.post("/api/papers/{paper_id}/ask")
def ask(paper_id: str, req: AskRequest, service: Service) -> dict[str, Any]:
    _load_or_404(paper_id)
    if not service.ask_limiter.allow(paper_id):
        raise HTTPException(429, "質問の回数が多すぎます。1分ほど待ってからもう一度質問してください。")
    try:
        messages = service.ask(paper_id, req.question, req.current_step)
    except AskFailed as e:
        raise HTTPException(502, e.message) from e
    return {"messages": messages}
