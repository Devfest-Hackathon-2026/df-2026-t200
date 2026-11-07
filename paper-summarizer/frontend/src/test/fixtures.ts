import type { Message, Paper, Quiz, Step1, Step2, Step3 } from '../api'

export const quiz: Quiz = {
  id: 'quiz1',
  created_at: '2026-11-05T00:00:00Z',
  submitted: false,
  items: [
    { id: 'q1', text: '提案手法は層を12枚重ねる。' },
    { id: 'q2', text: '注意の重みは softmax で確率にそろえる。' },
    { id: 'q3', text: '実験では従来手法より誤差が大きかった。' },
  ],
  result: null,
}

const noKey = { page_ok: null, original: null, changed: null, changed_from: null, changed_to: null, evidence: null }

export const quizResult: Quiz = {
  ...quiz,
  submitted: true,
  result: {
    found: 1,
    false_alarms: 1,
    missed: 0,
    total_errors: 1,
    items: [
      { id: 'q1', text: quiz.items[0].text, selected: true, user_page: 3, altered: false, ...noKey },
      { id: 'q2', text: quiz.items[1].text, selected: false, user_page: null, altered: false, ...noKey },
      {
        id: 'q3',
        text: quiz.items[2].text,
        selected: true,
        user_page: 2,
        altered: true,
        page_ok: true,
        original: '実験では従来手法より誤差が小さかった。',
        changed: '比較の向きを逆にした',
        changed_from: '小さかった',
        changed_to: '大きかった',
        evidence: {
          page: 2,
          quote: 'In every run the error was smaller than the baseline.',
          verified: true,
          quote_span: 'the error was smaller than the baseline',
        },
      },
    ],
  },
}

export const step1: Step1 = {
  title: 'Sample Paper',
  summary: ['問題A', '解き方B', '結果C'],
  difficulty: '中級',
  concepts: [
    { id: 'dot', name: '内積', description: 'ベクトルの積', why_needed: '注意の計算に使う', first_page: 2, depends_on: [] },
    { id: 'softmax', name: 'softmax', description: '確率に変換', why_needed: '重みの正規化', first_page: 3, depends_on: ['dot'] },
    {
      id: 'attention',
      name: 'Attention',
      description: '重み付き和',
      why_needed: '本論文の中心',
      first_page: null,
      depends_on: ['softmax'],
    },
  ],
  sections: [{ title: 'Introduction', page_start: 1, page_end: 2 }],
  reading_order: [{ section: 'Introduction', page: 1, reason: '全体像をつかむ' }],
}

export const step2: Step2 = {
  overview: '入力を変換して出力する',
  stages: [
    {
      title: '入力の埋め込み',
      explanation: '単語をベクトルにする',
      evidence: [{ page: 2, quote: 'we embed tokens', verified: true }],
      figures: [
        {
          label: 'Figure 1',
          page: 3,
          what_it_shows: '全体構成',
          how_to_read: '左から右へ',
          supports_claim: '構成が単純',
          referenced_at: [{ page: 2, quote: 'As shown in Figure 1', verified: false }],
        },
      ],
      equations: [
        {
          label: '(1)',
          page: 3,
          latex: 'a = \\frac{b}{c}',
          plain_meaning: '比',
          symbols: [{ symbol_latex: 'b', meaning: '分子', defined_page: 3 }],
        },
      ],
    },
    { title: '出力', explanation: '確率を出す', evidence: [], figures: [], equations: [] },
  ],
}

export const step3: Step3 = {
  prompts: ['主張は十分に支えられているか？'],
  pros: [{ text: '実装が単純', origin: 'paper', evidence: [{ page: 4, quote: 'simple', verified: true }] }],
  cons: [{ text: '計算量が大きい', origin: 'ai_inference', evidence: [] }],
  limitations: [],
  alternatives: [{ name: 'RNN', description: '逐次処理', comparison: '遅い', origin: 'ai_inference', evidence: [] }],
  likely_questions: [{ question: '弱点は？', hint: '5節を読む' }],
}

export const answer: Message = {
  role: 'assistant',
  text: '論文の4ページに書かれています',
  source: 'paper',
  evidence: [{ page: 4, quote: 'simple', verified: true }],
  confidence: 'high',
  created_at: '2026-11-05T00:00:00Z',
}

export const paper: Paper = {
  id: '0123456789abcdef',
  filename: 'sample.pdf',
  level: 'undergrad',
  lang: 'ja',
  page_count: 3,
  status: 'done',
  error: null,
  demo: true,
  results: { step1, step2, step3 },
  messages: [],
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 流れ図つきの Step 2（段階は step2 と同じ2つ） */
export const step2WithFlow: Step2 = {
  ...step2,
  flow: {
    nodes: [
      { id: 'in', label: '入力の単語', kind: 'input', shape: 'n×d', evidence: [{ page: 2, quote: 'we embed tokens', verified: true }] },
      {
        id: 'out',
        label: '特徴量ベース手法とファインチューニング手法の確率',
        kind: 'output',
        shape: null,
        evidence: [{ page: 5, quote: 'we output a distribution' }],
      },
    ],
    edges: [{ from: 'in', to: 'out', label: 'Q, K, V' }],
    frames: [
      {
        stage_index: 0,
        active_nodes: ['in'],
        active_edges: [],
        caption: '単語をベクトルにする',
        evidence: [{ page: 2, quote: 'we embed tokens' }],
      },
      {
        stage_index: 1,
        active_nodes: ['out'],
        active_edges: ['in->out'],
        caption: '語彙の確率を計算する',
        evidence: [{ page: 6, quote: 'softmax over vocabulary' }],
      },
    ],
  },
}
