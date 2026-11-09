import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Paper } from '../api'

export const POLL_MS = 1500
export const MAX_BACKOFF_MS = 30_000

const isFinished = (p: Paper) => p.status === 'done' || p.status === 'failed' || p.status === 'cancelled'

export type PaperState = {
  paper: Paper | null
  /** 直近の取得に失敗したときのメッセージ（読み込み済みの paper は残す） */
  error: string | null
  notFound: boolean
  /** すぐに取得し直し、解析中ならポーリングを再開する */
  refresh: () => void
}

/**
 * 論文を取得し、解析中はポーリングで更新する。
 * 失敗したら間隔を倍にしながら再試行する（最大 30 秒）。
 * 本番で Firestore のリアルタイムリスナーに置き換えるときは、このフックの中身だけを差し替える。
 */
export function usePaper(id: string): PaperState {
  const [paper, setPaper] = useState<Paper | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    // 実行中の取得ループの状態（effect ごとに作り直す）
    const loop = { alive: true, timer: undefined as number | undefined, failures: 0 }
    const tick = async () => {
      try {
        const p = await api.get(id)
        if (!loop.alive) return
        loop.failures = 0
        setPaper(p)
        setError(null)
        setNotFound(false)
        if (!isFinished(p)) loop.timer = window.setTimeout(tick, POLL_MS)
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
    tick()
    return () => {
      loop.alive = false
      window.clearTimeout(loop.timer)
    }
  }, [id, generation])

  const refresh = useCallback(() => setGeneration((g) => g + 1), [])
  return { paper, error, notFound, refresh }
}
