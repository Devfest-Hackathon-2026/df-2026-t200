import type { Concept } from '../api'

export const NODE_W = 176
export const NODE_H = 58
export const COL_GAP = 44
export const ROW_GAP = 18
export const PAD = 12

/** 狭い画面では層を上から下へ並べ、1行に2つまで置く */
export const NARROW_NODE_W = 150
export const NARROW_PER_ROW = 2
export const NARROW_COL_GAP = 16
export const LAYER_GAP = 44

type Point = { x: number; y: number }
export type ConceptLayout = {
  pos: Map<string, Point>
  width: number
  height: number
  nodeW: number
  nodeH: number
  vertical: boolean
}

/** 概念が前提にしている、実在する別の概念。自分自身を前提に挙げていても無視する */
const prereqs = (c: Concept, exists: (id: string) => boolean) => c.depends_on.filter((d) => d !== c.id && exists(d))

/** 依存の深さ（前提が何段あるか）。循環は打ち切る */
function depths(concepts: Concept[]): Map<string, number> {
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const depth = new Map<string, number>()
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (stack.has(id)) return 0
    stack.add(id)
    const c = byId.get(id)
    const d = c ? Math.max(0, ...prereqs(c, (x) => byId.has(x)).map((x) => visit(x, stack) + 1)) : 0
    stack.delete(id)
    depth.set(id, d)
    return d
  }
  concepts.forEach((c) => visit(c.id, new Set()))
  return depth
}

/**
 * 各層の並び順を、つながった相手の位置の平均（重心）で並べ替え、矢印の交差を減らす。
 * 前の層を見て並べる → 後ろの層を見て並べる、を数回くり返す。相手がいない概念は今の位置を保つ。
 */
export function orderLayers(layers: Concept[][], concepts: Concept[]): Concept[][] {
  const ids = new Set(concepts.map((c) => c.id))
  const preds = new Map(concepts.map((c) => [c.id, prereqs(c, (d) => ids.has(d))]))
  const succs = new Map<string, string[]>(concepts.map((c) => [c.id, []]))
  concepts.forEach((c) => preds.get(c.id)!.forEach((d) => succs.get(d)!.push(c.id)))
  const result = layers.map((l) => [...(l ?? [])])
  const indexOf = () => new Map(result.flatMap((l) => l.map((c, i) => [c.id, i] as const)))
  const sortBy = (layer: Concept[], neighbors: (id: string) => string[]) => {
    const idx = indexOf()
    const key = (c: Concept, i: number) => {
      const ns = neighbors(c.id).filter((n) => idx.has(n))
      return ns.length ? ns.reduce((s, n) => s + idx.get(n)!, 0) / ns.length : i
    }
    return layer
      .map((c, i) => ({ c, k: key(c, i), i }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .map((x) => x.c)
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < result.length; i++) result[i] = sortBy(result[i], (id) => preds.get(id) ?? [])
    for (let i = result.length - 2; i >= 0; i--) result[i] = sortBy(result[i], (id) => succs.get(id) ?? [])
  }
  return result
}

/** 依存関係から層（深さ）を決める。基礎的な概念が左（狭い画面では上）、論文の中心に近い概念が右（下）に並ぶ。 */
export function layoutConcepts(concepts: Concept[], vertical = false): ConceptLayout {
  const depth = depths(concepts)
  const raw: Concept[][] = []
  concepts.forEach((c) => (raw[depth.get(c.id) ?? 0] ??= []).push(c))
  const layers = orderLayers(
    Array.from(raw, (l) => l ?? []),
    concepts,
  )
  const pos = new Map<string, Point>()
  const span = (n: number, size: number, gap: number) => n * size + Math.max(0, n - 1) * gap

  if (!vertical) {
    layers.forEach((col, ci) =>
      col.forEach((c, ri) => pos.set(c.id, { x: PAD + ci * (NODE_W + COL_GAP), y: PAD + ri * (NODE_H + ROW_GAP) })),
    )
    const rows = Math.max(1, ...layers.map((c) => c.length))
    return {
      pos,
      width: PAD * 2 + span(layers.length, NODE_W, COL_GAP),
      height: PAD * 2 + span(rows, NODE_H, ROW_GAP),
      nodeW: NODE_W,
      nodeH: NODE_H,
      vertical,
    }
  }

  const inner = span(NARROW_PER_ROW, NARROW_NODE_W, NARROW_COL_GAP)
  let y = PAD
  layers.forEach((layer, li) => {
    if (li > 0 && layer.length) y += LAYER_GAP - ROW_GAP
    for (let r = 0; r < layer.length; r += NARROW_PER_ROW) {
      const row = layer.slice(r, r + NARROW_PER_ROW)
      const left = PAD + (inner - span(row.length, NARROW_NODE_W, NARROW_COL_GAP)) / 2
      row.forEach((c, k) => pos.set(c.id, { x: left + k * (NARROW_NODE_W + NARROW_COL_GAP), y }))
      y += NODE_H + ROW_GAP
    }
  })
  return {
    pos,
    width: PAD * 2 + inner,
    height: Math.max(PAD * 2 + NODE_H, y - ROW_GAP + PAD),
    nodeW: NARROW_NODE_W,
    nodeH: NODE_H,
    vertical,
  }
}

/** 楕円（線は節点の枠より少し内側）。閉じた滑らかな線で、ごくわずかに歪ませて手描きらしくする */
export function ovalPath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5523
  const t = { x: cx + 1, y: cy - ry }
  const r = { x: cx + rx, y: cy + 0.5 }
  const b = { x: cx - 1, y: cy + ry }
  const l = { x: cx - rx, y: cy - 0.5 }
  const f = (n: number) => n.toFixed(1)
  return (
    `M${f(l.x)},${f(l.y)} ` +
    `C${f(l.x)},${f(l.y - k * ry)} ${f(t.x - k * rx)},${f(t.y)} ${f(t.x)},${f(t.y)} ` +
    `C${f(t.x + k * rx)},${f(t.y)} ${f(r.x)},${f(r.y - k * ry)} ${f(r.x)},${f(r.y)} ` +
    `C${f(r.x)},${f(r.y + k * ry)} ${f(b.x + k * rx)},${f(b.y)} ${f(b.x)},${f(b.y)} ` +
    `C${f(b.x - k * rx)},${f(b.y)} ${f(l.x)},${f(l.y + k * ry)} ${f(l.x)},${f(l.y)}Z`
  )
}

export type Edge = { from: string; to: string; d: string }

/**
 * 矢印の線を作る。端は楕円の線の上に置き、同じ概念から出る（入る）矢印は辺に沿って少しずつずらす。
 * ずらす順番は相手の位置の順にそろえるので、端の近くで線が交差しない。
 */
export function edgePaths(concepts: Concept[], layout: ConceptLayout, inset = 3): Edge[] {
  const { pos, nodeW, nodeH, vertical } = layout
  const rx = nodeW / 2 - inset
  const ry = nodeH / 2 - inset
  const center = (id: string) => ({ x: pos.get(id)!.x + nodeW / 2, y: pos.get(id)!.y + nodeH / 2 })
  const pairs = concepts.flatMap((c) => (pos.has(c.id) ? prereqs(c, (d) => pos.has(d)).map((d) => ({ from: d, to: c.id })) : []))
  // 相手の位置（横並びなら y、縦並びなら x）で並べ、-1〜1 の位置を割り当てる
  const along = (p: Point) => (vertical ? p.x : p.y)
  const slots = (key: 'from' | 'to') => {
    const groups = new Map<string, { other: string; i: number }[]>()
    pairs.forEach((p, i) => {
      const self = p[key]
      const other = key === 'from' ? p.to : p.from
      ;(groups.get(self) ?? groups.set(self, []).get(self)!).push({ other, i })
    })
    const out = new Map<number, number>()
    groups.forEach((g) => {
      g.sort((a, b) => along(center(a.other)) - along(center(b.other)))
      g.forEach((e, j) => out.set(e.i, g.length === 1 ? 0 : -1 + (2 * j) / (g.length - 1)))
    })
    return out
  }
  const outSlot = slots('from')
  const inSlot = slots('to')
  // 楕円の辺の上の点。side=1 なら右（下）、-1 なら左（上）
  const port = (id: string, slot: number, side: 1 | -1): Point => {
    const c = center(id)
    if (vertical) {
      const dx = slot * rx * 0.4
      return { x: c.x + dx, y: c.y + side * ry * Math.sqrt(1 - (dx / rx) ** 2) }
    }
    const dy = slot * ry * 0.45
    return { x: c.x + side * rx * Math.sqrt(1 - (dy / ry) ** 2), y: c.y + dy }
  }
  // 矢印の出入りの向き。基本は層の並ぶ向き（横または縦）で、楕円の法線へ少しだけ傾けて、矢じりが線に沿って当たるようにする
  const direction = (id: string, p: Point, side: 1 | -1): Point => {
    const c = center(id)
    const nx = (p.x - c.x) / rx ** 2
    const ny = (p.y - c.y) / ry ** 2
    const nl = Math.hypot(nx, ny) || 1
    const base = vertical ? { x: 0, y: side } : { x: side, y: 0 }
    const x = base.x + (0.35 * nx) / nl
    const y = base.y + (0.35 * ny) / nl
    const l = Math.hypot(x, y)
    return { x: x / l, y: y / l }
  }
  const f = (n: number) => n.toFixed(1)
  return pairs.map((p, i) => {
    const a = port(p.from, outSlot.get(i)!, 1)
    const b = port(p.to, inSlot.get(i)!, -1)
    const na = direction(p.from, a, 1)
    const nb = direction(p.to, b, -1)
    const reach = Math.max(16, (vertical ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x)) / 2)
    const c1 = { x: a.x + na.x * reach, y: a.y + na.y * reach }
    const c2 = { x: b.x + nb.x * reach, y: b.y + nb.y * reach }
    return { ...p, d: `M${f(a.x)},${f(a.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(b.x)},${f(b.y)}` }
  })
}
