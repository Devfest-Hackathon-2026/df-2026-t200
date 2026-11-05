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
