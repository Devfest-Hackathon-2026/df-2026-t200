import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderInline } from './inlineMarkdown'

const html = (text: string) => render(<div>{renderInline(text)}</div>).container.innerHTML

describe('renderInline', () => {
  it('returns plain text unchanged', () => {
    expect(html('そのまま')).toBe('<div>そのまま</div>')
    expect(html('')).toBe('<div></div>')
  })
  it('converts bold and code', () => {
    expect(html('a **b** c `d` e')).toBe('<div>a <strong>b</strong> c <code>d</code> e</div>')
  })
  it('keeps unclosed or empty markers as text', () => {
    expect(html('**a')).toBe('<div>**a</div>')
    expect(html('`a')).toBe('<div>`a</div>')
    expect(html('****')).toBe('<div>****</div>')
    expect(html('``')).toBe('<div>``</div>')
  })
  it('does not interpret bold markers inside code', () => {
    expect(html('`a **b** c`')).toBe('<div><code>a **b** c</code></div>')
  })
  it('escapes HTML-like text', () => {
    expect(html('<img onerror=x>')).toBe('<div>&lt;img onerror=x&gt;</div>')
  })
  it('keeps newlines', () => {
    expect(html('a\n**b**')).toBe('<div>a\n<strong>b</strong></div>')
  })
})
