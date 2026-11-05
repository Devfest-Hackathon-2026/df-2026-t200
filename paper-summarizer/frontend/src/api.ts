export type Evidence = { page: number; quote: string; verified?: boolean | null }
export type Origin = 'paper' | 'ai_inference'

export type Concept = {
  id: string
  name: string
  description: string
  why_needed: string
  first_page: number | null
  depends_on: string[]
}
export type Step1 = {
  title: string
  summary: string[]
  difficulty: string
  concepts: Concept[]
  sections: { title: string; page_start: number; page_end: number }[]
  reading_order: { section: string; page: number; reason: string }[]
}

export type Equation = {
  label: string
  page: number
  latex: string
  plain_meaning: string
  symbols: { symbol_latex: string; meaning: string; defined_page: number | null }[]
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
export type Step2 = { overview: string; stages: Stage[] }

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

export type Status = 'queued' | 'processing_step1' | 'processing_step2' | 'processing_step3' | 'done' | 'failed'

export type Paper = {
  id: string
  filename: string
  level: 'undergrad' | 'grad'
  page_count: number
  status: Status
  error: string | null
  demo: boolean
  results: { step1?: Step1; step2?: Step2; step3?: Step3 }
  messages: Message[]
}

export type PaperSummary = { id: string; filename: string; title: string | null; status: Status; created_at: string }
export type Health = { demo_mode: boolean; backend: string; analysis_model: string; max_upload_mb: number }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* 本文が JSON でない場合はステータスのみ */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => fetch('/api/health').then((r) => json<Health>(r)),
  list: () => fetch('/api/papers').then((r) => json<PaperSummary[]>(r)),
  get: (id: string) => fetch(`/api/papers/${id}`).then((r) => json<Paper>(r)),
  upload: (file: File, level: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('level', level)
    return fetch('/api/papers', { method: 'POST', body: fd }).then((r) => json<{ id: string; reused: boolean }>(r))
  },
  retry: (id: string) => fetch(`/api/papers/${id}/retry`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  ask: (id: string, question: string, currentStep: number) =>
    fetch(`/api/papers/${id}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, current_step: currentStep }),
    }).then((r) => json<{ messages: Message[] }>(r)),
  pdfUrl: (id: string) => `/api/papers/${id}/pdf`,
}
