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
3. 「お支払い」→「予算とアラート」で、このプロジェクトに$20の予算を作り、25%・50%・75%（$5・$10・$15）で通知する。アラートは通知だけで自動では止まらないので、費用はこのあとの設定（インスタンス1台、質問の回数制限）で抑える
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
```

`setup`では次のことを行う。

- Cloud Run、Cloud Build、Artifact Registry、Vertex AI、Cloud Storage、Firebase HostingなどのAPIを有効にする
- 非公開のバケット`<プロジェクト ID>-paper-data`を東京リージョンに作る
- Cloud Run用のサービスアカウント`paper-summarizer-run`を作り、Vertex AIの利用権限（`roles/aiplatform.user`）と、このバケットだけの読み書き権限（`roles/storage.objectUser`）を渡す
- ソースからのビルドに使う既定のサービスアカウントに`roles/run.builder`を渡す

`all`は、Cloud Buildでイメージを作ってCloud Runにデプロイし、続けてフロントエンドをビルドしてFirebase Hostingに載せる。終わったら`https://<プロジェクト ID>.web.app`を開く。`/api/health`の`backend`が`vertex`になっていれば、GeminiをVertex AI経由で呼べている。

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

Geminiを止めたいときは、上限を0にして環境変数だけを書き換える。イメージは作り直さないので、すぐに反映される。

```bash
gcloud run services update paper-summarizer-api --region asia-northeast1 --project <プロジェクト ID> \
  --update-env-vars MAX_ANALYSES_PER_DAY=0,MAX_ASKS_PER_DAY=0
```

## 公開前に知っておくこと

- ログイン機能がないため、URLを知っている人は誰でも論文をアップロードできる。「これまでの論文」には、そのブラウザでアップロードした論文だけが出る（ブラウザごとのランダムなIDで絞る）。論文のIDを知られれば中身は見えるので、本人のデータの分離は#10（Firebase Anonymous Auth）で行う
- 費用は上の上限で抑えているが、URLはチームと審査員にだけ伝える
- PyMuPDFはAGPL-3.0で配布されている。ネットワーク越しに使わせる場合は利用者にソースコードを提供する条件があるため、公開URLを出す前に対応を決める
