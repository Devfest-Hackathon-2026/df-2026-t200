#!/usr/bin/env bash
# バックエンド（:8000）とフロントエンド（:5173）をまとめて起動する。Ctrl+C で両方停止。
set -euo pipefail
cd "$(dirname "$0")"

command -v uv >/dev/null || { echo "uv が必要です: https://docs.astral.sh/uv/"; exit 1; }
command -v npm >/dev/null || { echo "Node.js (npm) が必要です"; exit 1; }

[ -f backend/.env ] || { cp backend/.env.example backend/.env; echo "backend/.env を作成しました（キー未設定のためデモモードで起動します）"; }
(cd backend && uv sync -q)
[ -d frontend/node_modules ] || (cd frontend && npm install)

trap 'kill 0' EXIT
(cd backend && uv run uvicorn app.main:app --port 8000 --reload) &
(cd frontend && npx vite --port 5173 --strictPort) &
sleep 2
echo ""
echo "  ▶ http://localhost:5173 を開いてください"
echo ""
wait
