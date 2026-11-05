import { describe, expect, it } from 'vitest'
import { clearHighlights, highlightQuote, isCancellation, squash } from './pdfText'

function layer(...texts: string[]) {
  const div = document.createElement('div')
  for (const t of texts) {
    const span = document.createElement('span')
    span.textContent = t
    div.appendChild(span)
  }
  return div
}

describe('squash', () => {
  it('drops spaces, symbols, soft hyphens and case', () => {
    expect(squash('Self-­Attention, IS  all')).toBe('selfattentionisall')
  })
})

describe('highlightQuote', () => {
  it('highlights spans across line breaks and returns the first one', () => {
    const l = layer('Intro text.', 'We propose a new', 'method for reading.', 'Other')
    const first = highlightQuote(l, 'we propose a new method')
    expect(first?.textContent).toBe('We propose a new')
    expect(Array.from(l.querySelectorAll('.hl')).map((e) => e.textContent)).toEqual(['We propose a new', 'method for reading.'])
  })

  it('falls back to the first half when the quote is slightly broken', () => {
    const l = layer('the experiments indicate that grounded explanations help')
    expect(highlightQuote(l, 'the experiments indicate that grounded XXXXXXXXXXXXXXXXXXXXXXXXXXXXX')).not.toBeNull()
  })

  it('returns null for too-short or missing quotes', () => {
    const l = layer('abc def', '')
    expect(highlightQuote(l, 'ab')).toBeNull()
    expect(highlightQuote(l, 'something that is not on the page')).toBeNull()
    expect(l.querySelectorAll('.hl')).toHaveLength(0)
  })
})

describe('clearHighlights', () => {
  it('removes highlights from every page under the root', () => {
    const root = document.createElement('div')
    const a = layer('first page quote text')
    const b = layer('second page quote text')
    root.append(a, b)
    highlightQuote(a, 'first page quote text')
    highlightQuote(b, 'second page quote text')
    expect(root.querySelectorAll('.hl')).toHaveLength(2)
    clearHighlights(root)
    expect(root.querySelectorAll('.hl')).toHaveLength(0)
  })
})

describe('isCancellation', () => {
  it('treats pdf.js cancellations as expected and everything else as errors', () => {
    expect(isCancellation({ name: 'RenderingCancelledException' })).toBe(true)
    expect(isCancellation({ name: 'AbortException' })).toBe(true)
    expect(isCancellation(new Error('broken image'))).toBe(false)
    expect(isCancellation(null)).toBe(false)
  })
})
