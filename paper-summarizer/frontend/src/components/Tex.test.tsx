import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import katex from 'katex'
import { describe, expect, it, vi } from 'vitest'
import { JumpContext } from '../jumpContext'
import { Tex } from './Tex'
import { KATEX_OPTIONS } from './texOptions'

// pdf.js は jsdom で動かないので、ページ画像は目印だけの部品に差し替える
vi.mock('./PdfPageImage', () => ({
  default: ({ url, page }: { url: string; page: number }) => <div data-testid="page-image">{`${url}#${page}`}</div>,
}))

describe('Tex', () => {
  it('shows the source while KaTeX loads, then renders it', async () => {
    const { container } = render(<Tex tex={'\\frac{a}{b}'} block />)
    expect(container.querySelector('.tex-loading')).not.toBeNull()
    await waitFor(() => expect(container.querySelector('.tex-block .katex')).not.toBeNull())
    expect(container.querySelector('.tex-loading')).toBeNull()
  })

  it('includes MathML for screen readers', async () => {
    const { container } = render(<Tex tex={'x^2'} />)
    await waitFor(() => expect(container.querySelector('.katex-mathml math')).not.toBeNull())
  })

  it('pins the safety options of KaTeX', async () => {
    expect(KATEX_OPTIONS).toMatchObject({ trust: false, throwOnError: true, maxSize: 10, maxExpand: 100, output: 'htmlAndMathml' })
    const spy = vi.spyOn(katex, 'renderToString')
    render(<Tex tex={'x'} block />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith('x', expect.objectContaining({ trust: false, maxSize: 10, maxExpand: 100, displayMode: true }))
  })

  it('does not turn \\href into a link', async () => {
    const { container } = render(<Tex tex={'\\href{javascript:alert(1)}{x}'} />)
    await screen.findByText('\\href{javascript:alert(1)}{x}')
    expect(container.querySelector('a')).toBeNull()
  })

  it('stops runaway macro expansion and falls back to the source', async () => {
    const tex = '\\def\\a{\\a\\a}\\a'
    render(<Tex tex={tex} />)
    await waitFor(() => expect(screen.getByText(tex)).toHaveClass('tex-fallback'))
  })

  it('falls back to raw source when LaTeX is invalid', async () => {
    render(<Tex tex={'\\frac{a'} />)
    await waitFor(() => expect(screen.getByText('\\frac{a')).toHaveClass('tex-fallback'))
    const code = screen.getByText('\\frac{a')
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('tex-fallback')
  })
})

describe('Tex fallback with a page', () => {
  const broken = '\\frac{a'

  it('shows 「PDFで確認」 and keeps the source when rendering fails', async () => {
    render(<Tex tex={broken} block page={4} />)
    expect(await screen.findByRole('button', { name: 'PDFで確認' })).toBeInTheDocument()
    expect(screen.getByText(broken)).toHaveAttribute('title', '数式の元の文字列')
  })

  it('jumps the PDF viewer to the page of the equation', async () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Tex tex={broken} page={4} />
      </JumpContext.Provider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'PDFで確認' }))
    expect(jump).toHaveBeenCalledWith(4)
  })

  it('shows the page image when a PDF url is given', async () => {
    render(<Tex tex={broken} page={4} pdfUrl="/pdf" />)
    expect(await screen.findByTestId('page-image')).toHaveTextContent('/pdf#4')
  })

  it('renders valid LaTeX with KaTeX and no button even when a page is given', async () => {
    const { container } = render(<Tex tex={'x^2'} page={4} />)
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'PDFで確認' })).toBeNull()
  })

  it('keeps the plain code fallback when there is no page', async () => {
    render(<Tex tex={broken} />)
    await waitFor(() => expect(screen.getByText(broken)).toHaveClass('tex-fallback'))
    expect(screen.queryByRole('button', { name: 'PDFで確認' })).toBeNull()
  })
})
