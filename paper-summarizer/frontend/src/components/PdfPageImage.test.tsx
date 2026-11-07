import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PdfPageImage from './PdfPageImage'

const state = vi.hoisted(() => ({ doc: null as unknown, error: null as string | null }))
vi.mock('../pdf/usePdfDocument', () => ({ usePdfDocument: () => ({ doc: state.doc, error: state.error }) }))

const fakePage = () => {
  const render = vi.fn(() => ({ cancel: vi.fn(), promise: Promise.resolve() }))
  return {
    render,
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale }),
  }
}

describe('PdfPageImage', () => {
  afterEach(() => {
    state.doc = null
    state.error = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('draws the page at device pixel ratio while keeping the CSS size', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const page = fakePage()
    state.doc = { getPage: vi.fn().mockResolvedValue(page) }
    render(<PdfPageImage url="/pdf" page={3} label="3ページ" />)
    const canvas = screen.getByRole('img', { name: '3ページ' }) as HTMLCanvasElement
    await waitFor(() => expect(page.render).toHaveBeenCalled())
    expect(canvas.style.width).toBe('480px')
    expect(canvas.width).toBe(960)
    expect(canvas.height).toBe(1440)
    expect(page.render).toHaveBeenCalledWith(expect.objectContaining({ viewport: expect.objectContaining({ width: 960 }) }))
  })

  it('shows a message when the page cannot be loaded (e.g. out of range)', async () => {
    state.doc = { getPage: vi.fn().mockRejectedValue(new Error('Invalid page request')) }
    render(<PdfPageImage url="/pdf" page={99} label="99ページ" />)
    expect(await screen.findByText('ページの画像を表示できませんでした。')).toBeInTheDocument()
  })

  it('shows a message when the PDF itself fails to load', () => {
    state.error = 'boom'
    render(<PdfPageImage url="/pdf" page={1} label="1ページ" />)
    expect(screen.getByText('ページの画像を表示できませんでした。')).toBeInTheDocument()
  })
})
