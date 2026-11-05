import type { Concept } from '../api'

export const NODE_W = 168
export const NODE_H = 48
export const COL_GAP = 44
export const ROW_GAP = 14
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
