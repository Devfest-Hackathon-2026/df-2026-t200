import type { FlowEdge, FlowNode } from '../api'

export const FLOW_NODE_W = 150
export const FLOW_NODE_H = 66
// 矢印のラベル（最大 FLOW_EDGE_LABEL_MAX 文字、11px）が全角でもノードに隠れない間隔にする
export const FLOW_EDGE_LABEL_MAX = 8
export const FLOW_EDGE_LABEL_PX = 11
export const FLOW_COL_GAP = FLOW_EDGE_LABEL_MAX * FLOW_EDGE_LABEL_PX + 16
export const FLOW_ROW_GAP = 20
export const FLOW_PAD = 14

type Point = { x: number; y: number }
export type FlowLayout = { pos: Map<string, Point>; bands: FlowBand[]; width: number; height: number }

export const edgeKey = (e: Pick<FlowEdge, 'from' | 'to'>) => `${e.from}->${e.to}`

/** 矢印の向きに沿った層の深さ。循環は打ち切る */
function depths(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id))
  const preds = new Map(nodes.map((n) => [n.id, [] as string[]]))
  edges.forEach((e) => {
    if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) preds.get(e.to)!.push(e.from)
  })
  const depth = new Map<string, number>()
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (stack.has(id)) return 0
    stack.add(id)
    const d = Math.max(0, ...preds.get(id)!.map((p) => visit(p, stack) + 1))
    stack.delete(id)
    depth.set(id, d)
    return d
  }
  nodes.forEach((n) => visit(n.id, new Set()))
  return depth
}

// 段階（group）の帯。ラベルを帯の上端に置くので、帯が無いときは余白を足さない
export const FLOW_BAND_PAD = 8
export const FLOW_BAND_LABEL_H = 20
const BAND_TOP = FLOW_BAND_LABEL_H + FLOW_BAND_PAD

export type FlowBand = { group: string; x: number; y: number; w: number; h: number }

/** 段階の名前。空・文字列でないものは「段階なし」 */
const groupOf = (n: FlowNode): string | null => (typeof n.group === 'string' && n.group.trim() ? n.group.trim() : null)

/**
 * 同じ層の中の縦の並びを、辺の交差が減るように整える（重心法。前の層→次の層、次の層→前の層を数回往復する）。
 * 段階があれば、同じ層でも段階ごとにまとまるよう、段階の順を第一のキーにする。
 */
function orderColumns(cols: FlowNode[][], edges: FlowEdge[], groupRank: (n: FlowNode) => number) {
  const rowOf = new Map<string, number>()
  const assign = () => cols.forEach((col) => col.forEach((n, ri) => rowOf.set(n.id, ri)))
  assign()
  const sortBy = (col: FlowNode[], neighbours: (id: string) => string[]) => {
    const key = (n: FlowNode) => {
      const rows = neighbours(n.id).flatMap((id) => (rowOf.has(id) ? [rowOf.get(id)!] : []))
      return rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : rowOf.get(n.id)!
    }
    const keyed = new Map(col.map((n) => [n.id, key(n)]))
    col.sort((a, b) => groupRank(a) - groupRank(b) || keyed.get(a.id)! - keyed.get(b.id)!)
  }
  const preds = (id: string) => edges.filter((e) => e.to === id).map((e) => e.from)
  const succs = (id: string) => edges.filter((e) => e.from === id).map((e) => e.to)
  for (let pass = 0; pass < 4; pass++) {
    for (let ci = 1; ci < cols.length; ci++) {
      sortBy(cols[ci], preds)
      assign()
    }
    for (let ci = cols.length - 2; ci >= 0; ci--) {
      sortBy(cols[ci], succs)
      assign()
    }
  }
  // 最後は前から後ろへ。入力側を基準にした並びで終える
  for (let ci = 1; ci < cols.length; ci++) {
    sortBy(cols[ci], preds)
    assign()
  }
}

/** kind と edges から、入力が左・出力が右の層に並べる。分岐した経路は同じ層に縦に並べ、段階（group）があれば帯にする */
export function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]): FlowLayout {
  const depth = depths(nodes, edges)
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]))
  const last = Math.max(0, ...depth.values())
  // つながりのない入力・出力は、それぞれ左端・右端へ置く
  const layerOf = (n: FlowNode) =>
    linked.has(n.id) ? depth.get(n.id)! : n.kind === 'input' ? 0 : n.kind === 'output' ? last : depth.get(n.id)!
  const layers: FlowNode[][] = []
  nodes.forEach((n) => (layers[layerOf(n)] ??= []).push(n))
  const cols = Array.from(layers, (l) => l ?? []).filter((l) => l.length > 0)

  const groups = [...new Set(nodes.flatMap((n) => groupOf(n) ?? []))]
  const hasGroups = groups.length > 0
  // 段階なしのノードは、段階ありのノードの間で動かさない（順序の基準を 0 にそろえる）
  const groupRank = (n: FlowNode) => (hasGroups ? groups.indexOf(groupOf(n) ?? '') + 1 : 0)
  orderColumns(cols, edges, (n) => (groupOf(n) === null ? 0 : groupRank(n)))

  const rowGap = FLOW_ROW_GAP + (hasGroups ? 2 * FLOW_BAND_PAD + FLOW_BAND_LABEL_H : 0)
  const top = FLOW_PAD + (hasGroups ? BAND_TOP : 0)
  const pos = new Map<string, Point>()
  cols.forEach((col, ci) =>
    col.forEach((n, ri) => pos.set(n.id, { x: FLOW_PAD + ci * (FLOW_NODE_W + FLOW_COL_GAP), y: top + ri * (FLOW_NODE_H + rowGap) })),
  )
  const bands: FlowBand[] = groups.map((g) => {
    const ps = nodes.filter((n) => groupOf(n) === g).map((n) => pos.get(n.id)!)
    const x0 = Math.min(...ps.map((p) => p.x)) - FLOW_BAND_PAD
    const y0 = Math.min(...ps.map((p) => p.y)) - BAND_TOP
    const x1 = Math.max(...ps.map((p) => p.x)) + FLOW_NODE_W + FLOW_BAND_PAD
    const y1 = Math.max(...ps.map((p) => p.y)) + FLOW_NODE_H + FLOW_BAND_PAD
    return { group: g, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  })
  const rows = Math.max(1, ...cols.map((c) => c.length))
  return {
    pos,
    bands,
    width: FLOW_PAD * 2 + cols.length * FLOW_NODE_W + Math.max(0, cols.length - 1) * FLOW_COL_GAP,
    height: top + rows * FLOW_NODE_H + (rows - 1) * rowGap + FLOW_PAD,
  }
}

/** 始点ノードの右辺から終点ノードの左辺へ引く曲線。ノードが無ければ null */
export function flowEdgePath(e: FlowEdge, layout: FlowLayout): string | null {
  const a = layout.pos.get(e.from)
  const b = layout.pos.get(e.to)
  if (!a || !b) return null
  const x1 = a.x + FLOW_NODE_W
  const y1 = a.y + FLOW_NODE_H / 2
  const x2 = b.x
  const y2 = b.y + FLOW_NODE_H / 2
  const reach = Math.max(16, Math.abs(x2 - x1) / 2)
  const f = (n: number) => n.toFixed(1)
  return `M${f(x1)},${f(y1)} C${f(x1 + reach)},${f(y1)} ${f(x2 - reach)},${f(y2)} ${f(x2)},${f(y2)}`
}
