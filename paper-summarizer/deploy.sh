#!/usr/bin/env bash
# Google Cloud へのデプロイ。手順と前提は DEPLOY.md を参照。
#
#   PROJECT_ID=my-project-123 ./deploy.sh setup   # 初回だけ: API の有効化、バケット、サービスアカウント、Firebase の追加
#   PROJECT_ID=my-project-123 ./deploy.sh api     # バックエンドを Cloud Run にデプロイ
#   PROJECT_ID=my-project-123 ./deploy.sh web     # フロントエンドを Firebase Hosting にデプロイ
#   PROJECT_ID=my-project-123 ./deploy.sh all     # api と web を続けて実行
set -euo pipefail
cd "$(dirname "$0")"

: "${PROJECT_ID:?PROJECT_ID を指定してください（例: PROJECT_ID=my-project-123 ./deploy.sh setup）}"
REGION="${REGION:-asia-northeast1}"
# firebase.json の rewrites と同じ名前にする
SERVICE="paper-summarizer-api"
BUCKET="${BUCKET:-${PROJECT_ID}-paper-data}"
SA_NAME="paper-summarizer-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
# 版を固定する（2026-10-21 公開）
FIREBASE="npx --yes firebase-tools@15.34.1"

gc() { gcloud --project "$PROJECT_ID" "$@"; }

setup() {
  echo "== API を有効にする"
  gc services enable \
    run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    aiplatform.googleapis.com storage.googleapis.com iam.googleapis.com \
    firebase.googleapis.com firebasehosting.googleapis.com

  echo "== PDF と解析結果を置くバケット gs://${BUCKET}"
  if ! gc storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
    gc storage buckets create "gs://${BUCKET}" --location="$REGION" \
      --uniform-bucket-level-access --public-access-prevention
  fi

  echo "== Cloud Run が使うサービスアカウント ${SA_EMAIL}"
  if ! gc iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
    gc iam service-accounts create "$SA_NAME" --display-name "PaperSummarizer Cloud Run"
  fi
  # Vertex AI で Gemini を呼ぶ権限と、バケットの読み書きの権限だけを渡す
  gc projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/aiplatform.user --condition None >/dev/null
  gc storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/storage.objectUser >/dev/null

  echo "== ソースからのビルドに使うサービスアカウントにビルドの権限を渡す"
  local number
  number="$(gc projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
  gc projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${number}-compute@developer.gserviceaccount.com" \
    --role roles/run.builder --condition None >/dev/null

  echo "== プロジェクトを Firebase に追加する（追加済みならそのまま）"
  $FIREBASE projects:addfirebase "$PROJECT_ID" || echo "（追加済みか、Firebase コンソールで追加してください）"
}

deploy_api() {
  echo "== Cloud Run にデプロイ（Cloud Build でイメージを作る）"
  # 保存先はファイル（JSON）なので、同時に書き込まないようインスタンスは 1 台に固定する。
  # 解析は応答を返した後もバックグラウンドで続くため、CPU を常に割り当てる（--no-cpu-throttling）。
  gc run deploy "$SERVICE" \
    --source backend \
    --region "$REGION" \
    --service-account "$SA_EMAIL" \
    --allow-unauthenticated \
    --execution-environment gen2 \
    --min-instances 0 --max-instances 1 \
    --no-cpu-throttling --cpu 1 --memory 1Gi --timeout 300 \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,DATA_DIR=/data" \
    --add-volume "name=data,type=cloud-storage,bucket=${BUCKET}" \
    --add-volume-mount "volume=data,mount-path=/data" \
    --quiet
}

deploy_web() {
  echo "== フロントエンドをビルドして Firebase Hosting にデプロイ"
  (cd frontend && npm ci && npm run build)
  $FIREBASE deploy --only hosting --project "$PROJECT_ID" --non-interactive
  echo ""
  echo "  ▶ https://${PROJECT_ID}.web.app を開いてください"
  echo "    動作モードの確認: curl https://${PROJECT_ID}.web.app/api/health"
}

case "${1:-}" in
  setup) setup ;;
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api && deploy_web ;;
  *) echo "使い方: PROJECT_ID=... $0 {setup|api|web|all}" >&2; exit 2 ;;
esac
