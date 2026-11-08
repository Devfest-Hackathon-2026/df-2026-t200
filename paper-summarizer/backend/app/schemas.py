"""Gemini の構造化出力スキーマ（response_schema）と API 応答の型。

すべての主張に「根拠（ページ番号 + 原文の引用）」を必須で持たせる。
引用はサーバー側で PDF のテキストと照合し、verified を付けてからフロントへ返す。
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Evidence(BaseModel):
    page: int = Field(description="根拠のある PDF の物理ページ番号（1始まり。論文に印字されたページ番号ではない）")
    quote: str = Field(description="そのページから一字一句そのまま抜き出した原文（英語なら英語のまま、10〜25語程度）")
    verified: bool | None = Field(default=None, description="サーバーが付与。Gemini は出力しない")


class Origin(str, Enum):
    paper = "paper"  # 論文自身が述べている
    ai_inference = "ai_inference"  # AI による指摘（要検証）


class Importance(str, Enum):
    essential = "essential"  # 必須
    recommended = "recommended"  # 推奨
    advanced = "advanced"  # 発展


class AnswerSource(str, Enum):
    paper = "paper"
    general_knowledge = "general_knowledge"
    not_in_paper = "not_in_paper"


class Confidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


# ---------- Step 1: 前提知識マップ ----------


class Concept(BaseModel):
    id: str = Field(description="英小文字とハイフンのみの短いID（例: softmax）")
    name: str = Field(description="概念名")
    description: str = Field(description="対象読者向けの2〜3文の説明")
    why_needed: str = Field(description="この論文を読むのになぜ必要か（1文）")
    first_page: int | None = Field(description="論文内で最初に登場する PDF ページ。登場しなければ null")
    depends_on: list[str] = Field(description="この概念を理解する前提になる他の概念の id")
    # 以下は後から足した項目。出力が少し外れても Step 1 全体を落とさないよう、すべて既定値を持たせる
    importance: Importance = Field(default=Importance.recommended, description="essential=必須 / recommended=推奨 / advanced=発展")
    category: str = Field(default="concept", description="math / algorithm / concept / tool のいずれか")
    origin: Origin = Field(default=Origin.paper, description="論文に出てくれば paper、論文に出てこない前提知識なら ai_inference")
    evidence: list[Evidence] = Field(default_factory=list, description="origin=paper なら論文からの引用 1〜2 箇所。ai_inference なら空配列")


class SectionInfo(BaseModel):
    title: str
    page_start: int
    page_end: int


class ReadingItem(BaseModel):
    section: str = Field(description="節の名前")
    page: int = Field(description="その節の開始ページ")
    reason: str = Field(description="この順番で読む理由（1文）")


class Step1(BaseModel):
    title: str = Field(description="論文タイトル（原文のまま）")
    summary: list[str] = Field(description="ちょうど3項目: [何の問題か, どう解いたか, 何が分かったか]")
    difficulty: str = Field(description="初級 / 中級 / 上級 のいずれか")
    concepts: list[Concept] = Field(description="前提知識 6〜10 個。基礎的なものから順に")
    sections: list[SectionInfo]
    reading_order: list[ReadingItem] = Field(description="初めて読む学生に勧める読む順番 4〜6 項目")


# ---------- Step 2: コアロジック＆図表連動ウォークスルー ----------


class SymbolInfo(BaseModel):
    symbol_latex: str = Field(description="記号の LaTeX（$ なし）")
    meaning: str
    defined_page: int | None


class Equation(BaseModel):
    label: str = Field(description="式番号（例: (1)）。無ければ式の役割を表す短い名前（例: 開始位置の確率）。LaTeX の記号（_ や ^）は書かない")
    page: int
    latex: str = Field(description="式全体の LaTeX（$ なし、KaTeX で描画可能なもの）")
    plain_meaning: str = Field(description="この式を一言でいうと")
    symbols: list[SymbolInfo]
    # 後から足した項目。出力が外れても Step 2 全体を落とさないよう既定値を持たせる
    concepts: list[str] = Field(default_factory=list, description="この式を理解するのに必要な Step 1 の前提知識の id。Step 1 に無い id は書かない")


class FigureInfo(BaseModel):
    label: str = Field(description="Figure 3 / Table 1 など")
    page: int
    what_it_shows: str
    how_to_read: str = Field(description="軸・凡例・色の読み方")
    supports_claim: str = Field(description="本文のどの主張を支えているか")
    referenced_at: list[Evidence] = Field(description="本文でこの図表に言及している箇所")


class Stage(BaseModel):
    title: str = Field(description="段階の名前（例: 入力の埋め込み）")
    explanation: str = Field(description="この段階で何をしているかを順を追って説明（3〜6文）")
    evidence: list[Evidence] = Field(description="説明の根拠となる本文 1〜3 箇所")
    figures: list[FigureInfo]
    equations: list[Equation]


class FlowKind(str, Enum):
    input = "input"
    process = "process"
    output = "output"


class FlowNode(BaseModel):
    id: str = Field(description="英小文字とハイフンのみの短いID（例: embed）")
    label: str = Field(description="ノードの名前（短く。20字程度まで）")
    kind: FlowKind
    shape: str | None = Field(description="テンソルの形など。論文に書かれているときだけ（根拠を付ける）。なければ null")
    evidence: list[Evidence] = Field(description="このノードの根拠となる本文。shape を書くときは必須")


class FlowEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from", description="始点ノードの id")
    to: str = Field(description="終点ノードの id")
    label: str = Field(description="流れるもの（例: Q, K, V）。なければ空文字")


class FlowFrame(BaseModel):
    stage_index: int = Field(description="対応する stages の番号（0始まり）。stages と1対1")
    active_nodes: list[str] = Field(description="このコマで扱うノードの id")
    active_edges: list[str] = Field(description='このコマで流れる矢印。"始点id->終点id" の形')
    caption: str = Field(description="このコマの一言説明")
    evidence: list[Evidence]


class Flow(BaseModel):
    nodes: list[FlowNode] = Field(description="3〜8 個")
    edges: list[FlowEdge]
    frames: list[FlowFrame] = Field(description="stages と同じ数。stage_index の順")


class Step2(BaseModel):
    overview: str = Field(description="提案手法の流れを2文で")
    stages: list[Stage] = Field(description="入力 → 処理 → 出力 の順に 3〜6 段階")
    flow: Flow | None = Field(default=None, description="手法の流れ図のデータ。作れないときは null")


# ---------- Step 3: 批判的思考チェック ----------


class CriticalPoint(BaseModel):
    text: str
    origin: Origin = Field(description="論文自身が述べていれば paper、AI の推論なら ai_inference")
    evidence: list[Evidence] = Field(description="origin=paper なら必須。ai_inference なら推論のきっかけになった箇所")


class Alternative(BaseModel):
    name: str
    description: str
    comparison: str = Field(description="提案手法と比べた長所・短所")
    origin: Origin
    evidence: list[Evidence]


class LikelyQuestion(BaseModel):
    question: str = Field(description="輪講・ゼミで聞かれそうな質問")
    hint: str = Field(description="答え方のヒント（答えそのものではなく、どこを見ればよいか）")


class Step3(BaseModel):
    prompts: list[str] = Field(description="解説を見る前に学生に考えさせる問い 2〜3 個")
    pros: list[CriticalPoint]
    cons: list[CriticalPoint]
    limitations: list[CriticalPoint]
    alternatives: list[Alternative]
    likely_questions: list[LikelyQuestion]


# ---------- Q&A ----------


class Answer(BaseModel):
    answer: str
    source: AnswerSource = Field(
        description="論文に書いてあれば paper、論文外の一般知識で答えたなら general_knowledge、論文に記載がなく答えられないなら not_in_paper"
    )
    evidence: list[Evidence]
    confidence: Confidence


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    current_step: int | None = None


# ---------- 誤り探しモード ----------


class QuizRewrite(BaseModel):
    id: str = Field(description="渡された文の id（そのまま返す）")
    altered: str = Field(description="元の文の changed_from を changed_to に1か所だけ置き換えた文。ほかは1文字も変えない")
    changed: str = Field(description="何をどう変えたか（例: 数値を 8 から 12 に変えた）を1文で")
    changed_from: str = Field(description="元の文の中の、変える語句（元の文にそのままある文字列）")
    changed_to: str = Field(description="changed_from の代わりに入れた語句")
    quote_span: str = Field(
        description="根拠の引用の中の、changed_from の事実を述べている部分。引用の一部をそのまま（言い換えず、引用と同じ言語で）抜き出す。20文字以上。changed_to を含まない"
    )


class QuizRewrites(BaseModel):
    rewrites: list[QuizRewrite]


class QuizCreateRequest(BaseModel):
    force: bool = False  # True なら、問題があっても新しく作る（上限に数える）


class QuizPick(BaseModel):
    id: str = Field(min_length=1, max_length=20)
    page: int | None = Field(default=None, ge=1, le=100000)


class QuizAnswerRequest(BaseModel):
    picks: list[QuizPick] = Field(max_length=20)


# ---------- 確認モード（前提知識の仕分け） ----------


class CheckQuestion(BaseModel):
    concept_id: str = Field(description="渡された概念の id（そのまま返す）")
    question: str = Field(description="その概念の意味や使いどころを問う問題文")
    choices: list[str] = Field(
        description="ちょうど3つの選択肢。正しいものは1つだけで、互いに別の内容にする。文字数と詳しさをそろえ、正しいものだけを長くしない。「分からない」は入れない"
    )
    correct_index: int = Field(description="choices の中の正しい選択肢の番号（0始まり）")
    explanation: str = Field(description="なぜその選択肢が正しいかの解説（2〜3文）")
    evidence: list[Evidence] = Field(
        description="論文に出てくる概念（origin=paper）では、解説の根拠になる論文の原文を1箇所。一字一句そのまま抜き出す。論文に出てこない概念は空配列"
    )


class CheckQuestions(BaseModel):
    questions: list[CheckQuestion]


class CheckCreateRequest(BaseModel):
    concept_ids: list[str] = Field(min_length=1, max_length=6)
    force: bool = False  # True なら、問題があっても新しく作る（上限に数える）


class CheckAnswer(BaseModel):
    id: str = Field(min_length=1, max_length=20)
    choice: int = Field(ge=0, le=3)  # 選択肢の番号。3 は「分からない」


class CheckAnswerRequest(BaseModel):
    answers: list[CheckAnswer] = Field(max_length=6)


# ---------- 保存する論文の記録 ----------


class Paper(BaseModel):
    """papers/{id}.json の中身（Firestore のドキュメントに相当）。API の応答はこれまでどおり dict のまま返す。"""

    model_config = ConfigDict(extra="allow")

    id: str
    filename: str
    sha256: str = ""
    level: str = "undergrad"
    lang: str = "ja"
    page_count: int = 0
    status: str = "queued"
    error: str | None = None
    demo: bool = False
    results: dict[str, Any] = Field(default_factory=dict)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str | None = None
