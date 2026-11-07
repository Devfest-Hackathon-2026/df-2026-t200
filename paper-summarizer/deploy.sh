#!/usr/bin/env bash
# Google Cloud へのデプロイ。手順と前提は DEPLOY.md を参照。
#
#   PROJECT_ID=my-project-123 ./deploy.sh setup   # 初回だけ: API の有効化、バケット、サービスアカウント、Firebase の追加
#   PROJECT_ID=my-project-123 ./deploy.sh api     # バックエンドを Cloud Run にデプロイ
#   PROJECT_ID=my-project-123 ./deploy.sh web     # フロントエンドを Firebase Hosting にデプロイ
#   PROJECT_ID=my-project-123 ./deploy.sh all     # api と web を続けて実行
#   PROJECT_ID=my-project-123 ./deploy.sh cd-setup  # 初回だけ: GitHub Actions からのデプロイ（CD）の設定
#   MIN_INSTANCES=1 を付けると待機インスタンスを 1 台にする（審査の期間用。起きている間は費用がかかる）
set -euo pipefail
cd "$(dirname "$0")"

: "${PROJECT_ID:?PROJECT_ID を指定してください（例: PROJECT_ID=my-project-123 ./deploy.sh setup）}"
REGION="${REGION:-asia-northeast1}"
# firebase.json の rewrites と同じ名前にする
SERVICE="paper-summarizer-api"
BUCKET="${BUCKET:-${PROJECT_ID}-paper-data}"
SA_NAME="paper-summarizer-run"
# Gemini を呼ぶ回数の1日の上限（DEPLOY.md の「費用の上限と緊急停止」）。デプロイのたびにこの値で上書きする。
# 既定は審査期間の値。ふだんの値はアプリの既定（解析30・質問150）
MAX_ANALYSES_PER_DAY="${MAX_ANALYSES_PER_DAY:-10}"
MAX_ASKS_PER_DAY="${MAX_ASKS_PER_DAY:-50}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
# 版を固定する（2026-10-21 公開）
FIREBASE="npx --yes firebase-tools@15.34.1"

gc() { gcloud --project "$PROJECT_ID" "$@"; }

# 作ったばかりのサービスアカウントは、権限の付与先として使えるまで数十秒かかることがある
retry() {
  local i
  for i in 1 2 3 4 5 6; do
    "$@" && return 0
    echo "（反映を待って再試行します: ${i}/6）" >&2
    sleep 10
  done
  return 1
}

setup() {
  echo "== API を有効にする"
  gc services enable \
    run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    aiplatform.googleapis.com storage.googleapis.com iam.googleapis.com \
    compute.googleapis.com \
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
  retry gc projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/aiplatform.user --condition None --format none
  retry gc storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/storage.objectUser --format none

  echo "== ソースからのビルドに使うサービスアカウントにビルドの権限を渡す"
  # Compute Engine API を有効にすると作られる既定のサービスアカウントを、Cloud Build が使う
  local number
  number="$(gc projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
  retry gc projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${number}-compute@developer.gserviceaccount.com" \
    --role roles/run.builder --condition None --format none

  echo "== プロジェクトを Firebase に追加する（追加済みならそのまま）"
  $FIREBASE projects:addfirebase "$PROJECT_ID" \
    || echo "（失敗しました。追加済みなら問題ありません。未追加なら firebase login 済みかを確かめるか、Firebase コンソールで追加してください）"
}

cd_setup() {
  # GitHub Actions から鍵ファイルなしでデプロイするための設定（Workload Identity 連携）。初回だけ実行する。
  # main ブランチの、このリポジトリのワークフローだけが、デプロイ用サービスアカウントになれる。
  local repo="${GITHUB_REPO:-YukiUSAMI/DevFesHack}"
  local deployer="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
  local number
  number="$(gc projects describe "$PROJECT_ID" --format 'value(projectNumber)')"

  echo "== API を有効にする"
  gc services enable iamcredentials.googleapis.com sts.googleapis.com

  echo "== デプロイ用サービスアカウント ${deployer}"
  if ! gc iam service-accounts describe "$deployer" >/dev/null 2>&1; then
    gc iam service-accounts create github-deployer --display-name "GitHub Actions deployer"
  fi
  # ソースからのデプロイ（Cloud Build と Cloud Run の更新）と、Firebase Hosting へのデプロイだけを許す。
  # 「誰でも呼べる」設定の変更権限は渡さない（CI からは SKIP_INVOKER_IAM=1 で触れない）
  local role
  for role in roles/run.sourceDeveloper roles/firebasehosting.admin; do
    retry gc projects add-iam-policy-binding "$PROJECT_ID" \
      --member "serviceAccount:${deployer}" --role "$role" --condition None --format none
  done
  # 実行用（Cloud Run）とビルド用（Cloud Build）のサービスアカウントとして動く権限
  local sa
  for sa in "$SA_EMAIL" "${number}-compute@developer.gserviceaccount.com"; do
    retry gc iam service-accounts add-iam-policy-binding "$sa" \
      --member "serviceAccount:${deployer}" --role roles/iam.serviceAccountUser --format none
  done

  echo "== Workload Identity プール github とプロバイダ github"
  if ! gc iam workload-identity-pools describe github --location global >/dev/null 2>&1; then
    gc iam workload-identity-pools create github --location global --display-name "GitHub Actions"
  fi
  if ! gc iam workload-identity-pools providers describe github --location global --workload-identity-pool github >/dev/null 2>&1; then
    gc iam workload-identity-pools providers create-oidc github \
      --location global --workload-identity-pool github \
      --issuer-uri https://token.actions.githubusercontent.com \
      --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
      --attribute-condition "assertion.repository == '${repo}' && assertion.ref == 'refs/heads/main'"
  fi
  retry gc iam service-accounts add-iam-policy-binding "$deployer" --role roles/iam.workloadIdentityUser \
    --member "principalSet://iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/github/attribute.repository/${repo}" \
    --format none

  echo ""
  echo "  ワークフローに書く値:"
  echo "    WIF_PROVIDER: projects/${number}/locations/global/workloadIdentityPools/github/providers/github"
  echo "    DEPLOY_SA:    ${deployer}"
}

deploy_api() {
  # 「誰でも呼べる」設定は setup 後の初回デプロイで付ける。CI（SKIP_INVOKER_IAM=1）からは変えない
  local INVOKER_FLAG=(--allow-unauthenticated)
  [ "${SKIP_INVOKER_IAM:-0}" = "1" ] && INVOKER_FLAG=()
  echo "== Cloud Run にデプロイ（Cloud Build でイメージを作る）"
  # 保存先はファイル（JSON）なので、同時に書き込まないようインスタンスは 1 台に固定する。
  # 解析は応答を返した後もバックグラウンドで続くため、CPU を常に割り当てる（--no-cpu-throttling）。
  # 待機インスタンス 0 台だと、アクセスのない間に解析の途中でもインスタンスが止まりうる。
  # 審査の期間は MIN_INSTANCES=1 でデプロイし、常に 1 台起こしておく（その間は費用がかかり続ける）。
  # ボリュームは毎回付け直し、再デプロイで同じ名前が重ならないようにする。
  gc run deploy "$SERVICE" \
    --source backend \
    --region "$REGION" \
    --service-account "$SA_EMAIL" \
    "${INVOKER_FLAG[@]}" \
    --execution-environment gen2 \
    --min-instances "${MIN_INSTANCES:-0}" --max-instances 1 \
    --no-cpu-throttling --cpu 1 --memory 1Gi --timeout 300 --concurrency 20 \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,DATA_DIR=/data,MAX_ANALYSES_PER_DAY=${MAX_ANALYSES_PER_DAY},MAX_ASKS_PER_DAY=${MAX_ASKS_PER_DAY}" \
    --clear-volumes --clear-volume-mounts \
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
  cd-setup) cd_setup ;;
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api && deploy_web ;;
  *) echo "使い方: PROJECT_ID=... $0 {setup|cd-setup|api|web|all}" >&2; exit 2 ;;
esac
