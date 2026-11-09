/** Q&A の欄の高さ（px）の範囲と既定値 */
export const QA_MIN = 120
/** 画面の高さに対する上限の割合 */
export const QA_MAX_RATIO = 0.75
/** 欄を大きくしても、右ペインの上の解説に最低限残す高さ（px） */
export const EXPLAIN_KEEP_PX = 180
const DEFAULT_RATIO = 0.3
const DEFAULT_MIN_PX = 200

export type QaBounds = { min: number; max: number }

/**
 * 動かせる高さの範囲。上限は画面の75%と、「右ペインの高さ - 解説以外（タブ・帯）の高さ - 解説に残す高さ」の小さい方。
 * paneHeight が 0 以下（測れない）なら画面の高さだけで決める
 */
export function qaBounds(viewportHeight: number, paneHeight: number, chromeHeight = 0): QaBounds {
  const byViewport = Math.floor(viewportHeight * QA_MAX_RATIO)
  const max = paneHeight > 0 ? Math.min(byViewport, Math.floor(paneHeight - chromeHeight - EXPLAIN_KEEP_PX)) : byViewport
  return { min: QA_MIN, max: Math.max(QA_MIN, max) }
}

export const clampQaHeight = (v: number, { min, max }: QaBounds) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : min)

/** 何も覚えていないときの高さ。右ペインの3割（最低200px）を範囲に収める */
export const defaultQaHeight = (paneHeight: number, bounds: QaBounds) =>
  clampQaHeight(Math.max(DEFAULT_MIN_PX, Math.round(paneHeight * DEFAULT_RATIO)), bounds)

/** 保存値の形。null は「覚えていない（既定の高さ）」 */
export const isQaHeight = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= QA_MIN)
