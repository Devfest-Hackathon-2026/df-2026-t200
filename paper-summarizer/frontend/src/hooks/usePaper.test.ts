import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api'
import { paper } from '../test/fixtures'
import { usePaper } from './usePaper'

const processing = { ...paper, status: 'processing_step2' as const }

describe('usePaper', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls while the analysis is running and stops when done', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(processing).mockResolvedValueOnce(paper)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(result.current.paper?.status).toBe('processing_step2'))
    await act(() => vi.advanceTimersByTimeAsync(1500))
    await waitFor(() => expect(result.current.paper?.status).toBe('done'))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded paper, reports the error and retries with backoff', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce(processing)
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(paper)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(result.current.paper).not.toBeNull())
    await act(() => vi.advanceTimersByTimeAsync(1500))
    await waitFor(() => expect(result.current.error).toBe('Failed to fetch'))
    expect(result.current.paper?.status).toBe('processing_step2')
    expect(get).toHaveBeenCalledTimes(2)
    // 1回目の失敗の後は 3 秒待つ（間隔を倍にする）
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(get).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(get).toHaveBeenCalledTimes(3)
    // 2回目の失敗の後は 6 秒
    await act(() => vi.advanceTimersByTimeAsync(6000))
    await waitFor(() => expect(result.current.paper?.status).toBe('done'))
    expect(result.current.error).toBeNull()
    expect(get).toHaveBeenCalledTimes(4)
  })

  it('reports not found without retrying', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new ApiError('論文が見つかりません', 404))
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(result.current.notFound).toBe(true))
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('refresh fetches again immediately and resumes polling', async () => {
    const failed = { ...paper, status: 'failed' as const, error: 'x' }
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(failed).mockResolvedValueOnce(processing).mockResolvedValueOnce(paper)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(result.current.paper?.status).toBe('failed'))
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(get).toHaveBeenCalledTimes(1)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.paper?.status).toBe('processing_step2'))
    await act(() => vi.advanceTimersByTimeAsync(1500))
    await waitFor(() => expect(result.current.paper?.status).toBe('done'))
  })

  it('stops polling after unmount', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(processing)
    const { result, unmount } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(result.current.paper).not.toBeNull())
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(get).toHaveBeenCalledTimes(1)
  })
})
