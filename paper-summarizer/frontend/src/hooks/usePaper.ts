import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Paper, type Progress, type ProgressEvent } from '../api'

export const POLL_MS = 1500
export const MAX_BACKOFF_MS = 30_000
/** 接続してから最初の知らせがこの時間内に届かなければ、問い合わせに切り替える（Hosting が応答をためる場合など） */
export const FIRST_EVENT_MS = 5000

const isFinished = (p: { status: string }) => p.status === 'done' || p.status === 'failed' || p.status === 'cancelled'

/** 論文を取り直す目印。状態か、終わった Step の組が変わったら結果が増えている */
const changeKey = (e: ProgressEvent) => {
  const done = Object.entries((e.progress ?? {}) as Progress)
    .filter(([, s]) => s?.phase === 'done')
    .map(([k]) => k)
    .sort()
  return `${e.status}|${done.join(',')}`
}

function parseEvent(data: string): ProgressEvent | null {
  try {
    const e = JSON.parse(data) as ProgressEvent
    return e && typeof e.status === 'string' ? e : null
  } catch {
    return null
  }
}

export type PaperState = {
  paper: Paper | null
  /** 直近の取得に失敗したときのメッセージ（読み込み済みの paper は残す） */
  error: string | null
  notFound: boolean
  /** すぐに取得し直し、解析中ならポーリングを再開する */
  refresh: () => void
}

/**
 * 論文を取得し、解析中は更新を受け取る。
 * 解析中は SSE（/events）で進捗を受け取り、最初の知らせが FIRST_EVENT_MS 以内に届かない・エラーになったときは
 * 1.5 秒ごとの問い合わせ（ポーリング）に切り替える。どちらでも paper.progress に同じ形の進捗が入る。
 * 問い合わせは失敗したら間隔を倍にしながら再試行する（最大 30 秒）。
 */
export function usePaper(id: string): PaperState {
  const [paper, setPaper] = useState<Paper | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    // 実行中の取得ループの状態（effect ごとに作り直す）
    const loop = {
      alive: true,
      timer: undefined as number | undefined,
      failures: 0,
      /** SSE の状態: off=使わない（ポーリング）、on=つないでいる */
      sse: 'idle' as 'idle' | 'on' | 'off',
      source: null as EventSource | null,
      firstTimer: undefined as number | undefined,
      lastKey: '',
    }

    const closeSource = () => {
      window.clearTimeout(loop.firstTimer)
      loop.source?.close()
      loop.source = null
    }
    const fallbackToPolling = () => {
      closeSource()
      if (loop.sse === 'off') return
      loop.sse = 'off'
      window.clearTimeout(loop.timer)
      void tick()
    }
    const open = () => {
      const source = new EventSource(api.eventsUrl(id))
      loop.source = source
      let received = false
      loop.firstTimer = window.setTimeout(fallbackToPolling, FIRST_EVENT_MS)
      source.onmessage = (m) => {
        if (!loop.alive || loop.source !== source) return
        window.clearTimeout(loop.firstTimer)
        received = true
        const e = parseEvent(m.data)
        if (!e) return
        const key = changeKey(e)
        if (isFinished(e)) {
          closeSource()
          loop.sse = 'off'
          void tick()
        } else if (key !== loop.lastKey) {
          loop.lastKey = key
          void tick()
        } else {
          setPaper((prev) => (prev ? { ...prev, status: e.status, progress: e.progress } : prev))
        }
      }
      source.onerror = () => {
        if (!loop.alive || loop.source !== source) return
        if (received) {
          // 動いていた接続が、サーバーの時間制限などで閉じた。つなぎ直す（つながらなければ問い合わせへ）
          closeSource()
          open()
        } else {
          fallbackToPolling()
        }
      }
    }

    const tick = async () => {
      try {
        const p = await api.get(id)
        if (!loop.alive) return
        loop.failures = 0
        setPaper(p)
        setError(null)
        setNotFound(false)
        if (isFinished(p)) return
        if (loop.sse === 'idle' && typeof EventSource !== 'undefined') {
          loop.sse = 'on'
          loop.lastKey = changeKey({ status: p.status, progress: p.progress ?? null })
          open()
        } else if (loop.sse !== 'on') {
          loop.timer = window.setTimeout(tick, POLL_MS)
        }
      } catch (e) {
        if (!loop.alive) return
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true)
          return
        }
        loop.failures += 1
        setError((e as Error).message)
        loop.timer = window.setTimeout(tick, Math.min(POLL_MS * 2 ** loop.failures, MAX_BACKOFF_MS))
      }
    }
    if (typeof EventSource === 'undefined') loop.sse = 'off'
    tick()
    return () => {
      loop.alive = false
      window.clearTimeout(loop.timer)
      closeSource()
    }
  }, [id, generation])

  const refresh = useCallback(() => setGeneration((g) => g + 1), [])
  return { paper, error, notFound, refresh }
}
