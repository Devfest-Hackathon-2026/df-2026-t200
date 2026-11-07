# Cloud Run 用のバックエンドのイメージ。deploy.sh が `gcloud run deploy --source backend` で Cloud Build に渡す。
FROM python:3.12-slim

# uv の版はローカルで uv.lock を作った版に合わせる
COPY --from=ghcr.io/astral-sh/uv:0.8.11 /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# 依存だけ先に入れて、コードの変更でキャッシュが無効にならないようにする
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

COPY app ./app

# 本番では Cloud Storage のバケットを /data にマウントする（deploy.sh）。マウントしなければコンテナ内に保存される
ENV PATH="/app/.venv/bin:$PATH" \
    DATA_DIR=/data

# Cloud Run は待ち受けるポートを PORT で渡す
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
