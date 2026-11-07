import { render, screen, waitFor } from '@testing-library/react'
import katex from 'katex'
import { describe, expect, it, vi } from 'vitest'
import { Tex } from './Tex'
import { KATEX_OPTIONS } from './texOptions'

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
