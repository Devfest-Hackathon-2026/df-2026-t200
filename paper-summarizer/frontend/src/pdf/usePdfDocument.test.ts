import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDocument = vi.fn()
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: (...a: unknown[]) => getDocument(...a) }))

const { usePdfDocument } = await import('./usePdfDocument')

describe('usePdfDocument', () => {
  beforeEach(() => {
    getDocument.mockReset()
  })

  it('loads the document and destroys the task on unmount', async () => {
    const doc = { numPages: 3 }
    const destroy = vi.fn()
    getDocument.mockReturnValue({ promise: Promise.resolve(doc), destroy })
    const { result, unmount } = renderHook(() => usePdfDocument('/a.pdf'))
    await waitFor(() => expect(result.current.doc).toBe(doc))
    expect(getDocument).toHaveBeenCalledWith({ url: '/a.pdf' })
    unmount()
    expect(destroy).toHaveBeenCalled()
  })

  it('reports load errors', async () => {
    getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF structure')), destroy: vi.fn() })
    const { result } = renderHook(() => usePdfDocument('/bad.pdf'))
    await waitFor(() => expect(result.current.error).toBe('Invalid PDF structure'))
    expect(result.current.doc).toBeNull()
  })

  it('ignores results after unmount', async () => {
    let resolve: (d: unknown) => void = () => {}
    getDocument.mockReturnValue({ promise: new Promise((r) => (resolve = r)), destroy: vi.fn() })
    const { result, unmount } = renderHook(() => usePdfDocument('/slow.pdf'))
    unmount()
    resolve({ numPages: 1 })
    await Promise.resolve()
    expect(result.current.doc).toBeNull()
  })
})
