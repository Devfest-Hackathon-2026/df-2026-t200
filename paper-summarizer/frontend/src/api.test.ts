import { describe, expect, it, vi } from 'vitest'
import { api } from './api'
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

  it('stringifies non-string detail (validation errors)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: [{ loc: ['body'] }] }, 422))
    await expect(api.list()).rejects.toThrow('[{"loc":["body"]}]')
  })

  it('falls back to status text when body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('oops', { status: 500, statusText: 'Internal Server Error' }))
    await expect(api.retry('x')).rejects.toThrow('500 Internal Server Error')
  })

  it('upload sends multipart form with file and level', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 'a', reused: false }))
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    await api.upload(file, 'grad')
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/papers')
    const body = (init as RequestInit).body as FormData
    expect(body.get('level')).toBe('grad')
    expect((body.get('file') as File).name).toBe('a.pdf')
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
