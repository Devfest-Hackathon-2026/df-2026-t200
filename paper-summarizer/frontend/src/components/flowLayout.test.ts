import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowNode } from '../api'
import {
  FLOW_COL_GAP,
  FLOW_EDGE_LABEL_MAX,
  FLOW_EDGE_LABEL_PX,
  FLOW_NODE_H,
  FLOW_NODE_W,
  FLOW_PAD,
  edgeKey,
  flowEdgePath,
  layoutFlow,
} from './flowLayout'

const node = (id: string, kind: FlowNode['kind'] = 'process'): FlowNode => ({ id, label: id, kind, shape: null, evidence: [] })
const gnode = (id: string, group: string | null, kind: FlowNode['kind'] = 'process'): FlowNode => ({ ...node(id, kind), group })
const edge = (from: string, to: string): FlowEdge => ({ from, to, label: '' })

describe('layoutFlow', () => {
  it('puts layers left to right following the edges', () => {
    const l = layoutFlow([node('a', 'input'), node('b'), node('c', 'output')], [edge('a', 'b'), edge('b', 'c')])
    const x = (id: string) => l.pos.get(id)!.x
    expect(x('a')).toBeLessThan(x('b'))
    expect(x('b')).toBeLessThan(x('c'))
  })

  it('stacks nodes of the same layer vertically and grows the canvas', () => {
    const l = layoutFlow(
      [node('a', 'input'), node('b'), node('c'), node('d', 'output')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    )
    expect(l.pos.get('b')!.x).toBe(l.pos.get('c')!.x)
    expect(l.pos.get('b')!.y).not.toBe(l.pos.get('c')!.y)
    expect(l.height).toBeGreaterThan(2 * FLOW_NODE_H)
    expect(l.width).toBeGreaterThan(3 * FLOW_NODE_W)
  })

  it('does not hang on cycles and still places every node', () => {
    const l = layoutFlow([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')])
    expect(l.pos.size).toBe(2)
  })

  it('places unconnected inputs first and outputs last', () => {
    const l = layoutFlow([node('o', 'output'), node('i', 'input'), node('m'), node('n')], [edge('m', 'n')])
    expect(l.pos.get('i')!.x).toBeLessThanOrEqual(l.pos.get('m')!.x)
    expect(l.pos.get('o')!.x).toBeGreaterThanOrEqual(l.pos.get('n')!.x)
  })

  it('ignores edges to unknown nodes', () => {
    const l = layoutFlow([node('a'), node('b')], [edge('a', 'zzz'), edge('a', 'b')])
    expect(l.pos.size).toBe(2)
  })
})

describe('flowEdgePath', () => {
  it('goes from the right side of the source to the left side of the target', () => {
    const nodes = [node('a', 'input'), node('b')]
    const l = layoutFlow(nodes, [edge('a', 'b')])
    const d = flowEdgePath(edge('a', 'b'), l)!
    const a = l.pos.get('a')!
    expect(d.startsWith(`M${(a.x + FLOW_NODE_W).toFixed(1)},${(a.y + FLOW_NODE_H / 2).toFixed(1)}`)).toBe(true)
  })

  it('returns null for unknown nodes and has a stable key', () => {
    const l = layoutFlow([node('a')], [])
    expect(flowEdgePath(edge('a', 'x'), l)).toBeNull()
    expect(edgeKey(edge('a', 'b'))).toBe('a->b')
  })
})

describe('flow column gap', () => {
  it('leaves room for an edge label of full-width characters between two nodes', () => {
    expect(FLOW_COL_GAP).toBeGreaterThanOrEqual(FLOW_EDGE_LABEL_MAX * FLOW_EDGE_LABEL_PX + 8)
  })
})

describe('layoutFlow: branches and merges', () => {
  it('puts parallel paths in one column, one above the other, and the merge to their right', () => {
    const l = layoutFlow(
      [node('in', 'input'), node('w0'), node('ba'), node('sum'), node('out', 'output')],
      [edge('in', 'w0'), edge('in', 'ba'), edge('w0', 'sum'), edge('ba', 'sum'), edge('sum', 'out')],
    )
    const p = (id: string) => l.pos.get(id)!
    expect(p('w0').x).toBe(p('ba').x)
    expect(Math.abs(p('w0').y - p('ba').y)).toBeGreaterThanOrEqual(FLOW_NODE_H)
    expect(p('sum').x).toBeGreaterThan(p('w0').x)
  })

  it('orders a column so that parallel paths do not cross', () => {
    // 上の経路 a1->a2、下の経路 b1->b2。宣言順を逆にしても交差させない
    const nodes = [node('in', 'input'), node('a1'), node('b1'), node('b2'), node('a2'), node('out', 'output')]
    const edges = [edge('in', 'a1'), edge('in', 'b1'), edge('b1', 'b2'), edge('a1', 'a2'), edge('a2', 'out'), edge('b2', 'out')]
    const l = layoutFlow(nodes, edges)
    const y = (id: string) => l.pos.get(id)!.y
    expect(Math.sign(y('a1') - y('b1'))).toBe(Math.sign(y('a2') - y('b2')))
  })

  it('does not change the positions or size of a flow without groups', () => {
    const l = layoutFlow([node('a', 'input'), node('b')], [edge('a', 'b')])
    expect(l.bands).toEqual([])
    expect(l.pos.get('a')).toEqual({ x: FLOW_PAD, y: FLOW_PAD })
    expect(l.height).toBe(FLOW_PAD * 2 + FLOW_NODE_H)
  })
})

describe('layoutFlow: group bands', () => {
  const nodes = [gnode('a', '事前学習', 'input'), gnode('b', '事前学習'), gnode('c', '微調整'), gnode('d', '微調整', 'output')]
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]

  it('makes one labelled band per group, in order of first appearance, that encloses its nodes', () => {
    const l = layoutFlow(nodes, edges)
    expect(l.bands.map((b) => b.group)).toEqual(['事前学習', '微調整'])
    for (const b of l.bands) {
      for (const n of nodes.filter((x) => x.group === b.group)) {
        const p = l.pos.get(n.id)!
        expect(p.x).toBeGreaterThan(b.x)
        expect(p.x + FLOW_NODE_W).toBeLessThan(b.x + b.w)
        expect(p.y).toBeGreaterThan(b.y)
        expect(p.y + FLOW_NODE_H).toBeLessThan(b.y + b.h)
      }
    }
  })

  it('keeps bands inside the canvas and does not overlap bands of different groups here', () => {
    const l = layoutFlow(nodes, edges)
    const [x, y] = [l.bands[0], l.bands[1]]
    expect(x.x).toBeGreaterThanOrEqual(0)
    expect(x.y).toBeGreaterThanOrEqual(0)
    for (const b of l.bands) {
      expect(b.x + b.w).toBeLessThanOrEqual(l.width)
      expect(b.y + b.h).toBeLessThanOrEqual(l.height)
    }
    expect(x.x + x.w <= y.x || y.x + y.w <= x.x || x.y + x.h <= y.y || y.y + y.h <= x.y).toBe(true)
  })

  it('stacks groups that share a column without overlapping their bands', () => {
    const ns = [gnode('i', null, 'input'), gnode('t', '学習'), gnode('f', '推論'), gnode('o', null, 'output')]
    const l = layoutFlow(ns, [edge('i', 't'), edge('i', 'f'), edge('t', 'o'), edge('f', 'o')])
    const [a, b] = l.bands
    expect(a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
  })

  it('ignores empty and non-string groups (old or broken results)', () => {
    const ns = [{ ...node('a', 'input'), group: '' }, { ...node('b'), group: null }, node('c')]
    expect(layoutFlow(ns, [edge('a', 'b'), edge('b', 'c')]).bands).toEqual([])
  })

  it('puts the label of a band that overlaps an earlier band at its bottom edge', () => {
    // 層をまたいで段階が入れ違う: A は層0と層2、B は層1（A の外接矩形が B を含む）
    const ns = [gnode('a1', 'A', 'input'), gnode('b1', 'B'), gnode('a2', 'A', 'output')]
    const l = layoutFlow(ns, [edge('a1', 'b1'), edge('b1', 'a2')])
    const [a, b] = l.bands
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    expect(overlap).toBe(true)
    expect([a.labelBelow, b.labelBelow]).toEqual([false, true])
  })

  it('keeps labels on top when bands do not overlap', () => {
    expect(layoutFlow(nodes, edges).bands.map((b) => b.labelBelow)).toEqual([false, false])
  })
})
