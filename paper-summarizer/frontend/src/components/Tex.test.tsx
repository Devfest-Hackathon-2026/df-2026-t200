import { render, screen } from '@testing-library/react'
import katex from 'katex'
import { describe, expect, it, vi } from 'vitest'
import { Tex } from './Tex'
import { KATEX_OPTIONS } from './texOptions'

describe('Tex', () => {
  it('renders valid LaTeX with KaTeX', () => {
    const { container } = render(<Tex tex={'\\frac{a}{b}'} block />)
    expect(container.querySelector('.tex-block .katex')).not.toBeNull()
  })

  it('includes MathML for screen readers', () => {
    const { container } = render(<Tex tex={'x^2'} />)
    expect(container.querySelector('.katex-mathml math')).not.toBeNull()
  })

  it('pins the safety options of KaTeX', () => {
    expect(KATEX_OPTIONS).toMatchObject({ trust: false, throwOnError: true, maxSize: 10, maxExpand: 100, output: 'htmlAndMathml' })
    const spy = vi.spyOn(katex, 'renderToString')
    render(<Tex tex={'x'} block />)
    expect(spy).toHaveBeenCalledWith('x', expect.objectContaining({ trust: false, maxSize: 10, maxExpand: 100, displayMode: true }))
  })

  it('does not turn \\href into a link', () => {
    const { container } = render(<Tex tex={'\\href{javascript:alert(1)}{x}'} />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('stops runaway macro expansion and falls back to the source', () => {
    const tex = '\\def\\a{\\a\\a}\\a'
    render(<Tex tex={tex} />)
    expect(screen.getByText(tex).tagName).toBe('CODE')
  })

  it('falls back to raw source when LaTeX is invalid', () => {
    render(<Tex tex={'\\frac{a'} />)
    const code = screen.getByText('\\frac{a')
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('tex-fallback')
  })
})
