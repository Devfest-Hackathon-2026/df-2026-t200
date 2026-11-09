import type { StepProgress } from '../api'

const PHASE_TEXT: Record<StepProgress['phase'], string> = {
  reading: '論文を読んでいます',
  writing: '解説を書いています',
  verifying: '引用を照合しています',
  done: '完了',
}

/** 書いた文字数。100 字未満はそのまま、それ以上は百の位に丸めて「約」を付ける（0 は空） */
export function formatChars(n: number): string {
  if (n <= 0) return ''
  if (n < 100) return `${n}字`
  return `約${(Math.round(n / 100) * 100).toLocaleString('en-US')}字`
}

export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return `${s}秒`
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`
}

/** 数字を含まない、何をしているかだけの文（読み上げ用） */
export function stepLabel(n: number, phase: StepProgress['phase']): string {
  return `Step ${n}：${PHASE_TEXT[phase]}`
}

/** 画面に出す1行。例: Step 1：解説を書いています（約1,200字・18秒）。elapsed が分からなければ時間は出さない */
export function stepLine(n: number, step: StepProgress, elapsed: number | undefined): string {
  const parts = [step.phase === 'done' ? '' : formatChars(step.chars), elapsed === undefined ? '' : formatElapsed(elapsed)].filter(Boolean)
  return parts.length ? `${stepLabel(n, step.phase)}（${parts.join('・')}）` : stepLabel(n, step.phase)
}
