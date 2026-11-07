# 著作物利用シート（下書き）

提出用の著作物利用シート（運営のテンプレート）に転記する元の一覧。2026-11-08に、lockファイルでインストールしたパッケージのメタデータからライセンスを読み取った（Issue #24）。

## 論文（デモ用）

| 著作物 | 著作者 | 出典 | ライセンス | 使い方 |
| --- | --- | --- | --- | --- |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding（NAACL-HLT 2019） | Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova | ACL Anthology N19-1423（<https://aclanthology.org/N19-1423/>） | CC BY 4.0 | デモ動画とピッチで、PDFを画面に表示し、Geminiで解析した結果を見せる。PDFはリポジトリに含めない |

CC BY 4.0は、著作者・題名・出典・ライセンスを表示すれば、表示や改変を許す。デモ動画とスライドにも、上の表の内容をクレジットとして入れる。

## フォント（Google Fonts）

| フォント | ライセンス | 使い方 |
| --- | --- | --- |
| Zen Maru Gothic | SIL Open Font License 1.1 | 画面の見出し。Google Fontsから読み込む |
| Zen Kaku Gothic New | SIL Open Font License 1.1 | 画面の本文 |
| BIZ UDPGothic | SIL Open Font License 1.1 | 画面の本文（読みやすさのため） |

## ライブラリ（バックエンド、Python）

本番のイメージに入るもの（`paper-summarizer/backend/pyproject.toml` の `dependencies`）。表には直接依存だけを載せ、`uvicorn[standard]` が入れる追加のパッケージや推移的な依存は載せていない。

| パッケージ | バージョン | ライセンス |
| --- | --- | --- |
| fastapi | 0.162.0 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| google-genai | 2.34.0 | Apache-2.0 |
| python-multipart | 0.0.33 | Apache-2.0 |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| pypdfium2 | 5.15.1 | Apache-2.0 または BSD-3-Clause（同梱のPDFiumと、その依存ライブラリのライセンスはwheelの `licenses/` に入っている） |

開発とテストだけで使うもの（本番のイメージには入らない）。

| パッケージ | バージョン | ライセンス |
| --- | --- | --- |
| httpx2 | 2.16.0 | BSD-3-Clause |
| pytest | 9.2.0 | MIT |
| pytest-cov | 7.1.0 | MIT |
| ruff | 0.17.3 | MIT |

引用の照合に使っていたPyMuPDF（AGPL-3.0）は、2026-11-08にpypdfium2へ置き換えた。BERTの論文でGeminiが出した18件の引用は、置き換えの前後でどれも同じページで照合できた。

## ライブラリ（フロントエンド、JavaScript）

画面に組み込んで配信するもの（`paper-summarizer/frontend/package.json` の `dependencies`）。

| パッケージ | バージョン | ライセンス |
| --- | --- | --- |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| pdfjs-dist | 6.5.438 | Apache-2.0 |
| katex | 0.19.1 | MIT（同梱のフォントを含む） |

開発・ビルド・テストだけで使うもの（配信するファイルには入らない）。

| パッケージ | バージョン | ライセンス |
| --- | --- | --- |
| vite | 8.3.5 | MIT |
| @vitejs/plugin-react | 6.2.1 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| vitest | 5.1.0 | MIT |
| @vitest/coverage-v8 | 5.1.0 | MIT |
| jsdom | 30.1.3 | MIT |
| @testing-library/react | 16.3.3 | MIT |
| @testing-library/jest-dom | 7.0.1 | MIT |
| @testing-library/user-event | 14.6.8 | MIT |
| @playwright/test | 1.64.1 | Apache-2.0 |
| oxlint | 1.91.0 | MIT |
| prettier | 3.9.10 | MIT |
| @types/katex、@types/node、@types/react、@types/react-dom | 0.16.8、24.19.2、19.3.0、19.3.0 | MIT |

## ビルドと実行の環境

| もの | ライセンス | 使い方 |
| --- | --- | --- |
| Docker イメージ `python:3.12-slim` | Python Software Foundation License（中のDebianのパッケージはそれぞれのライセンス） | Cloud Runで動かすイメージの土台 |
| uv 0.8.11（`ghcr.io/astral-sh/uv`） | MIT または Apache-2.0 | イメージの中で依存パッケージを入れる |
| GitHub Actions（actions/checkout、actions/setup-node、actions/upload-artifact、astral-sh/setup-uv） | MIT | CIとCD。upload-artifactはe2eテストの失敗時の記録、setup-uvはバックエンドのテスト環境に使う |
| GitHub Actions（google-github-actions/auth、setup-gcloud） | Apache-2.0 | CDでGCPに入る |

## 生成AIの出力

画面に出す解説・要約・Q&Aの回答は、アップロードされた論文をもとにGemini（Vertex AI、gemini-3.6-flash）が生成する。リポジトリには生成結果を含めない。

## 画像・アイコン

画面のアイコン（favicon）はチームで作った。ほかに画面では外部の画像・アイコン・音声を使っていない。

| 素材 | 出典 | 使い方 |
| --- | --- | --- |
| Google Cloud 公式アイコン（Cloud Run、Cloud Storage、Vertex AI、カテゴリの Web & Mobile と DevOps） | <https://cloud.google.com/icons>（Google Cloudが構成図のために配布しているもの） | `docs/architecture.svg` と `docs/architecture.png` の構成図。Firebase HostingとGitHub Actionsには専用のアイコンが無いので、カテゴリのアイコンを使った |
