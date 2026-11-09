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
# 答える前に考える量。考えた分も出力トークンとして課金される。BERT（16ページ）で試すと、low は既定より
# 解析が約25%速く約30%安く、引用の照合の結果は落ちなかった。空にするとモデルの既定に任せる
THINKING_LEVELS = ("", "minimal", "low", "medium", "high")


def thinking_level(raw: str) -> str:
    """THINKING_LEVEL の値を小文字にそろえ、知らない値なら起動を止める。"""
    value = raw.strip().lower()
    if value not in THINKING_LEVELS:
        raise ValueError(f"THINKING_LEVEL は {', '.join(repr(v) for v in THINKING_LEVELS)} のどれかにしてください（{raw!r}）")
    return value


THINKING_LEVEL = thinking_level(os.getenv("THINKING_LEVEL", "low"))

# 認証情報がなければデモモード（サンプル解析結果）で動く。DEMO_MODE=1 で強制。
# 動いているコミット。deploy.sh が渡し、CD は文書だけの変更かをこの値と比べて決める
GIT_SHA = os.getenv("GIT_SHA", "")
# 解析結果の形の版。プロンプトやスキーマを変えて、新しい項目（例: Step 2 の流れ図）を出すようにしたら1つ上げる。
# 同じ PDF の使い回しは、この版で作られた結果に限る（古い結果を写すと、新しい機能が画面に出ないため）
ANALYSIS_VERSION = 8
DEMO_MODE = os.getenv("DEMO_MODE") == "1" or not (GOOGLE_CLOUD_PROJECT or GEMINI_API_KEY)

# PDF をリクエストに直接載せるため上限を設ける（大きいファイルは本番で Cloud Storage URI 渡しにする）。
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
MAX_PAGES = int(os.getenv("MAX_PAGES", "100"))
# 抽出する本文の文字数の合計の上限（通常の論文 100 ページで数十万字程度）
MAX_TOTAL_CHARS = int(os.getenv("MAX_TOTAL_CHARS", "1000000"))

# 解析中のスレッドが記録に heartbeat_at を書く間隔（秒）。Gemini の呼び出し中も書く
HEARTBEAT_SEC = float(os.getenv("HEARTBEAT_SEC", "10"))
# queued / processing_* の heartbeat（無ければ updated_at か created_at）がこの秒数より古いと、解析のスレッドが
# 消えた（Cloud Run のインスタンスの入れ替えなど）とみなし、論文の取得・一覧のときに別のプロセスが続きから引き継ぐ
TAKEOVER_AFTER_SEC = int(os.getenv("TAKEOVER_AFTER_SEC", "45"))
# 同じ解析を引き継ぐ回数の上限。超えたら failed にして、画面の「再実行」に任せる（引き継ぎの無限ループを防ぐ）
MAX_TAKEOVERS = int(os.getenv("MAX_TAKEOVERS", "3"))
# 引き継ぎが働かなかったときの保険。この秒数より長く更新（heartbeat を含む）のない queued / processing_* は、
# 手動の再実行（retry）を受け付ける。通常は TAKEOVER_AFTER_SEC の引き継ぎが先に働くので、この値には届かない
STALE_AFTER_SEC = int(os.getenv("STALE_AFTER_SEC", "600"))

# /ask と /retry の論文ごとの回数制限（1分あたり）。/ask は毎回 PDF 全体を Gemini に送るので費用に直結する。
ASK_RATE_PER_MIN = int(os.getenv("ASK_RATE_PER_MIN", "10"))
RETRY_RATE_PER_MIN = int(os.getenv("RETRY_RATE_PER_MIN", "3"))
QUIZ_RATE_PER_MIN = int(os.getenv("QUIZ_RATE_PER_MIN", "3"))
CHECK_RATE_PER_MIN = int(os.getenv("CHECK_RATE_PER_MIN", "3"))

# サービス全体の上限（認証がないので、論文ごとの制限だけでは論文を増やして回避できる）。
# 1日の上限は直近24時間の回数で数え、QUOTA_DIR に残す。0 にするとその操作を止められる（緊急停止）。
QUOTA_DIR = DATA_DIR / "quota"
QUOTA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOADS_PER_DAY = int(os.getenv("MAX_UPLOADS_PER_DAY", "100"))
MAX_ANALYSES_PER_DAY = int(os.getenv("MAX_ANALYSES_PER_DAY", "30"))  # 解析と再解析（Gemini を3回呼ぶ）
MAX_ASKS_PER_DAY = int(os.getenv("MAX_ASKS_PER_DAY", "150"))  # 質問（毎回 PDF 全体を送る）
MAX_QUIZZES_PER_DAY = int(os.getenv("MAX_QUIZZES_PER_DAY", "20"))  # 誤り探しの問題の作成（Gemini を1〜2回呼ぶ）
# 確認モードの問題の作成（Gemini を1回呼ぶが、毎回 PDF 全体を送るので質問と同じ重さ）。誤り探しの上限とは共有しない:
# 共有すると、片方を使い切っただけでもう片方も止まる。費用の大きさも違う（誤り探しは本文の抜粋だけを送る）ので別に数える
MAX_CHECKS_PER_DAY = int(os.getenv("MAX_CHECKS_PER_DAY", "30"))
ASK_GLOBAL_PER_MIN = int(os.getenv("ASK_GLOBAL_PER_MIN", "20"))
# 同時に受け付けるアップロード（PDF をメモリに読むので、1GiB のインスタンスが溢れないようにする）
MAX_CONCURRENT_UPLOADS = int(os.getenv("MAX_CONCURRENT_UPLOADS", "3"))

# 解析の進捗を送る SSE（GET /api/papers/{id}/events）。接続は Cloud Run のインスタンスのスレッドと接続数を使うので上限を設ける
SSE_MAX_CONNECTIONS = int(os.getenv("SSE_MAX_CONNECTIONS", "20"))  # 同時接続の上限。超えたら 429 を返し、画面は問い合わせに戻る
# 1本の接続の最長時間。過ぎたらサーバーが閉じ、画面が再接続する。Firebase Hosting の rewrite には約60秒の上限があると考えられるので、それより短くする
SSE_MAX_SEC = float(os.getenv("SSE_MAX_SEC", "50"))
SSE_TICK_SEC = float(os.getenv("SSE_TICK_SEC", "1"))  # 進捗が変わったかを見る間隔（送るのは最大でこの間隔に1回）
SSE_RECORD_SEC = float(os.getenv("SSE_RECORD_SEC", "3"))  # 記録の status と progress を読み直す間隔（別のサーバーの解析や引き継ぎの判定）
SSE_PING_SEC = float(os.getenv("SSE_PING_SEC", "5"))  # 何も送らない間に出すコメント行（: ping）の間隔。途中の機器に切られないため
