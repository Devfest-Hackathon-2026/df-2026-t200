import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalStorageState } from './useLocalStorageState'

const isString = (v: unknown): v is string => typeof v === 'string'
const isRecord = (v: unknown): v is Record<string, string> => typeof v === 'object' && v !== null && !Array.isArray(v)

describe('useLocalStorageState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores a stored value that passes validation', () => {
    localStorage.setItem('k', JSON.stringify({ a: 'known' }))
    const { result } = renderHook(() => useLocalStorageState('k', {}, isRecord))
    expect(result.current[0]).toEqual({ a: 'known' })
  })

  it.each([['null'], ['[1,2]'], ['{broken'], ['"text"']])('falls back to the initial value for %s', (raw) => {
    localStorage.setItem('k', raw)
    const { result } = renderHook(() => useLocalStorageState('k', { x: 'y' }, isRecord))
    expect(result.current[0]).toEqual({ x: 'y' })
  })

  it('accepts legacy raw strings when the validator allows strings', () => {
    localStorage.setItem('k', '保存済み')
    const { result } = renderHook(() => useLocalStorageState('k', '', isString))
    expect(result.current[0]).toBe('保存済み')
  })

  it('debounces writes and saves only the last value', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useLocalStorageState('k', '', isString, 300))
    act(() => result.current[1]('a'))
    act(() => result.current[1]('ab'))
    act(() => result.current[1]((v) => v + 'c'))
    expect(result.current[0]).toBe('abc')
    expect(setItem).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(300))
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('k')).toBe('"abc"')
  })

  it('flushes a pending write on unmount', () => {
    const { result, unmount } = renderHook(() => useLocalStorageState('k', '', isString, 300))
    act(() => result.current[1]('draft'))
    unmount()
    expect(localStorage.getItem('k')).toBe('"draft"')
  })

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { result } = renderHook(() => useLocalStorageState('k', 'init', isString, 0))
    expect(result.current[0]).toBe('init')
    act(() => result.current[1]('next'))
    act(() => vi.advanceTimersByTime(0))
    expect(result.current[0]).toBe('next')
  })
})
