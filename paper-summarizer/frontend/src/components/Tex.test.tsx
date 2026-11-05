import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tex } from './Tex'

describe('Tex', () => {
  it('renders valid LaTeX with KaTeX', () => {
    const { container } = render(<Tex tex={'\\frac{a}{b}'} block />)
    expect(container.querySelector('.tex-block .katex')).not.toBeNull()
  })

  it('includes MathML for screen readers', () => {
    const { container } = render(<Tex tex={'x^2'} />)
    expect(container.querySelector('.katex-mathml math')).not.toBeNull()
  })

  it('falls back to raw source when LaTeX is invalid', () => {
    render(<Tex tex={'\\frac{a'} />)
    const code = screen.getByText('\\frac{a')
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('tex-fallback')
  })
})
