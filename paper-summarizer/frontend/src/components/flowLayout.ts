import type { FlowEdge, FlowNode } from '../api'

export const FLOW_NODE_W = 150
export const FLOW_NODE_H = 66
export const FLOW_COL_GAP = 56
export const FLOW_ROW_GAP = 20
export const FLOW_PAD = 14

type Point = { x: number; y: number }
export type FlowLayout = { pos: Map<string, Point>; width: number; height: number }

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

/** kind と edges から、入力が左・出力が右の層に並べる（縦は同じ層の中で重心順） */
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
  const rowOf = new Map<string, number>()
  cols.forEach((col, ci) => {
    if (ci > 0) {
      const key = (n: FlowNode, i: number) => {
        const rows = edges.filter((e) => e.to === n.id && rowOf.has(e.from)).map((e) => rowOf.get(e.from)!)
        return rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : i
      }
      col.sort((a, b) => key(a, col.indexOf(a)) - key(b, col.indexOf(b)))
    }
    col.forEach((n, ri) => rowOf.set(n.id, ri))
  })
  const pos = new Map<string, Point>()
  cols.forEach((col, ci) =>
    col.forEach((n, ri) =>
      pos.set(n.id, { x: FLOW_PAD + ci * (FLOW_NODE_W + FLOW_COL_GAP), y: FLOW_PAD + ri * (FLOW_NODE_H + FLOW_ROW_GAP) }),
    ),
  )
  const rows = Math.max(1, ...cols.map((c) => c.length))
  return {
    pos,
    width: FLOW_PAD * 2 + cols.length * FLOW_NODE_W + Math.max(0, cols.length - 1) * FLOW_COL_GAP,
    height: FLOW_PAD * 2 + rows * FLOW_NODE_H + (rows - 1) * FLOW_ROW_GAP,
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
