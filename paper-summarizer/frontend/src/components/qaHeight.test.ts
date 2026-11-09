import { describe, expect, it } from 'vitest'
import { clampQaHeight, defaultQaHeight, isQaHeight, qaBounds, QA_MIN } from './qaHeight'

describe('qaBounds', () => {
  it('caps the height at 75% of the window', () => {
    expect(qaBounds(900, 0)).toEqual({ min: QA_MIN, max: 675 })
  })

  it('leaves room for the explanation inside the pane', () => {
    // 右ペインが 500px なら、解説に 180px を残して 320px まで
    expect(qaBounds(900, 500)).toEqual({ min: QA_MIN, max: 320 })
    // タブや帯が 120px あれば、その分も差し引く
    expect(qaBounds(900, 500, 120)).toEqual({ min: QA_MIN, max: 200 })
  })

  it('never lets the maximum fall below the minimum', () => {
    expect(qaBounds(100, 100)).toEqual({ min: QA_MIN, max: QA_MIN })
  })
})

describe('clampQaHeight / defaultQaHeight / isQaHeight', () => {
  const b = { min: 120, max: 600 }
  it('clamps and rounds', () => {
    expect(clampQaHeight(10, b)).toBe(120)
    expect(clampQaHeight(900, b)).toBe(600)
    expect(clampQaHeight(300.4, b)).toBe(300)
    expect(clampQaHeight(Number.NaN, b)).toBe(120)
  })

  it('uses about 30% of the pane, but at least 200px, inside the bounds', () => {
    expect(defaultQaHeight(1000, b)).toBe(300)
    expect(defaultQaHeight(400, b)).toBe(200)
    expect(defaultQaHeight(1000, { min: 120, max: 250 })).toBe(250)
  })

  it('accepts only numbers of at least the minimum, or null', () => {
    expect(isQaHeight(null)).toBe(true)
    expect(isQaHeight(300)).toBe(true)
    expect(isQaHeight(50)).toBe(false)
    expect(isQaHeight('300')).toBe(false)
    expect(isQaHeight(Number.NaN)).toBe(false)
  })
})
