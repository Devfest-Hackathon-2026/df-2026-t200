/** 左ペイン（PDF）が占める幅の割合（%）。どちらのペインも読める幅を残す */
export const SPLIT_MIN = 25
export const SPLIT_MAX = 75
export const SPLIT_DEFAULT = 50
/** 割合とは別に、どの画面幅でも残す幅（px）。index.css の .workspace / .pane-divider と同じ値 */
export const PDF_MIN_PX = 240
export const EXPLAIN_MIN_PX = 380
export const DIVIDER_PX = 12

export type SplitBounds = { min: number; max: number }
export const DEFAULT_BOUNDS: SplitBounds = { min: SPLIT_MIN, max: SPLIT_MAX }

/**
 * 幅 width の箱で動かせる割合の範囲。割合の上下限に加え、PDF と解説の最小幅（px）も守る。
 * 割合 s のとき PDF は s% - 境目の半分、解説は残りから境目の半分を引いた幅になる
 */
export function splitBounds(width: number): SplitBounds {
  if (!(width > 0)) return DEFAULT_BOUNDS
  const half = DIVIDER_PX / 2
  const min = Math.max(SPLIT_MIN, Math.ceil(((PDF_MIN_PX + half) / width) * 1000) / 10)
  const max = Math.min(SPLIT_MAX, Math.floor(((width - EXPLAIN_MIN_PX - half) / width) * 1000) / 10)
  return min <= max ? { min, max } : DEFAULT_BOUNDS
}

export const clampSplit = (v: number, { min, max }: SplitBounds = DEFAULT_BOUNDS) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : Math.min(max, Math.max(min, SPLIT_DEFAULT))
export const isSplit = (v: unknown): v is number => typeof v === 'number' && v >= SPLIT_MIN && v <= SPLIT_MAX
