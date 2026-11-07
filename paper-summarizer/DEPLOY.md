# Google Cloudへのデプロイ

バックエンドをCloud Run、フロントエンドをFirebase Hostingに置く。PDFと解析結果は、Cloud RunにマウントしたCloud Storageのバケットにファイルとして保存する。GeminiはVertex AI経由で呼び、Cloud Runのサービスアカウントで認証するのでAPIキーは使わない。

```
ブラウザ ─ Firebase Hosting（画面）
   └ /api/** ─→ Cloud Run（paper-summarizer-api, asia-northeast1）─→ Vertex AI（Gemini）
                    └ /data ＝ Cloud Storage バケット（PDF と JSON）
```

Firestore・Cloud Tasks・署名付きURLへの置き換え（#6〜#9）は、この構成で動いてから順に行う。それまでは保存先がファイルなので、Cloud Runのインスタンスを1台に固定している。

## 1. GCPプロジェクトを用意する（人が行う）

ここはクレジットカードの登録や規約への同意を含むため、チームの代表者がブラウザで行う。

1. Google Cloudコンソール（<https://console.cloud.google.com/>）で新しいプロジェクトを作る。名前は自由で、表示される「プロジェクトID」（例: `paper-summarizer-hack26`）を控える。大学のGoogle Workspaceのアカウントは組織のポリシーで「誰でも呼べるCloud Run」を作れないことがあるので、個人のGoogleアカウントを使う
2. 「お支払い」で請求先アカウントをプロジェクトに紐づけ、運営から配られたCloud Credit（$20）を適用する。クレジットの有効化にはクレジットカードの登録が必要
3. 「お支払い」→「予算とアラート」で、このプロジェクトに$20の予算を作り、25%・50%・75%（$5・$10・$15）で通知する。アラートは通知だけで自動では止まらないので、費用はこのあとの設定（インスタンス1台、質問の回数制限）で抑える。チームのプロジェクト`devfeshack`は、オーナーの判断で予算アラートを付けていない。そのため、アプリ側の1日の上限（「費用の上限と緊急停止」の節）で費用を抑えている
4. Firebaseコンソール（<https://console.firebase.google.com/>）で「プロジェクトを追加」から、手順1のプロジェクトを選んでFirebaseを有効にする。Googleアナリティクスは不要

## 2. このパソコンから操作できるようにする（人が行う）

Claude Codeは、このパソコンのgcloudとFirebase CLIを、ログインした人の権限で実行する。Claude Code専用のアカウントや鍵は作らない。コマンドを実行するたびにClaude Codeが許可を求めるので、内容を見てから許可する。

自分のターミナル（WSL）で次を実行し、ブラウザでログインする。

```bash
gcloud auth login
gcloud config set project <プロジェクト ID>
npx --yes firebase-tools@15.34.1 login
```

ローカルの開発サーバーからVertex AIのGeminiを試すときは、`gcloud auth application-default login`も実行し、`backend/.env`に`GOOGLE_CLOUD_PROJECT=<プロジェクト ID>`を書く。

ログインしたアカウントはプロジェクトのオーナーなので、プロジェクト内のことは何でもできる。このプロジェクトはこのアプリ専用にし、ほかのサービスを置かない。

## 3. デプロイする

`paper-summarizer/`で実行する。

```bash
PROJECT_ID=<プロジェクト ID> ./deploy.sh setup   # 初回だけ
PROJECT_ID=<プロジェクト ID> ./deploy.sh all
# 審査の期間（提出から Regional Day、Demo Day の前後）は待機インスタンスを 1 台にする
PROJECT_ID=<プロジェクト ID> MIN_INSTANCES=1 ./deploy.sh api
# 審査の期間が終わったら 0 台に戻す
PROJECT_ID=<プロジェクト ID> MIN_INSTANCES=0 ./deploy.sh api
```

`MIN_INSTANCES`を渡さないときは、待機インスタンスの数を変えない。CDからのデプロイもこの数を変えないので、審査の期間に1台にしたあとmainへマージしても0台に戻らない。

`setup`では次のことを行う。

- Cloud Run、Cloud Build、Artifact Registry、Vertex AI、Cloud Storage、Firebase HostingなどのAPIを有効にする
- 非公開のバケット`<プロジェクト ID>-paper-data`を東京リージョンに作る
- Cloud Run用のサービスアカウント`paper-summarizer-run`を作り、Vertex AIの利用権限（`roles/aiplatform.user`）と、このバケットだけの読み書き権限（`roles/storage.objectUser`）を渡す
- ソースからのビルドに使う既定のサービスアカウントに`roles/run.builder`を渡す

`all`は、Cloud Buildでイメージを作ってCloud Runにデプロイし、続けてフロントエンドをビルドしてFirebase Hostingに載せる。終わったら`https://<プロジェクト ID>.web.app`を開く。`/api/health`の`backend`が`vertex`になっていれば、GeminiをVertex AI経由で呼べている。

## 4. mainへのマージで自動デプロイする（CD）

`.github/workflows/deploy.yml`は、mainへのpushでCIが通ったら、`deploy.sh api`と`deploy.sh web`を実行し、公開URLの`/api/health`を確かめる。Actionsの画面から手動でも実行できる。

GitHub ActionsからGCPへは鍵ファイルを使わず、Workload Identity連携で入る。GCP側の条件で、`YukiUSAMI/DevFesHack`のmainブランチから動いたワークフローしかデプロイ用アカウントになれない。初回だけ、オーナーが次を実行する。IAMの権限を付ける操作なので、人が内容を確かめて実行する。

```bash
PROJECT_ID=<プロジェクト ID> ./deploy.sh cd-setup
```

デプロイ用アカウント`github-deployer`に付けるのは、ソースからのデプロイ（`roles/run.sourceDeveloper`）、Firebase Hostingへの公開（`roles/firebasehosting.admin`）、実行用とビルド用のサービスアカウントとして動く権限である。Cloud Runの「誰でも呼べる」設定を変える権限は付けないので、CIからのデプロイではこの設定に触れない（`SKIP_INVOKER_IAM=1`）。GCP側の条件で、このリポジトリのmainブランチの`deploy.yml`から動いたジョブしか、このアカウントになれない。

ただし、次の2点で、実際の権限は上の一覧より広い。

- ビルド用のCompute Engineの既定アカウントには、Googleが自動で付ける「編集者」（`roles/editor`）が付いている。デプロイ用アカウントはこのアカウントとして動けるので、実質的にプロジェクトの編集者に近い。既定アカウントから「編集者」を外し、ビルドに要る`roles/run.builder`だけにすると狭くなる（ほかの用途で使っていないかをオーナーが確かめてから行う）
- `roles/run.sourceDeveloper`はプロジェクト全体のオブジェクトの読み書きを含むので、データのバケット（PDFと解析結果）も読み書きできる

入口はmainへのpushなので、mainにpushできる人はデプロイ用アカウントを使えることになる。このリポジトリではmainにブランチ保護を付けない代わりに、チームの約束として、mainへ直接pushせず、レビューとCIが通ったPRだけをマージする。

ワークフローは、認証より前にフロントエンドをビルドし（依存パッケージのスクリプトに認証情報を見せない）、mainの最新のコミットでなければデプロイしない（古いコミットのCIを再実行したときに古い版を出さない）。使うActionsはコミットSHAで固定している。別のプロジェクトで使うときは、ワークフローの`PROJECT_ID`・`WIF_PROVIDER`・`DEPLOY_SA`を`cd-setup`の出力に合わせて書き換える。

## Cloud Runの設定とその理由

| 設定 | 値 | 理由 |
| --- | --- | --- |
| リージョン | asia-northeast1 | 利用者が日本にいる。Gemini は `GOOGLE_CLOUD_LOCATION=global` で呼ぶ |
| インスタンス数 | 0〜1 台（審査期間は 1 台） | 保存先がファイルなので同時に書き込ませない。待機 0 台だとアクセスのない間に止まり、解析の途中でも止まることがある（10分後に再実行できる） |
| CPU の割り当て | 常に割り当てる（`--no-cpu-throttling`） | 解析は応答を返した後もバックグラウンドで続くため |
| リクエストのタイムアウト | 300 秒 | Q&A は毎回 PDF 全体を Gemini に送るため長めにする。ただし Firebase Hosting を通すと 60 秒で打ち切られるので、実際の上限は 60 秒になる |
| 未認証の呼び出し | 許可 | Firebase Hosting から転送して呼ぶため。審査員はログインなしで使える |

## 費用の上限と緊急停止

予算アラートが無い前提で、アプリ側にサービス全体の上限を設けている。1日の上限は直近24時間の回数で数え、バケットの`quota/`に記録するので、インスタンスが入れ替わっても0に戻らない。上限に達すると、画面に「本日の利用上限に達しました」と出して断る。

| 環境変数 | 既定値 | 数えるもの |
| --- | --- | --- |
| `MAX_ANALYSES_PER_DAY` | 30 | 新しい解析と再解析（1回でGeminiを3回呼ぶ）。解析済みのPDFの使い回しは数えない |
| `MAX_ASKS_PER_DAY` | 150 | 質問（1回ごとにPDF全体をGeminiに送る） |
| `MAX_UPLOADS_PER_DAY` | 100 | アップロード（解析しない使い回しも含む） |
| `ASK_GLOBAL_PER_MIN` | 20 | 1分あたりの質問（全論文の合計） |

Geminiが答える前に考える量は `THINKING_LEVEL`（既定 `low`）で決める。考えた分も出力として課金されるため、既定より費用と時間を下げている。空にするとモデルの既定に任せる。

`deploy.sh api`は、解析と質問の上限を毎回`MAX_ANALYSES_PER_DAY`（既定10）と`MAX_ASKS_PER_DAY`（既定50）で上書きする。既定は審査期間に合わせて低くしてある。変えるときは`MAX_ANALYSES_PER_DAY=30 PROJECT_ID=... ./deploy.sh api`のように渡す。

Geminiを止めたいときは、上限を0にして環境変数だけを書き換える。イメージは作り直さないので、すぐに反映される。ただし`deploy.sh api`は上限を毎回上書きするので、止めている間にmainへマージすると、CDのデプロイで既定の10回・50回に戻る。止めている間はマージしない。

```bash
gcloud run services update paper-summarizer-api --region asia-northeast1 --project <プロジェクト ID> \
  --update-env-vars MAX_ANALYSES_PER_DAY=0,MAX_ASKS_PER_DAY=0
```

ログインが無いので、誰かが上限を使い切ると、その日はほかの人（審査員を含む）も使えなくなる。審査の直前に使い切られていたら、記録を消すか上限を上げて戻す。記録の読み書きに失敗したときも、費用が出ないよう、その依頼を断る。

```bash
# 記録を消して数え直す（解析の上限だけなら analyses.json だけを消す）
gcloud storage rm gs://<プロジェクト ID>-paper-data/quota/analyses.json
```

## 公開前に知っておくこと

- ログイン機能がないため、URLを知っている人は誰でも論文をアップロードできる。「これまでの論文」には、そのブラウザでアップロードした論文だけが出る（ブラウザごとのランダムなIDで絞る）。論文のIDを知られれば中身は見えるので、本人のデータの分離は#10（Firebase Anonymous Auth）で行う
- 費用は上の上限で抑えているが、URLはチームと審査員にだけ伝える
- AGPL-3.0のPyMuPDFはpypdfium2に置き換えたので、本番のイメージにAGPLのライブラリは入っていない（`docs/licenses.md`）
