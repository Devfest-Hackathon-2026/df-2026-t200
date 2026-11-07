/** 文ごとの回答の下書き。checked なら誤りだと思っている。page は入力欄の文字列（空なら未入力） */
export type Draft = Record<string, { checked: boolean; page: string }>
/** どの問題の下書きか（問題が新しくなったら使わない）。タブを移っても消えないよう、持ち主は App 側 */
export type QuizDraft = { quizId: string | null; entries: Draft }
export const EMPTY_DRAFT: QuizDraft = { quizId: null, entries: {} }
