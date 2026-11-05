/** 左ペイン（PDF）が占める幅の割合（%）。どちらのペインも読める幅を残す */
export const SPLIT_MIN = 25
export const SPLIT_MAX = 75
export const SPLIT_DEFAULT = 50

export const clampSplit = (v: number) => (Number.isFinite(v) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) : SPLIT_DEFAULT)
export const isSplit = (v: unknown): v is number => typeof v === 'number' && v >= SPLIT_MIN && v <= SPLIT_MAX
