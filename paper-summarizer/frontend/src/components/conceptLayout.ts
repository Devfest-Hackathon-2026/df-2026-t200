import type { Concept } from '../api'

export const NODE_W = 176
export const NODE_H = 58
export const COL_GAP = 44
export const ROW_GAP = 18
export const PAD = 12

export type ConceptLayout = { pos: Map<string, { x: number; y: number }>; width: number; height: number }

/** 依存関係から列（深さ）を決める。基礎的な概念が左、論文の中心に近い概念が右に並ぶ。 */
export function layoutConcepts(concepts: Concept[]): ConceptLayout {
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const depth = new Map<string, number>()
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (stack.has(id)) return 0 // 循環は打ち切る
    stack.add(id)
    const c = byId.get(id)
    const d = c ? Math.max(0, ...c.depends_on.filter((x) => byId.has(x)).map((x) => visit(x, stack) + 1)) : 0
    stack.delete(id)
    depth.set(id, d)
    return d
  }
  concepts.forEach((c) => visit(c.id, new Set()))
  const cols: Concept[][] = []
  concepts.forEach((c) => {
    const d = depth.get(c.id) ?? 0
    ;(cols[d] ??= []).push(c)
  })
  const pos = new Map<string, { x: number; y: number }>()
  cols.forEach((col, ci) => col.forEach((c, ri) => pos.set(c.id, { x: PAD + ci * (NODE_W + COL_GAP), y: PAD + ri * (NODE_H + ROW_GAP) })))
  const rows = Math.max(1, ...cols.map((c) => c?.length ?? 0))
  const span = (n: number, size: number, gap: number) => n * size + Math.max(0, n - 1) * gap
  return {
    pos,
    width: PAD * 2 + span(cols.length, NODE_W, COL_GAP),
    height: PAD * 2 + span(rows, NODE_H, ROW_GAP),
  }
}

/** マーカーで描いたような楕円（書き終わりが少し重なる）。中心 (cx, cy)、半径 rx, ry */
export function ovalPath(cx: number, cy: number, rx: number, ry: number): string {
  const x = (v: number) => (cx + (v / 78) * rx).toFixed(1)
  const y = (v: number) => (cy + (v / 28) * ry).toFixed(1)
  return (
    `M${x(-75)},${y(-3)} C${x(-77)},${y(-17)} ${x(-43)},${y(-29)} ${x(2)},${y(-27)} ` +
    `C${x(43)},${y(-27.5)} ${x(80)},${y(-14)} ${x(78)},${y(1)} ` +
    `C${x(77)},${y(17)} ${x(39)},${y(29.5)} ${x(-2)},${y(28)} ` +
    `C${x(-43)},${y(27)} ${x(-79)},${y(13)} ${x(-77)},${y(-5)} L${x(-69)},${y(-17)}`
  )
}
