export type Evidence = { page: number; quote: string; verified?: boolean | null }
export type Origin = 'paper' | 'ai_inference'

export type Importance = 'essential' | 'recommended' | 'advanced'

/** importance 以下は後から足した項目。古い保存済みの結果には無いので省略できる */
export type Concept = {
  id: string
  name: string
  description: string
  why_needed: string
  first_page: number | null
  depends_on: string[]
  importance?: Importance
  category?: string
  origin?: Origin
  evidence?: Evidence[]
}
/** 先に読むとよい論文。古い保存済みの結果には無い。doi / arxiv_id はサーバーで形を確かめたもの。リンクはフロントが固定のホストで作る */
export type Foundation = {
  title: string
  authors?: string
  year?: number | null
  reason: string
  order: number
  doi?: string | null
  arxiv_id?: string | null
  evidence?: Evidence[]
}
export type Step1 = {
  title: string
  summary: string[]
  difficulty: string
  concepts: Concept[]
  sections: { title: string; page_start: number; page_end: number }[]
  reading_order: { section: string; page: number; reason: string }[]
  foundations?: Foundation[]
}

export type Equation = {
  label: string
  page: number
  latex: string
  plain_meaning: string
  symbols: { symbol_latex: string; meaning: string; defined_page: number | null }[]
  /** この式に必要な Step 1 の前提知識の id。古い結果には無い */
  concepts?: string[]
}
export type Figure = {
  label: string
  page: number
  what_it_shows: string
  how_to_read: string
  supports_claim: string
  referenced_at: Evidence[]
}
export type Stage = { title: string; explanation: string; evidence: Evidence[]; figures: Figure[]; equations: Equation[] }
export type FlowKind = 'input' | 'process' | 'output'
export type FlowNode = { id: string; label: string; kind: FlowKind; shape: string | null; evidence: Evidence[] }
export type FlowEdge = { from: string; to: string; label: string }
export type FlowFrame = { stage_index: number; active_nodes: string[]; active_edges: string[]; caption: string; evidence: Evidence[] }
export type Flow = { nodes: FlowNode[]; edges: FlowEdge[]; frames: FlowFrame[] }
export type Step2 = { overview: string; stages: Stage[]; flow?: Flow | null }

export type CriticalPoint = { text: string; origin: Origin; evidence: Evidence[] }
export type Step3 = {
  prompts: string[]
  pros: CriticalPoint[]
  cons: CriticalPoint[]
  limitations: CriticalPoint[]
  alternatives: { name: string; description: string; comparison: string; origin: Origin; evidence: Evidence[] }[]
  likely_questions: { question: string; hint: string }[]
}

export type Message = {
  role: 'user' | 'assistant'
  text: string
  source?: 'paper' | 'general_knowledge' | 'not_in_paper'
  evidence?: Evidence[]
  confidence?: 'high' | 'medium' | 'low'
  created_at: string
}

export type Status = 'queued' | 'processing_step1' | 'processing_step2' | 'processing_step3' | 'done' | 'failed' | 'cancelled'

export type Paper = {
  id: string
  filename: string
  level: 'undergrad' | 'grad'
  /** 出力言語。古い記録では無いことがあり、その場合は日本語 */
  lang?: 'ja' | 'en'
  page_count: number
  status: Status
  error: string | null
  demo: boolean
  results: { step1?: Step1; step2?: Step2; step3?: Step3 }
  messages: Message[]
}

/** 誤り探しの問題。回答前は id と文だけで、どれが誤りかはサーバーが返さない */
export type QuizItem = { id: string; text: string }
export type QuizResultItem = {
  id: string
  text: string
  selected: boolean
  user_page: number | null
  altered: boolean
  page_ok: boolean | null
  /** 誤りの文のときだけ入る */
  original: string | null
  changed: string | null
  changed_from: string | null
  changed_to: string | null
  /** quote_span は、quote のうち、変えた事実を述べている部分 */
  evidence: (Evidence & { quote_span?: string }) | null
}
export type QuizResult = { found: number; false_alarms: number; missed: number; total_errors: number; items: QuizResultItem[] }
export type Quiz = { id: string; created_at: string; submitted: boolean; items: QuizItem[]; result: QuizResult | null }
export type QuizPick = { id: string; page: number }

/** 確認モードの問題。回答前は問題文と選択肢だけで、正解はサーバーが返さない。最後の選択肢は必ず「分からない」 */
export type CheckItem = { id: string; concept_id: string; question: string; options: string[]; general_knowledge: boolean }
export type CheckResultItem = CheckItem & {
  chosen: number
  correct_index: number
  is_correct: boolean
  dont_know: boolean
  explanation: string
  /** 論文に出てくる概念だけ。一般知識による問題は null */
  evidence: Evidence | null
}
export type Verdict = 'known' | 'unknown'
export type CheckResult = { correct: number; verdicts: Record<string, Verdict>; items: CheckResultItem[] }
export type Check = { id: string; created_at: string; submitted: boolean; items: CheckItem[]; result: CheckResult | null }
export type CheckAnswer = { id: string; choice: number }

export type Lang = NonNullable<Paper['lang']>
/** 一覧の1件 */
export type PaperSummary = { id: string; filename: string; title: string | null; status: Status; created_at: string }
export type Health = { demo_mode: boolean; backend: string; analysis_model: string; max_upload_mb: number }

/** HTTP エラー。status で「存在しない（404）」などを見分ける。 */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* 本文が JSON でない場合はステータスのみ */
    }
    throw new ApiError(detail, res.status)
  }
  return res.json() as Promise<T>
}

const CLIENT_ID_KEY = 'client-id'
const CLIENT_ID_FORMAT = /^[A-Za-z0-9_-]{16,64}$/
let memoryClientId: string | null = null

/**
 * このブラウザのランダムな ID。サーバーは論文の一覧を、この ID でアップロードした論文だけに絞る
 * （ログインがないので、ほかの人の論文が一覧に出ないようにする）。保存できない環境ではこのタブの間だけ使う
 */
export function clientId(): string {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY)
    if (stored && CLIENT_ID_FORMAT.test(stored)) return stored
    const created = crypto.randomUUID()
    localStorage.setItem(CLIENT_ID_KEY, created)
    return created
  } catch {
    memoryClientId ??= crypto.randomUUID()
    return memoryClientId
  }
}

const withClientId = () => ({ 'X-Client-Id': clientId() })

export const api = {
  health: () => fetch('/api/health').then((r) => json<Health>(r)),
  list: () => fetch('/api/papers', { headers: withClientId() }).then((r) => json<PaperSummary[]>(r)),
  get: (id: string) => fetch(`/api/papers/${id}`).then((r) => json<Paper>(r)),
  upload: (file: File, lang: Lang = 'ja') => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('lang', lang)
    return fetch('/api/papers', { method: 'POST', body: fd, headers: withClientId() }).then((r) => json<{ id: string; reused: boolean }>(r))
  },
  retry: (id: string) => fetch(`/api/papers/${id}/retry`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  /** 実行中の解析を中止する。終わった Step の結果は残り、retry で続きから再開できる */
  cancel: (id: string) => fetch(`/api/papers/${id}/cancel`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  ask: (id: string, question: string, currentStep: number) =>
    fetch(`/api/papers/${id}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, current_step: currentStep }),
    }).then((r) => json<{ messages: Message[] }>(r)),
  getQuiz: (id: string, signal?: AbortSignal) => fetch(`/api/papers/${id}/quiz`, { signal }).then((r) => json<{ quiz: Quiz | null }>(r)),
  /** force なしなら、問題があればそれを返す（Gemini を呼ばない）。force は「新しい問題」で、上限に数えられる */
  createQuiz: (id: string, force = false, signal?: AbortSignal) =>
    fetch(`/api/papers/${id}/quiz`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force }),
      signal,
    }).then((r) => json<{ quiz: Quiz }>(r)),
  answerQuiz: (id: string, quizId: string, picks: QuizPick[], signal?: AbortSignal) =>
    fetch(`/api/papers/${id}/quiz/${quizId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ picks }),
      signal,
    }).then((r) => json<{ quiz: Quiz }>(r)),
  getCheck: (id: string, signal?: AbortSignal) =>
    fetch(`/api/papers/${id}/check`, { signal }).then((r) => json<{ check: Check | null }>(r)),
  /** force なしなら、問題があればそれを返す（Gemini を呼ばない）。force は新しい概念の組で作り直すときで、上限に数えられる */
  createCheck: (id: string, conceptIds: string[], force = false, signal?: AbortSignal) =>
    fetch(`/api/papers/${id}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concept_ids: conceptIds, force }),
      signal,
    }).then((r) => json<{ check: Check }>(r)),
  answerCheck: (id: string, checkId: string, answers: CheckAnswer[], signal?: AbortSignal) =>
    fetch(`/api/papers/${id}/check/${checkId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
      signal,
    }).then((r) => json<{ check: Check }>(r)),
  pdfUrl: (id: string) => `/api/papers/${id}/pdf`,
}
