import { describe, expect, it } from 'vitest'
import { step1, step2 } from '../test/fixtures'
import { conceptsOfEquation, equationsUsing } from './equationLinks'

describe('equationLinks', () => {
  it('lists the equations that use a concept, with stage index, page and label', () => {
    expect(equationsUsing(step2, 'attention')).toEqual([{ stage: 0, index: 0, label: '(1)', page: 3 }])
    expect(equationsUsing(step2, 'softmax')).toEqual([])
  })

  it('returns nothing without Step 2, without concepts (old results) or with broken data', () => {
    expect(equationsUsing(undefined, 'attention')).toEqual([])
    expect(equationsUsing(null, 'attention')).toEqual([])
    const old = { ...step2, stages: [{ ...step2.stages[0], equations: [{ ...step2.stages[0].equations[0], concepts: undefined }] }] }
    expect(equationsUsing(old, 'attention')).toEqual([])
    expect(equationsUsing({ overview: '', stages: [{ title: 't' }] } as never, 'attention')).toEqual([])
  })

  it('resolves the concepts of an equation, ignoring ids that Step 1 does not have', () => {
    const eq = step2.stages[0].equations[0]
    expect(conceptsOfEquation(eq, step1.concepts).map((c) => c.id)).toEqual(['attention', 'expectation'])
    expect(conceptsOfEquation({ ...eq, concepts: undefined }, step1.concepts)).toEqual([])
    expect(conceptsOfEquation(eq, undefined)).toEqual([])
  })
})
