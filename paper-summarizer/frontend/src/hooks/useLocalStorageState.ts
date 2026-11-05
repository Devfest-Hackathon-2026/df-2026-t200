import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

/** 保存値を読む。JSON として読めなければ生の文字列を候補にし（以前は文字列をそのまま保存していたため）、形を確かめる */
function read<T>(key: string, initial: T, isValid: (v: unknown) => v is T): T {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return initial
  }
  if (raw == null) return initial
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    value = raw
  }
  return isValid(value) ? value : initial
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

/**
 * localStorage に保存される state。読み込んだ値は isValid で形を確かめ、合わなければ initial を使う。
 * 書き込みは debounceMs だけ間引き、アンマウント時には保留中の値を保存する。
 */
export function useLocalStorageState<T>(
  key: string,
  initial: T,
  isValid: (v: unknown) => v is T,
  debounceMs = 300,
): [T, (next: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial, isValid))
  const pending = useRef<{ timer: number | undefined; value: T | undefined; dirty: boolean }>({
    timer: undefined,
    value: undefined,
    dirty: false,
  })

  const flush = useCallback(() => {
    const p = pending.current
    window.clearTimeout(p.timer)
    if (p.dirty) write(key, p.value)
    p.dirty = false
  }, [key])

  useEffect(() => {
    const p = pending.current
    if (!p.dirty) return
    window.clearTimeout(p.timer)
    p.timer = window.setTimeout(flush, debounceMs)
  }, [value, debounceMs, flush])

  // アンマウント・キーの切り替え・ページを閉じるときに、保留中の書き込みを済ませる
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const set = useCallback((next: SetStateAction<T>) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      pending.current.value = v
      pending.current.dirty = true
      return v
    })
  }, [])

  return [value, set]
}
