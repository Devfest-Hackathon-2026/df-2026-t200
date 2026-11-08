import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Foundation } from '../api'
import { foundations } from '../test/fixtures'
import { FoundationPapers } from './FoundationPapers'

describe('FoundationPapers', () => {
  it('renders nothing when there are no foundations or the field is missing (old results)', () => {
    const { container, rerender } = render(<FoundationPapers items={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FoundationPapers items={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists papers in reading order with title, authors, year, reason and evidence chips', () => {
    render(<FoundationPapers items={[...foundations].reverse()} />)
    expect(screen.getByRole('heading', { name: '先に読むとよい論文' })).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('foundation'))
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Base Paper One')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/A. Author/)).toBeInTheDocument()
    expect(within(rows[0]).getByText(/2015/)).toBeInTheDocument()
    expect(within(rows[0]).getByText('手法の土台になっている。')).toBeInTheDocument()
    expect(within(rows[0]).getByText('照合済み')).toBeInTheDocument()
    expect(within(rows[1]).getByText('未確認')).toBeInTheDocument()
  })

  it('builds links from the fixed hosts and opens them safely', () => {
    render(<FoundationPapers items={foundations} />)
    const doi = screen.getByRole('link', { name: /DOI/ })
    expect(doi).toHaveAttribute('href', 'https://doi.org/10.1000%2Fabc')
    expect(doi).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(doi).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: /arXiv/ })).toHaveAttribute('href', 'https://arxiv.org/abs/1706.03762')
    for (const a of screen.getAllByRole('link', { name: /検索/ }))
      expect(a.getAttribute('href')).toMatch(/^https:\/\/scholar\.google\.com\/scholar\?q=/)
  })

  it('does not break with missing optional fields', () => {
    const bare = [{ title: 'Only Title', reason: '理由', order: 1 }] as unknown as Foundation[]
    render(<FoundationPapers items={bare} />)
    expect(screen.getByText('Only Title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /検索/ })).toBeInTheDocument()
  })
})
