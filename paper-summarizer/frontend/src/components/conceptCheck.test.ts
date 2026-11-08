import { describe, expect, it } from 'vitest'
import type { Concept } from '../api'
import { pickCheckTargets, MAX_CHECK_CONCEPTS } from './conceptCheck'

const mk = (id: string, importance: Concept['importance']): Concept => ({
  id,
  name: id,
  description: '',
  why_needed: '',
  first_page: null,
  depends_on: [],
  importance,
  origin: 'paper',
  evidence: [],
})

describe('pickCheckTargets', () => {
  it('takes only concepts that are not sorted yet, essential first and then in the given order', () => {
    const cs = [mk('r1', 'recommended'), mk('e1', 'essential'), mk('a1', 'advanced'), mk('e2', 'essential')]
    expect(pickCheckTargets(cs, { e1: 'known' }).map((c) => c.id)).toEqual(['e2', 'r1', 'a1'])
  })

  it('takes at most six, keeping the more important ones', () => {
    const cs = [
      ...Array.from({ length: 5 }, (_, i) => mk(`r${i}`, 'recommended')),
      ...Array.from({ length: 4 }, (_, i) => mk(`e${i}`, 'essential')),
    ]
    const out = pickCheckTargets(cs, {})
    expect(out).toHaveLength(MAX_CHECK_CONCEPTS)
    expect(out.slice(0, 4).map((c) => c.id)).toEqual(['e0', 'e1', 'e2', 'e3'])
  })

  it('treats a concept without importance as recommended and does not change its input', () => {
    const plain = { ...mk('p', 'recommended'), importance: undefined }
    const cs = [plain, mk('e', 'essential')]
    expect(pickCheckTargets(cs, {}).map((c) => c.id)).toEqual(['e', 'p'])
    expect(cs.map((c) => c.id)).toEqual(['p', 'e'])
  })

  it('returns nothing when everything is sorted', () => {
    expect(pickCheckTargets([mk('a', 'essential')], { a: 'unknown' })).toEqual([])
  })
})
