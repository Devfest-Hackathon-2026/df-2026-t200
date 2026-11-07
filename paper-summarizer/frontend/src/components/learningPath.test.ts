import { describe, expect, it } from 'vitest'
import type { Concept } from '../api'
import { learningPath } from './learningPath'

const c = (id: string, depends_on: string[] = []): Concept => ({
  id,
  name: id,
  description: '',
  why_needed: '',
  first_page: null,
  depends_on,
})

describe('learningPath', () => {
  it('orders unknown concepts so that prerequisites come first', () => {
    const all = [c('c', ['b']), c('b', ['a']), c('a')]
    const r = learningPath(all, new Set(['a', 'b', 'c']))
    expect(r).toEqual({ order: ['a', 'b', 'c'], cyclic: false })
  })

  it('keeps the original order inside the same layer', () => {
    const all = [c('z'), c('y'), c('x', ['z', 'y']), c('w')]
    expect(learningPath(all, new Set(['z', 'y', 'x', 'w'])).order).toEqual(['z', 'y', 'w', 'x'])
  })

  it('lists only unknown concepts but keeps the order implied by known or hidden ones in between', () => {
    const all = [c('top', ['mid']), c('mid', ['base']), c('base')]
    expect(learningPath(all, new Set(['top', 'base'])).order).toEqual(['base', 'top'])
  })

  it('ignores self dependencies and dependencies on missing concepts', () => {
    const all = [c('a', ['a', 'ghost']), c('b', ['a'])]
    expect(learningPath(all, new Set(['a', 'b']))).toEqual({ order: ['a', 'b'], cyclic: false })
  })

  it('reports a cycle instead of an order', () => {
    const all = [c('a', ['b']), c('b', ['a']), c('free')]
    expect(learningPath(all, new Set(['a', 'b', 'free']))).toEqual({ order: [], cyclic: true })
  })

  it('ignores a cycle that does not involve any listed concept', () => {
    const all = [c('a', ['b']), c('b', ['a']), c('free')]
    expect(learningPath(all, new Set(['free']))).toEqual({ order: ['free'], cyclic: false })
  })

  it('returns an empty order for no unknown concepts and does not mutate input', () => {
    const all = [c('a')]
    const copy = JSON.parse(JSON.stringify(all))
    expect(learningPath(all, new Set())).toEqual({ order: [], cyclic: false })
    expect(all).toEqual(copy)
  })
})
