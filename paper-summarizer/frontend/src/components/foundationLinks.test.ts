import { describe, expect, it } from 'vitest'
import { arxivUrl, doiUrl, foundationLinks, scholarUrl } from './foundationLinks'

describe('foundationLinks', () => {
  it('builds the DOI url on a fixed host with the value encoded', () => {
    expect(doiUrl('10.1000/abc')).toBe('https://doi.org/10.1000%2Fabc')
  })

  it('builds the arXiv url on a fixed host', () => {
    expect(arxivUrl('1706.03762v5')).toBe('https://arxiv.org/abs/1706.03762v5')
  })

  it('encodes the title in the Scholar search url', () => {
    expect(scholarUrl('A&B "x" #1')).toBe('https://scholar.google.com/scholar?q=A%26B%20%22x%22%20%231')
  })

  it('always offers a search link and adds DOI / arXiv only when present', () => {
    expect(foundationLinks({ title: 'T', doi: null, arxiv_id: null }).map((l) => l.label)).toEqual(['検索'])
    expect(foundationLinks({ title: 'T', doi: '10.1000/x', arxiv_id: '1706.03762' }).map((l) => l.label)).toEqual(['DOI', 'arXiv', '検索'])
  })

  it('ignores a malformed DOI or arXiv id (never uses an LLM string as a href)', () => {
    const links = foundationLinks({ title: 'T', doi: 'javascript:alert(1)', arxiv_id: 'https://evil.example/x' })
    expect(links.map((l) => l.label)).toEqual(['検索'])
    expect(links.every((l) => l.href.startsWith('https://scholar.google.com/'))).toBe(true)
  })
})
