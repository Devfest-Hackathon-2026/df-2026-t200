"""PaperSummarizer for Students - ローカル API サーバー。

本番構成との対応:
  ローカルファイル保存      -> Cloud Storage（PDF）/ Firestore（状態・結果・会話）
  バックグラウンドスレッド   -> Cloud Tasks + Cloud Run Worker
  フロントのポーリング       -> Firestore のリアルタイムリスナー
"""

import hashlib
import logging
import threading
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import config, errors, mock, store
from .pdf_utils import TooManyPages, TooMuchText, extract_pages, normalize, verify_all
from .schemas import AskRequest

log = logging.getLogger("paper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="PaperSummarizer for Students")

# 同時に走る解析ジョブ数を制限（Cloud Tasks の同時実行数制限に相当。API のレート制限対策）
_job_slots = threading.BoundedSemaphore(2)


def _public(paper: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in paper.items() if k not in ("sha256",)}


def _load_or_404(paper_id: str) -> dict[str, Any]:
    if not store.valid_id(paper_id):
        raise HTTPException(404, "論文が見つかりません")
    paper = store.load(paper_id)
    if paper is None:
        raise HTTPException(404, "論文が見つかりません")
    return paper


def _gemini():
    from . import gemini  # 認証情報がないデモモードでは読み込まない

    return gemini


def _error_message(e: Exception) -> str:
    # 画面と API には決まった文言だけを返す。詳細は呼び出し側で log.exception（paper_id 付き）に残す。
    return errors.user_message(e)


def _run_analysis(paper_id: str) -> None:
    """Step 1 → 2 → 3 を順に生成し、終わったものから保存する（画面は届いた順に表示）。"""
    with _job_slots:
        try:
            paper = store.load(paper_id)
            if paper is None:
                log.warning("analysis skipped: paper=%s not found", paper_id)
                return
            pdf_bytes = store.pdf_path(paper_id).read_bytes()
            pages = extract_pages(pdf_bytes)
            norm_pages = [normalize(p) for p in pages]
            level = paper["level"]
            results: dict[str, Any] = dict(paper.get("results", {}))
            for step in (1, 2, 3):
                key = f"step{step}"
                if results.get(key):
                    continue
                store.update(paper_id, status=f"processing_{key}")
                log.info("paper=%s %s start (demo=%s)", paper_id, key, config.DEMO_MODE)
                if config.DEMO_MODE:
                    out = {1: lambda: mock.step1(pages, paper["filename"]), 2: lambda: mock.step2(pages), 3: lambda: mock.step3(pages)}[step]()
                else:
                    g = _gemini()
                    if step == 1:
                        out = g.step1(pdf_bytes, level)
                    elif step == 2:
                        out = g.step2(pdf_bytes, level, results["step1"])
                    else:
                        out = g.step3(pdf_bytes, level, results["step1"])
                results[key] = verify_all(out, norm_pages)
                store.set_result(paper_id, key, results[key])
                log.info("paper=%s %s done", paper_id, key)
            store.update(paper_id, status="done", error=None)
        except Exception as e:  # noqa: BLE001
            log.exception("analysis failed paper=%s", paper_id)
            try:
                store.update(paper_id, status="failed", error=_error_message(e))
            except KeyError:
                log.warning("paper=%s disappeared during analysis", paper_id)


def _is_stale(paper: dict[str, Any]) -> bool:
    stamp = paper.get("updated_at") or paper.get("created_at")
    try:
        last = datetime.fromisoformat(stamp)
    except (TypeError, ValueError):
        return True
    return (datetime.now(UTC) - last).total_seconds() > config.STALE_AFTER_SEC


def _retryable(paper: dict[str, Any]) -> bool:
    """失敗した解析と、サーバー停止などで止まったままの解析（一定時間更新なし）を再実行できる。"""
    status = paper.get("status", "")
    if status == "failed":
        return True
    return (status == "queued" or status.startswith("processing_")) and _is_stale(paper)


def _start(paper_id: str) -> None:
    threading.Thread(target=_run_analysis, args=(paper_id,), daemon=True).start()


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
def upload(file: UploadFile = File(...), level: str = Form("undergrad")) -> dict[str, Any]:
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

    sha256 = hashlib.sha256(data).hexdigest()
    existing = store.find_by_hash(sha256, level)
    if existing:  # 同じ PDF は再解析せず結果を再利用（コスト削減）
        return {"id": existing, "reused": True}

    paper_id = store.new_id()
    store.save_pdf(paper_id, data)
    store.save(
        {
            "id": paper_id,
            "filename": (file.filename or "paper.pdf")[:200],
            "sha256": sha256,
            "level": level,
            "page_count": len(pages),
            "status": "queued",
            "error": None,
            "demo": config.DEMO_MODE,
            "results": {},
            "messages": [],
            "created_at": store.now(),
        }
    )
    _start(paper_id)
    return {"id": paper_id, "reused": False}


@app.get("/api/papers/{paper_id}")
def get_paper(paper_id: str) -> dict[str, Any]:
    return _public(_load_or_404(paper_id))


@app.get("/api/papers/{paper_id}/pdf")
def get_pdf(paper_id: str) -> FileResponse:
    _load_or_404(paper_id)
    return FileResponse(store.pdf_path(paper_id), media_type="application/pdf")


@app.post("/api/papers/{paper_id}/retry")
def retry(paper_id: str) -> dict[str, Any]:
    _load_or_404(paper_id)
    # 状態の確認と queued への変更を1回の操作で行い、二度押しで解析が2本走らないようにする
    if store.transition(paper_id, _retryable, status="queued", error=None) is None:
        raise HTTPException(409, "失敗した解析、または止まったままの解析のみ再実行できます")
    _start(paper_id)
    return {"ok": True}


@app.post("/api/papers/{paper_id}/ask")
def ask(paper_id: str, req: AskRequest) -> dict[str, Any]:
    paper = _load_or_404(paper_id)
    pdf_bytes = store.pdf_path(paper_id).read_bytes()
    pages = extract_pages(pdf_bytes)
    try:
        if config.DEMO_MODE:
            out = mock.ask(pages, req.question)
        else:
            out = _gemini().ask(pdf_bytes, paper["level"], req.question, paper.get("messages", []), req.current_step)
    except Exception as e:  # noqa: BLE001
        log.exception("ask failed paper=%s", paper_id)
        raise HTTPException(502, _error_message(e)) from e
    out = verify_all(out, [normalize(p) for p in pages])
    paper = store.append_messages(
        paper_id,
        {"role": "user", "text": req.question, "created_at": store.now()},
        {"role": "assistant", "text": out["answer"], **{k: out[k] for k in ("source", "evidence", "confidence")}, "created_at": store.now()},
    )
    return {"messages": paper["messages"]}
