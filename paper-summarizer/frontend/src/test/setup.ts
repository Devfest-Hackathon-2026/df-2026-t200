import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { api } from '../api'

// 確認モードの保存済み問題の取得は、既定では何も無い扱いにする（各テストで必要なら上書きする）
beforeEach(() => {
  vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

// jsdom には scrollIntoView がない
Element.prototype.scrollIntoView = vi.fn()

// jsdom には matchMedia がない（既定は広い画面として扱う）
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList
