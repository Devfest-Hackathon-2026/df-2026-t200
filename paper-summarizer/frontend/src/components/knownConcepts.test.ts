import { describe, expect, it } from 'vitest'
import type { Concept } from '../api'
import { MEMORY_LIMIT, forget, isMemory, nameRecord, normalizeName, rememberKnown, rememberedIds } from './knownConcepts'

const c = (id: string, name: string): Concept => ({ id, name, description: '', why_needed: '', first_page: null, depends_on: [] })
const matches = (remembered: string, name: string) => rememberedIds([c('x', name)], rememberKnown([], remembered)).length === 1

describe('normalizeName', () => {
  it('lowercases and drops spaces and symbols', () => {
    expect(normalizeName(' Self-Attention ')).toBe('selfattention')
    expect(normalizeName('softmax関数!')).toBe('softmax関数')
  })
  it('turns full-width letters into plain ones', () => {
    expect(normalizeName('ＳＯＦＴＭＡＸ')).toBe('softmax')
  })
})

describe('nameRecord', () => {
  it('splits a name into full, outer and inner parts', () => {
    expect(nameRecord('自己注意機構 (Self-Attention)')).toEqual({
      full: '自己注意機構selfattention',
      outer: '自己注意機構',
      inner: ['selfattention'],
    })
  })
  it('handles full-width brackets and names without brackets', () => {
    expect(nameRecord('内積（dot product）')?.inner).toEqual(['dotproduct'])
    expect(nameRecord('内積')).toEqual({ full: '内積', outer: '内積', inner: [] })
  })
  it('returns null for names shorter than 2 characters', () => {
    expect(nameRecord('a')).toBeNull()
    expect(nameRecord('  ')).toBeNull()
  })
})

describe('matching rules', () => {
  it('(a) matches when the whole names are the same', () => {
    expect(matches('Self-Attention', 'self attention')).toBe(true)
  })
  it('(b) matches when both have an outer part and the outer parts are the same', () => {
    expect(matches('内積 (dot product)', '内積 (inner product)')).toBe(true)
    expect(matches('内積 (dot product)', '内積')).toBe(true)
  })
  it('(c) matches an inner part against the other whole name or outer part', () => {
    expect(matches('自己注意機構 (Self-Attention)', 'Self-Attention')).toBe(true)
    expect(matches('Self-Attention', '自己注意機構 (Self-Attention)')).toBe(true)
    expect(matches('自己注意機構 (Self-Attention)', 'Self-Attention (SA)')).toBe(true)
  })
  it('does not match concepts that only share the bracketed part', () => {
    expect(matches('Attention (Self-Attention)', 'Multi-Head Attention (Self-Attention)')).toBe(false)
  })
  it('does not match unrelated names', () => {
    expect(matches('内積', '期待値')).toBe(false)
  })
})

describe('remember / forget', () => {
  it('does not duplicate records and does not mutate the given list', () => {
    const mem: ReturnType<typeof rememberKnown> = []
    const once = rememberKnown(mem, '内積 (dot product)')
    expect(mem).toEqual([])
    expect(rememberKnown(once, '内積 (Dot Product)')).toHaveLength(1)
  })
  it('keeps at most MEMORY_LIMIT records, dropping the oldest', () => {
    let mem: ReturnType<typeof rememberKnown> = []
    for (let i = 0; i < MEMORY_LIMIT + 5; i++) mem = rememberKnown(mem, `概念${i}号`)
    expect(mem).toHaveLength(MEMORY_LIMIT)
    expect(mem[0].full).toBe(normalizeName('概念5号'))
    expect(mem[MEMORY_LIMIT - 1].full).toBe(normalizeName(`概念${MEMORY_LIMIT + 4}号`))
  })
  it('forget removes only the record with the same whole name', () => {
    let mem = rememberKnown([], '内積 (dot product)')
    mem = rememberKnown(mem, '内積 (inner product)')
    const after = forget(mem, '内積 (dot product)')
    expect(after.map((r) => r.full)).toEqual([normalizeName('内積 (inner product)')])
    expect(matches('内積 (inner product)', '内積')).toBe(true)
  })
  it('forget leaves a record that is only matched through a shared outer part or inner part', () => {
    const mem = rememberKnown([], 'Multi-Head Attention (Self-Attention)')
    expect(forget(mem, 'Attention (Self-Attention)')).toEqual(mem)
  })
  it('forget ignores unusable names', () => {
    const mem = rememberKnown([], '内積')
    expect(forget(mem, 'a')).toEqual(mem)
  })
})

describe('isMemory', () => {
  it('accepts only arrays of well-formed records', () => {
    expect(isMemory([{ full: 'ab', outer: 'ab', inner: [] }])).toBe(true)
    expect(isMemory([])).toBe(true)
    expect(isMemory(['selfattention'])).toBe(false)
    expect(isMemory([{ full: 'ab', outer: 'ab', inner: [1] }])).toBe(false)
    expect(isMemory([{ full: 'ab' }])).toBe(false)
    expect(isMemory({})).toBe(false)
    expect(isMemory(null)).toBe(false)
  })
})
