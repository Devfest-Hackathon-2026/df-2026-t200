"""利用者に見せるエラー文言。例外の詳細（プロジェクトID・モデル名・クォータなど）は画面に出さず、サーバーのログにだけ残す。"""

AUTH = "Gemini の認証に失敗しました。サーバーの認証設定（GEMINI_API_KEY または Vertex AI）を確認してください。"
RATE_LIMIT = "Gemini のレート制限に達しました。少し時間をおいて再実行してください。"
MODEL_NOT_FOUND = "指定したモデルが見つかりません。サーバーのモデル設定（ANALYSIS_MODEL / QA_MODEL）を確認してください。"
UNAVAILABLE = "Gemini が混み合っているか一時的に使えません。少し時間をおいて再実行してください。"
BAD_RESPONSE = "Gemini から有効な応答が得られませんでした。もう一度お試しください。"
TAKEN_OVER_TOO_MANY = "解析が何度も中断されました。時間をおいて再実行してください。"
TAKEN_OVER_TOO_MANY = "解析が何度も中断されました。時間をおいて再実行してください。"
GENERIC = "解析中にエラーが発生しました。時間をおいて再実行してください。"


class EmptyResponseError(RuntimeError):
    """Gemini の応答本文が空だった（安全フィルタや出力上限で止まった場合など）。"""


def _status_code(e: Exception) -> int | None:
    try:
        from google.genai import errors as genai_errors
    except ImportError:  # pragma: no cover - 依存に含まれているので通常は起きない
        return None
    if isinstance(e, genai_errors.APIError) and isinstance(e.code, int):
        return e.code
    return None


def user_message(e: Exception) -> str:
    """例外の型とステータスコードで分類し、決まった文言だけを返す（例外の文字列は使わない）。"""
    from pydantic import ValidationError

    code = _status_code(e)
    if code in (401, 403):
        return AUTH
    if code == 429:
        return RATE_LIMIT
    if code == 404:
        return MODEL_NOT_FOUND
    if code is not None and code >= 500:
        return UNAVAILABLE
    if isinstance(e, EmptyResponseError | ValidationError):
        return BAD_RESPONSE
    return GENERIC


class QuotaExceeded(Exception):
    """サービス全体の1日の上限に達した。"""


class PaperNotFound(Exception):
    """処理の途中で論文の記録が消えた。"""


class RateLimited(Exception):
    """論文ごとの1分あたりの回数制限に達した。"""
