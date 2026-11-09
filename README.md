# PaperSummarizer for Students

DevFest Hackathon 2026 の提出作品です（カテゴリ: 教育）。研究室に配属されたばかりの学生が、英語論文を「知る → 追う → 疑う → 試す」の4段階で読み進める学習アプリで、解説のすべてに論文のページと原文の引用を付けます。

- デプロイした URL: <https://devfeshack.web.app>（ログイン不要）
- 仕様書: [docs/spec.md](docs/spec.md)
- 著作物利用シートの下書き: [docs/licenses.md](docs/licenses.md)
- 根拠の正確さの評価: [docs/evaluation.md](docs/evaluation.md)
- アーキテクチャ図: [docs/architecture.png](docs/architecture.png)
- アプリのコードと開発の手順: [paper-summarizer/](paper-summarizer/README.md)
- デプロイの手順: [paper-summarizer/DEPLOY.md](paper-summarizer/DEPLOY.md)

開発はチームの別のリポジトリで行い、CI とデプロイ（GitHub Actions）もそちらで動かしました。このリポジトリの `.github/workflows/` は、その設定をそのまま残したものです。

ライセンスは [MIT](LICENSE) です。デモ用の論文などの著作物の出典とライセンスは、著作物利用シートにまとめています。
