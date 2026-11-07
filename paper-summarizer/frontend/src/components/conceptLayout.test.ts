import { describe, expect, it } from 'vitest'
import type { Concept } from '../api'
import { step1 } from '../test/fixtures'
import { COL_GAP, NARROW_NODE_W, NODE_H, NODE_W, PAD, ROW_GAP, edgePaths, layoutConcepts, nodeLabelSize, ovalPath } from './conceptLayout'

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

  it('orders each column so that arrows do not cross', () => {
    // 入力順のままだと a→d と b→c が交差する。並べ替えると c と d が入れ替わる
    const concepts = [concept('a'), concept('b'), concept('c', ['b']), concept('d', ['a'])]
    const { pos } = layoutConcepts(concepts)
    expect(pos.get('a')!.y).toBeLessThan(pos.get('b')!.y)
    expect(pos.get('d')!.y).toBeLessThan(pos.get('c')!.y)
  })

  it('stacks layers top to bottom and fits two concepts per row on narrow screens', () => {
    const concepts = [concept('a'), concept('b'), concept('c'), concept('d', ['a', 'b', 'c'])]
    const { pos, width, nodeW, vertical } = layoutConcepts(concepts, true)
    expect(vertical).toBe(true)
    expect(nodeW).toBe(NARROW_NODE_W)
    for (const p of pos.values()) expect(p.x + nodeW).toBeLessThanOrEqual(width - PAD)
    expect(pos.get('c')!.y).toBeGreaterThan(pos.get('a')!.y)
    expect(pos.get('d')!.y).toBeGreaterThan(pos.get('c')!.y)
  })
})

describe('edgePaths', () => {
  const end = (d: string) =>
    d
      .match(/(-?[\d.]+),(-?[\d.]+)$/)!
      .slice(1)
      .map(Number)
  const start = (d: string) =>
    d
      .match(/^M(-?[\d.]+),(-?[\d.]+)/)!
      .slice(1)
      .map(Number)

  it('starts and ends each arrow on the ellipse and never shares an endpoint', () => {
    const concepts = [concept('a'), concept('b'), concept('c', ['a', 'b']), concept('d', ['a'])]
    const layout = layoutConcepts(concepts)
    const edges = edgePaths(concepts, layout)
    expect(edges).toHaveLength(3)
    const onEllipse = (id: string, [x, y]: number[]) => {
      const p = layout.pos.get(id)!
      const rx = layout.nodeW / 2 - 3
      const ry = layout.nodeH / 2 - 3
      return ((x - p.x - layout.nodeW / 2) / rx) ** 2 + ((y - p.y - layout.nodeH / 2) / ry) ** 2
    }
    for (const e of edges) {
      expect(onEllipse(e.from, start(e.d))).toBeCloseTo(1, 1)
      expect(onEllipse(e.to, end(e.d))).toBeCloseTo(1, 1)
    }
    const starts = edges.filter((e) => e.from === 'a').map((e) => start(e.d).join())
    expect(new Set(starts).size).toBe(2)
    const ends = edges.filter((e) => e.to === 'c').map((e) => end(e.d).join())
    expect(new Set(ends).size).toBe(2)
  })

  it('ignores a concept that lists itself as a prerequisite', () => {
    const concepts = [concept('a', ['a']), concept('b', ['a', 'b'])]
    const layout = layoutConcepts(concepts)
    expect(layout.pos.get('a')!.x).toBe(PAD)
    expect(layout.pos.get('b')!.x).toBe(PAD + NODE_W + COL_GAP)
    expect(edgePaths(concepts, layout).map((e) => `${e.from}-${e.to}`)).toEqual(['a-b'])
  })

  it('runs downward on narrow screens', () => {
    const concepts = [concept('a'), concept('b', ['a'])]
    const [e] = edgePaths(concepts, layoutConcepts(concepts, true))
    expect(end(e.d)[1]).toBeGreaterThan(start(e.d)[1])
  })
})

describe('ovalPath', () => {
  it('is a closed path without an overshooting tail', () => {
    const d = ovalPath(50, 20, 40, 15)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toContain('L')
  })
})

describe('nodeLabelSize', () => {
  it('shrinks the label as the name gets longer', () => {
    expect(nodeLabelSize('内積')).toBe('')
    expect(nodeLabelSize('Self-Attention')).toBe('long')
    expect(nodeLabelSize('特徴量ベース手法とファインチューニング手法')).toBe('xlong')
  })
})
