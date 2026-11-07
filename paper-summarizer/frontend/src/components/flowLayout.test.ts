import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowNode } from '../api'
import {
  FLOW_COL_GAP,
  FLOW_EDGE_LABEL_MAX,
  FLOW_EDGE_LABEL_PX,
  FLOW_NODE_H,
  FLOW_NODE_W,
  edgeKey,
  flowEdgePath,
  layoutFlow,
} from './flowLayout'

const node = (id: string, kind: FlowNode['kind'] = 'process'): FlowNode => ({ id, label: id, kind, shape: null, evidence: [] })
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
