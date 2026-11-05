"""環境変数の読み込み。秘密情報は .env（git 管理外）か環境変数でのみ渡す。"""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DATA_DIR = Path(os.getenv("DATA_DIR", BACKEND_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
PAPER_DIR = DATA_DIR / "papers"
for d in (UPLOAD_DIR, PAPER_DIR):
    d.mkdir(parents=True, exist_ok=True)

# 認証: Vertex AI（GOOGLE_CLOUD_PROJECT を設定）を優先し、なければ Gemini API キー。
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "global").strip()
GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()

# モデルはハッカソン期間中にも入れ替わるため環境変数で差し替え可能にする。
ANALYSIS_MODEL = os.getenv("ANALYSIS_MODEL", "gemini-3.6-flash")
QA_MODEL = os.getenv("QA_MODEL", "gemini-3.6-flash")

# 認証情報がなければデモモード（サンプル解析結果）で動く。DEMO_MODE=1 で強制。
DEMO_MODE = os.getenv("DEMO_MODE") == "1" or not (GOOGLE_CLOUD_PROJECT or GEMINI_API_KEY)

# PDF をリクエストに直接載せるため上限を設ける（大きいファイルは本番で Cloud Storage URI 渡しにする）。
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
MAX_PAGES = int(os.getenv("MAX_PAGES", "100"))
# 抽出する本文の文字数の合計の上限（通常の論文 100 ページで数十万字程度）
MAX_TOTAL_CHARS = int(os.getenv("MAX_TOTAL_CHARS", "1000000"))

# この秒数より長く更新のない queued / processing_* は、サーバーが途中で落ちたとみなして再実行を受け付ける。
STALE_AFTER_SEC = int(os.getenv("STALE_AFTER_SEC", "600"))

# /ask と /retry の論文ごとの回数制限（1分あたり）。/ask は毎回 PDF 全体を Gemini に送るので費用に直結する。
ASK_RATE_PER_MIN = int(os.getenv("ASK_RATE_PER_MIN", "10"))
RETRY_RATE_PER_MIN = int(os.getenv("RETRY_RATE_PER_MIN", "3"))
