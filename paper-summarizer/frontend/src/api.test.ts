import { describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { jsonResponse } from './test/fixtures'

describe('api', () => {
  it('returns parsed JSON on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ demo_mode: true }))
    await expect(api.health()).resolves.toEqual({ demo_mode: true })
    expect(fetch).toHaveBeenCalledWith('/api/health')
  })

  it('throws the server detail string on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'PDF ファイルをアップロードしてください' }, 400))
    await expect(api.get('x')).rejects.toThrow('PDF ファイルをアップロードしてください')
  })

  it('keeps the HTTP status on the thrown error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: '論文が見つかりません' }, 404))
    const err = await api.get('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
  })

  it('stringifies non-string detail (validation errors)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: [{ loc: ['body'] }] }, 422))
    await expect(api.list()).rejects.toThrow('[{"loc":["body"]}]')
  })

  it('falls back to status text when body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('oops', { status: 500, statusText: 'Internal Server Error' }))
    await expect(api.retry('x')).rejects.toThrow('500 Internal Server Error')
  })

  it('sends the same browser id when listing and uploading, so the list shows only papers from this browser', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonResponse([])))
    await api.list()
    await api.upload(new File(['%PDF'], 'a.pdf'))
    const ids = spy.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers).get('X-Client-Id'))
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(ids[1]).toBe(ids[0])
    expect(localStorage.getItem('client-id')).toBe(ids[0])
  })

  it('reuses a stored browser id and replaces a malformed one', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonResponse([])))
    localStorage.setItem('client-id', 'stored-id-0000000000')
    await api.list()
    expect(new Headers((spy.mock.calls[0][1] as RequestInit).headers).get('X-Client-Id')).toBe('stored-id-0000000000')
    localStorage.setItem('client-id', 'bad id')
    await api.list()
    expect(new Headers((spy.mock.calls[1][1] as RequestInit).headers).get('X-Client-Id')).not.toBe('bad id')
  })

  it('still sends an id when storage is unavailable', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonResponse([])))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await api.list()
    expect(new Headers((spy.mock.calls[0][1] as RequestInit).headers).get('X-Client-Id')).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  })

  it('upload sends multipart form with file and lang, leaving the level to the server', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 'a', reused: false }))
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    await api.upload(file)
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/papers')
    const body = (init as RequestInit).body as FormData
    expect(body.has('level')).toBe(false)
    expect(body.get('lang')).toBe('ja')
    expect((body.get('file') as File).name).toBe('a.pdf')
  })

  it('upload sends the chosen output language', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 'a', reused: false }))
    await api.upload(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }), 'en')
    expect(((spy.mock.calls[0][1] as RequestInit).body as FormData).get('lang')).toBe('en')
  })

  it('ask posts question and current step as JSON', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ messages: [] }))
    await api.ask('pid', '弱点は？', 3)
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/papers/pid/ask')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ question: '弱点は？', current_step: 3 })
  })

  it('pdfUrl points to the pdf endpoint', () => {
    expect(api.pdfUrl('abc')).toBe('/api/papers/abc/pdf')
  })
})
