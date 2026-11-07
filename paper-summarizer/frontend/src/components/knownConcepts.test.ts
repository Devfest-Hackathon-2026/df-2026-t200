import { describe, expect, it } from 'vitest'
import type { Concept } from '../api'
import { forget, isKeyList, nameKeys, normalizeName, rememberKnown, rememberedIds } from './knownConcepts'

const c = (id: string, name: string): Concept => ({ id, name, description: '', why_needed: '', first_page: null, depends_on: [] })

describe('normalizeName', () => {
  it('lowercases and drops spaces and symbols', () => {
    expect(normalizeName(' Self-Attention ')).toBe('selfattention')
    expect(normalizeName('softmax関数!')).toBe('softmax関数')
  })
  it('turns full-width letters into plain ones', () => {
    expect(normalizeName('ＳＯＦＴＭＡＸ')).toBe('softmax')
  })
})

describe('nameKeys', () => {
  it('uses the whole name, the part outside brackets and the bracketed English name', () => {
    expect(nameKeys('自己注意機構 (Self-Attention)').sort()).toEqual(['selfattention', '自己注意機構', '自己注意機構selfattention'].sort())
  })
  it('handles full-width brackets', () => {
    expect(nameKeys('内積（dot product）')).toContain('dotproduct')
  })
  it('drops keys shorter than 2 characters and returns [] for blank names', () => {
    expect(nameKeys('a')).toEqual([])
    expect(nameKeys('  ')).toEqual([])
  })
})

describe('remember / forget / match', () => {
  it('matches a concept on any shared key and does not duplicate keys', () => {
    const mem = rememberKnown(rememberKnown([], '自己注意機構 (Self-Attention)'), '自己注意機構 (Self-Attention)')
    expect(new Set(mem).size).toBe(mem.length)
    const ids = rememberedIds([c('a', 'Self-Attention'), c('b', '内積')], mem)
    expect(ids).toEqual(['a'])
  })
  it('forget removes every key of the name', () => {
    const mem = rememberKnown([], '内積 (dot product)')
    expect(forget(mem, '内積')).toEqual(mem.filter((k) => k !== '内積'))
    expect(rememberedIds([c('a', 'dot product')], forget(mem, 'Dot Product'))).toEqual([])
  })
  it('does not mutate the given list', () => {
    const mem: string[] = []
    rememberKnown(mem, '内積')
    expect(mem).toEqual([])
  })
})

describe('isKeyList', () => {
  it('accepts only arrays of strings', () => {
    expect(isKeyList(['a'])).toBe(true)
    expect(isKeyList([1])).toBe(false)
    expect(isKeyList({})).toBe(false)
  })
})
