import { describe, expect, it } from 'vitest'
import type { Concept } from '../api'
import { step1 } from '../test/fixtures'
import { COL_GAP, NODE_H, NODE_W, PAD, ROW_GAP, layoutConcepts } from './conceptLayout'

const concept = (id: string, depends_on: string[] = []): Concept => ({
  id,
  name: id,
  description: '',
  why_needed: '',
  first_page: null,
  depends_on,
})

describe('layoutConcepts', () => {
  it('places prerequisites to the left of the concepts that depend on them', () => {
    const { pos, width, height } = layoutConcepts(step1.concepts)
    expect(pos.get('dot')!.x).toBeLessThan(pos.get('softmax')!.x)
    expect(pos.get('softmax')!.x).toBeLessThan(pos.get('attention')!.x)
    expect(width).toBe(PAD * 2 + 3 * NODE_W + 2 * COL_GAP)
    expect(height).toBe(PAD * 2 + NODE_H)
  })

  it('stacks concepts of the same depth in one column', () => {
    const { pos, height } = layoutConcepts([concept('a'), concept('b'), concept('c', ['a', 'b'])])
    expect(pos.get('a')!.x).toBe(pos.get('b')!.x)
    expect(pos.get('b')!.y).toBe(PAD + NODE_H + ROW_GAP)
    expect(height).toBe(PAD * 2 + 2 * NODE_H + ROW_GAP)
  })

  it('has a non-negative size with no concepts', () => {
    const { pos, width, height } = layoutConcepts([])
    expect(pos.size).toBe(0)
    expect(width).toBeGreaterThanOrEqual(0)
    expect(height).toBeGreaterThanOrEqual(0)
  })

  it('survives cycles and unknown dependencies', () => {
    const { pos } = layoutConcepts([concept('a', ['b']), concept('b', ['a']), concept('c', ['missing'])])
    expect(pos.size).toBe(3)
    expect(pos.get('c')!.x).toBe(PAD)
  })
})
