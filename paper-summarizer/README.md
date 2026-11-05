# PaperSummarizer for Students

英語論文の PDF を、3つのステップで読み進めるための学習サポーターです（DevFest GDGoC Japan Hackathon 2026・カテゴリ「教育」）。

| Step | 名前 | 内容 |
| --- | --- | --- |
| 1・知る | 前提知識マップ | 前提となる概念を依存グラフで示す。「知らない」にした概念だけ補足を表示する。3行要約と読む順番も示す |
| 2・追う | コアロジック＆図表連動 | 手法を段階ごとに解説する。進めるたびに左の PDF の根拠箇所を強調し、数式は記号ごとに解説する |
| 3・疑う | 批判的思考チェック | 先に自分の考えを書いてから Pros/Cons・限界・代替案を見る。「論文の記述」と「AIの指摘（要検証）」を区別する |
| 常設 | 根拠付きQ&A | どのStepからでも質問できる。回答に根拠ページが付き、論文に記載がなければそう答える |

すべての根拠（ページ + 原文引用）は、サーバー側で PDF のテキストと照合します。PDF 内で見つからない引用は「未確認」と表示します。

## ローカルで起動する

必要なもの: [uv](https://docs.astral.sh/uv/)、Node.js 20 以上

```bash
./dev.sh
```

ブラウザで http://localhost:5173 を開きます。

- 初回は `backend/.env` が自動で作られます。Gemini の認証情報が未設定の間は**デモモード**で動きます。解説文はサンプルですが、根拠の引用はアップロードした PDF の実際の文から取るので、PDF へのジャンプと強調表示は確認できます。
- 実際に Gemini で解析するには、`backend/.env` に次のどちらかを設定して再起動します。
  - `GEMINI_API_KEY=...`（Google AI Studio で発行。手軽ですが、ハッカソンの Cloud Credit は適用されません）
  - `GOOGLE_CLOUD_PROJECT=...`（Vertex AI。Cloud Credit が使えます。事前に `gcloud auth application-default login` が必要です）
- モデルは `ANALYSIS_MODEL` / `QA_MODEL` で変更できます（既定値 `gemini-3.6-flash`）。

個別に起動する場合:

```bash
cd backend && uv sync && uv run uvicorn app.main:app --port 8000 --reload
cd frontend && npm install && npm run dev
```

## 開発（lint / format / test）

GitHub Actions（`.github/workflows/ci.yml`）で、PR と main への push ごとに次を実行します。PR を出す前にローカルでも同じコマンドを通してください。

| 対象 | 内容 | コマンド |
| --- | --- | --- |
| backend | lint | `uv run ruff check .`（自動修正は `--fix`） |
| backend | format | `uv run ruff format .`（CI は `--check`） |
| backend | 単体 + 結合テスト（カバレッジ 80% 以上） | `uv run pytest --cov` |
| frontend | format | `npm run format`（CI は `npm run format:check`） |
| frontend | lint | `npm run lint` |
| frontend | 型チェック + ビルド | `npm run build` |
| frontend | 単体テスト（カバレッジ 80% 以上） | `npm test` / `npm run coverage` |
| frontend | e2e（Playwright） | `npm run e2e`（初回のみ `npx playwright install chromium`） |

- backend のテストはデモモードで動かし、Gemini は呼びません。Gemini 呼び出し部分はクライアントを差し替えてテストしています。
- e2e はデモモードのバックエンド（:8000）と Vite（:5173）を自動で起動し、アップロードから Step 1〜3、Q&A までの操作を通します。テスト用の PDF は `backend/scripts/make_sample_pdf.py` が作ります。
- PdfViewer（pdf.js と canvas を使う）は jsdom で動かないため、単体テストのカバレッジ対象から外し、e2e で確認しています。

## 構成

```
backend/   FastAPI + google-genai（Gemini に PDF をネイティブ入力）+ PyMuPDF（引用の照合）
  app/main.py       API（HTTP の入出力と入力チェック）
  app/services.py   解析ジョブと Q&A の組み立て（Step 1→2→3 を順に生成し、できた順に保存）。Gemini 版とデモ版の解析器を論文ごとに選ぶ
  app/store.py      保存層（読み込みから保存までを1つのロックで行う）
  app/gemini.py     プロンプトと Gemini 呼び出し（JSON スキーマで出力を固定）
  app/schemas.py    出力スキーマ（すべての主張に page + quote を必須化）
  app/pdf_utils.py  引用の照合（20文字・4語以上、単語の境界で照合。ページを補正したら page_corrected / claimed_page を付ける）
  app/mock.py       デモモード用のサンプル結果
frontend/  Vite + React + TypeScript + pdf.js + KaTeX
```

本番（Google Cloud）への置き換え:

| ローカル | 本番 |
| --- | --- |
| `backend/data/uploads/`（PDF） | Cloud Storage（署名付きURLで直接アップロード） |
| `backend/data/papers/*.json`（状態・結果・会話） | Firestore |
| バックグラウンドスレッド（同時実行2） | Cloud Tasks + Cloud Run Worker |
| フロントのポーリング（1.5秒） | Firestore のリアルタイムリスナー |
| Vite の dev サーバー | Firebase Hosting（静的書き出し） |

## API

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 動作モード（demo / gemini-api / vertex）とモデル名 |
| POST | `/api/papers` | PDF アップロード（multipart: `file`, `level`=undergrad\|grad）。同じ PDF は再解析せず、解析結果だけを写した新しい論文IDを返す（`reused: true`） |
| GET | `/api/papers/{id}` | 状態と生成結果 |
| GET | `/api/papers/{id}/pdf` | PDF 本体 |
| POST | `/api/papers/{id}/ask` | 質問（`{question, current_step}`）→ 根拠付き回答。論文ごとに1分10回まで（超えると 429） |
| POST | `/api/papers/{id}/retry` | 失敗した解析、または10分以上止まったままの解析の再実行。論文ごとに1分3回まで |

## 制限事項（ローカル版）

- PDF は 20MB / 100ページまで。テキストを含む PDF のみ対応しています（スキャン画像だけの PDF は不可）。
- PDF をリクエストに直接載せて Gemini に送るため、Q&A でも毎回 PDF 全体を送ります。本番ではコンテキストキャッシュで再送を避けます。
- 認証はありません（ローカル専用）。
