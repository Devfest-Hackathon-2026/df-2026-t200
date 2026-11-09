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
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from starlette.background import BackgroundTask

from . import config, events, store
from .check_service import (
    CheckAlreadyAnswered,
    CheckBadAnswer,
    CheckBadConcepts,
    CheckBusy,
    CheckFailed,
    CheckNotAnswered,
    CheckNotFound,
    CheckNotReady,
)
from .pdf_utils import TooManyPages, TooMuchText, extract_pages
from .schemas import AskRequest, CheckAnswerRequest, CheckCreateRequest, QuizAnswerRequest, QuizCreateRequest
from .services import (
    AskFailed,
    PaperNotFound,
    PaperService,
    QuizAlreadyAnswered,
    QuizBadAnswer,
    QuizBusy,
    QuizFailed,
    QuizNotAnswered,
    QuizNotFound,
    QuizNotReady,
    QuizTooSmall,
    QuotaExceeded,
    RateLimited,
    retryable,
    running,
)

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
    return {k: v for k, v in paper.items() if k not in ("sha256", "owner", "quiz", "check")}  # quiz と check は答えを含むので、専用の API だけが返す


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
def list_papers(response: Response, service: Service, client_id: ClientId = None) -> list[dict[str, Any]]:
    # ブラウザごとに中身が違うので、Firebase Hosting の CDN やブラウザにキャッシュさせない
    response.headers["Cache-Control"] = "private, no-store"
    items = store.list_papers(store.owner_of(client_id))
    # 止まった解析があれば引き継ぐ（引き継いだ論文は、更新後の状態を返す）
    return [{**i, "status": taken["status"]} if running(i) and (taken := service.take_over(i["id"])) else i for i in items]


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
def get_paper(paper_id: str, service: Service) -> dict[str, Any]:
    paper = _load_or_404(paper_id)
    if running(paper):  # 止まった解析なら、ここで引き継いで続きから走らせる
        paper = service.take_over(paper_id) or store.load(paper_id) or paper
    # progress は、このプロセスで走っていればその詳細、無ければ記録の要約（解析中だけ）
    return {**_public(paper), "progress": service.progress_of(paper)}


@app.get("/api/papers/{paper_id}/events")
def paper_events(paper_id: str, service: Service) -> StreamingResponse:
    """解析の進捗を Server-Sent Events で送る。完了・失敗・中止で最後の1回を送って閉じる。接続の上限を超えたら 429（画面は問い合わせに戻る）。"""
    _load_or_404(paper_id)
    if not events.slots.acquire():
        raise HTTPException(429, "進捗の接続が混み合っています。問い合わせで更新します。")
    release = events.slots.releaser()
    # 本体が一度も始まらないまま閉じられた場合に備えて、background でも枠を返す（二重には返さない）
    return StreamingResponse(
        events.event_stream(service, paper_id, release),
        media_type="text/event-stream",
        headers=events.HEADERS,
        background=BackgroundTask(release),
    )


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
        raise HTTPException(409, "失敗した解析・中止した解析、または止まったままの解析のみ再実行できます")
    if not service.retry_limiter.allow(paper_id):
        raise HTTPException(429, "再実行の回数が多すぎます。1分ほど待ってからもう一度お試しください。")
    try:
        retried = service.retry(paper_id)
    except QuotaExceeded as e:
        raise HTTPException(429, QUOTA_MESSAGE) from e
    if not retried:
        raise HTTPException(409, "失敗した解析・中止した解析、または止まったままの解析のみ再実行できます")
    return {"ok": True}


@app.post("/api/papers/{paper_id}/cancel")
def cancel(paper_id: str, service: Service) -> dict[str, Any]:
    """実行中の解析を中止する。終わった Step の結果は残り、「解析をやり直す」で続きから再開できる。"""
    _load_or_404(paper_id)
    try:
        cancelled = service.cancel(paper_id)
    except KeyError as e:
        raise HTTPException(404, "論文が見つかりません") from e
    if not cancelled:
        raise HTTPException(409, "解析中の論文だけを中止できます")
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


@app.get("/api/papers/{paper_id}/quiz")
def get_quiz(paper_id: str, service: Service) -> dict[str, Any]:
    _load_or_404(paper_id)
    try:
        return {"quiz": service.get_quiz(paper_id)}
    except PaperNotFound as e:
        raise HTTPException(404, "論文が見つかりません") from e


@app.post("/api/papers/{paper_id}/quiz")
def create_quiz(paper_id: str, service: Service, req: QuizCreateRequest | None = None) -> dict[str, Any]:
    _load_or_404(paper_id)
    try:
        return {"quiz": service.create_quiz(paper_id, force=bool(req and req.force))}
    except PaperNotFound as e:
        raise HTTPException(404, "論文が見つかりません") from e
    except QuizNotReady as e:
        raise HTTPException(409, "解析が終わってから誤り探しを始められます") from e
    except QuizTooSmall as e:
        raise HTTPException(409, "根拠を確認できた項目が少ないため、この論文では誤り探しの問題を作れません") from e
    except QuizNotAnswered as e:
        raise HTTPException(409, "先に答え合わせをしてください") from e
    except QuizBusy as e:
        raise HTTPException(409, "問題を作っています。少し待ってからもう一度お試しください") from e
    except RateLimited as e:
        raise HTTPException(429, "問題を作る回数が多すぎます。1分ほど待ってからもう一度お試しください。") from e
    except QuotaExceeded as e:
        raise HTTPException(429, QUOTA_MESSAGE) from e
    except QuizFailed as e:
        raise HTTPException(502, e.message) from e


@app.post("/api/papers/{paper_id}/quiz/{quiz_id}/answer")
def answer_quiz(paper_id: str, quiz_id: str, req: QuizAnswerRequest, service: Service) -> dict[str, Any]:
    _load_or_404(paper_id)
    try:
        return {"quiz": service.answer_quiz(paper_id, quiz_id, req.picks)}
    except PaperNotFound as e:
        raise HTTPException(404, "論文が見つかりません") from e
    except QuizNotFound as e:
        raise HTTPException(404, "この問題は見つかりません。新しい問題に置き換わった可能性があります") from e
    except QuizAlreadyAnswered as e:
        raise HTTPException(409, "この問題にはすでに回答しています") from e
    except QuizBadAnswer as e:
        raise HTTPException(400, "回答の内容が正しくありません") from e


@app.get("/api/papers/{paper_id}/check")
def get_check(paper_id: str, service: Service) -> dict[str, Any]:
    _load_or_404(paper_id)
    try:
        return {"check": service.check.get(paper_id)}
    except PaperNotFound as e:
        raise HTTPException(404, "論文が見つかりません") from e


@app.post("/api/papers/{paper_id}/check")
def create_check(paper_id: str, req: CheckCreateRequest, service: Service) -> dict[str, Any]:
    _load_or_404(paper_id)
    try:
        return {"check": service.check.create(paper_id, req.concept_ids, force=req.force)}
    except PaperNotFound as e:
        raise HTTPException(404, "論文が見つかりません") from e
    except CheckNotReady as e:
        raise HTTPException(409, "前提知識マップができてから確認問題を作れます") from e
    except CheckBadConcepts as e:
        raise HTTPException(400, "問題にする概念の指定が正しくありません") from e
    except CheckNotAnswered as e:
        raise HTTPException(409, "先に答え合わせをしてください") from e
    except CheckBusy as e:
        raise HTTPException(409, "問題を作っています。少し待ってからもう一度お試しください") from e
    except RateLimited as e:
        raise HTTPException(429, "問題を作る回数が多すぎます。1分ほど待ってからもう一度お試しください。") from e
    except QuotaExceeded as e:
        raise HTTPException(429, QUOTA_MESSAGE) from e
    except CheckFailed as e:
        raise HTTPException(502, e.message) from e


@app.post("/api/papers/{paper_id}/check/{check_id}/answer")
def answer_check(paper_id: str, check_id: str, req: CheckAnswerRequest, service: Service) -> dict[str, Any]:
    _load_or_404(paper_id)
    try:
        return {"check": service.check.answer(paper_id, check_id, req.answers)}
    except PaperNotFound as e:
        raise HTTPException(404, "論文が見つかりません") from e
    except CheckNotFound as e:
        raise HTTPException(404, "この問題は見つかりません。新しい問題に置き換わった可能性があります") from e
    except CheckAlreadyAnswered as e:
        raise HTTPException(409, "この問題にはすでに回答しています") from e
    except CheckBadAnswer as e:
        raise HTTPException(400, "回答の内容が正しくありません") from e
