import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type Paper, type Progress } from '../api'
import { paper } from '../test/fixtures'
import { FIRST_EVENT_MS, usePaper } from './usePaper'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
  fail() {
    this.onerror?.()
  }
}

const running: Paper = { ...paper, status: 'processing_step1', results: {}, progress: null }
const writing: Progress = { step1: { phase: 'writing', chars: 1200, elapsed: 18 } }
const last = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]

describe('usePaper with server-sent events', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens the events URL for a running analysis and does not poll while events arrive', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(running)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(last().url).toBe(`/api/papers/${paper.id}/events`)
    act(() => last().emit({ status: 'processing_step1', progress: writing }))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    act(() => last().emit({ status: 'processing_step1', progress: { step1: { phase: 'writing', chars: 1500, elapsed: 21 } } }))
    expect(get).toHaveBeenCalledTimes(1)
    expect(result.current.paper?.progress?.step1?.chars).toBe(1500)
  })

  it('does not open events for a finished paper', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(result.current.paper?.status).toBe('done'))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('fetches the paper again when the status or a finished step changes', async () => {
    const step1Done = { ...running, results: { step1: paper.results.step1 }, status: 'processing_step2' as const }
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(running).mockResolvedValue(step1Done)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => last().emit({ status: 'processing_step1', progress: writing }))
    expect(get).toHaveBeenCalledTimes(1)
    act(() => last().emit({ status: 'processing_step2', progress: { step1: { phase: 'done', chars: 2000, elapsed: 30 } } }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.paper?.results.step1).toBeDefined())
    // 同じ Step が終わったままの知らせでは、取り直さない
    act(() =>
      last().emit({
        status: 'processing_step2',
        progress: { step1: { phase: 'done', chars: 2000, elapsed: 30 }, step2: { phase: 'reading', chars: 0, elapsed: 1 } },
      }),
    )
    expect(get).toHaveBeenCalledTimes(2)
    // もう片方の Step が終わったら取り直す（status が変わらなくても結果が届いている）
    act(() =>
      last().emit({
        status: 'processing_step2',
        progress: { step1: { phase: 'done', chars: 2000, elapsed: 30 }, step3: { phase: 'done', chars: 10, elapsed: 4 } },
      }),
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
  })

  it('closes the stream and fetches the final paper when the analysis finishes', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(running).mockResolvedValue(paper)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => last().emit({ status: 'done', progress: null }))
    await waitFor(() => expect(result.current.paper?.status).toBe('done'))
    expect(last().closed).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(get).toHaveBeenCalledTimes(2)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('falls back to polling when no first event arrives in time', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(running)
    renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(FIRST_EVENT_MS - 100))
    expect(last().closed).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(last().closed).toBe(true)
    const before = get.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(get.mock.calls.length).toBeGreaterThan(before + 1)
    expect(FakeEventSource.instances).toHaveLength(1) // 切り替えたあとはつなぎ直さない
  })

  it('falls back to polling when the stream errors before any event (for example 429)', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(running)
    renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => last().fail())
    expect(last().closed).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(get.mock.calls.length).toBeGreaterThan(2)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('reconnects once when a working stream is closed by the server time limit', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(running)
    renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => last().emit({ status: 'processing_step1', progress: writing }))
    act(() => last().fail())
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[0].closed).toBe(true)
    act(() => last().emit({ status: 'processing_step1', progress: writing }))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('ignores events that are not valid JSON', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(running)
    const { result } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => last().onmessage?.({ data: 'not json' }))
    expect(result.current.paper?.status).toBe('processing_step1')
  })

  it('closes the stream on unmount', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(running)
    const { unmount } = renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    unmount()
    expect(last().closed).toBe(true)
  })

  it('uses polling when EventSource does not exist', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('EventSource', undefined)
    const get = vi.spyOn(api, 'get').mockResolvedValue(running)
    renderHook(() => usePaper(paper.id))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(() => vi.advanceTimersByTimeAsync(1600))
    expect(get).toHaveBeenCalledTimes(2)
  })
})
