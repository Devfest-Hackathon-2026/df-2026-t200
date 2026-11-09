import { describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { forgetPaperStorage } from './paperStorage'

const ID = '0123456789abcdef'
const OTHER = 'fedcba9876543210'

describe('forgetPaperStorage', () => {
  it('removes every key of that paper and keeps the rest', () => {
    for (const k of ['knowledge', 'conceptLevel', 'checkDraft', 'thoughts']) {
      localStorage.setItem(`${k}:${ID}`, '1')
      localStorage.setItem(`${k}:${OTHER}`, '1')
    }
    localStorage.setItem('knownConcepts', '[]')
    localStorage.setItem('client-id', 'c')
    localStorage.setItem('pane-split', '0.5')
    forgetPaperStorage(ID)
    expect(Object.keys(localStorage).sort()).toEqual(
      [
        'client-id',
        'conceptLevel:' + OTHER,
        'checkDraft:' + OTHER,
        'knowledge:' + OTHER,
        'knownConcepts',
        'pane-split',
        'thoughts:' + OTHER,
      ].sort(),
    )
  })

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    localStorage.setItem(`thoughts:${ID}`, 'x')
    expect(() => forgetPaperStorage(ID)).not.toThrow()
  })
})

describe('api.delete', () => {
  it('sends DELETE with the client id and resolves on 204', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await expect(api.delete(ID)).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/papers/${ID}`)
    expect(init!.method).toBe('DELETE')
    expect((init!.headers as Record<string, string>)['X-Client-Id']).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  })

  it('throws ApiError with the server message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '論文が見つかりません' }), { status: 404, headers: { 'content-type': 'application/json' } }),
    )
    await expect(api.delete(ID)).rejects.toMatchObject({ status: 404, message: '論文が見つかりません' })
    await expect(api.delete(ID)).rejects.toBeInstanceOf(ApiError)
  })
})
