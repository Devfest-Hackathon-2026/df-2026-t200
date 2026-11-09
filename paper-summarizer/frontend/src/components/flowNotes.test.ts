import { describe, expect, it } from 'vitest'
import type { Flow, FlowFrame } from '../api'
import { FLOW_NOTES_MAX, frameNotes } from './flowNotes'

const node = (id: string, shape: string | null = null) => ({ id, label: id.toUpperCase(), kind: 'process' as const, shape, evidence: [] })
const frame = (active_edges: string[]): FlowFrame => ({ stage_index: 0, active_nodes: [], active_edges, caption: '', evidence: [] })

const flow: Flow = {
  nodes: [node('a', 'n×d'), node('b', 'n×d×h'), node('c', 'n×d×h'), node('d')],
  edges: [
    { from: 'a', to: 'b', label: 'Q, K, V' },
    { from: 'b', to: 'c', label: '' },
    { from: 'c', to: 'd', label: '' },
  ],
  frames: [],
}

describe('frameNotes', () => {
  it('describes what flows and how the shape changes on the active edges', () => {
    expect(frameNotes(flow, frame(['a->b']))).toEqual(['A → B：Q, K, V（形 n×d → n×d×h）'])
  })

  it('skips edges with neither a label nor a shape change, and inactive edges', () => {
    expect(frameNotes(flow, frame(['b->c', 'c->d']))).toEqual([])
    expect(frameNotes(flow, frame([]))).toEqual([])
    expect(frameNotes(flow, undefined)).toEqual([])
  })

  it('ignores edges whose nodes are missing and caps the number of notes', () => {
    const many: Flow = {
      nodes: [node('x'), node('y')],
      edges: [{ from: 'x', to: 'ghost', label: 'z' }, ...Array.from({ length: 5 }, () => ({ from: 'x', to: 'y', label: 'v' }))],
      frames: [],
    }
    const notes = frameNotes(many, frame(['x->ghost', 'x->y']))
    expect(notes).toHaveLength(FLOW_NOTES_MAX)
    expect(notes.every((n) => n === 'X → Y：v')).toBe(true)
  })
})
