import type { Foundation } from '../api'

/**
 * 先に読むとよい論文の外部リンク。
 * LLM の文字列をそのまま href にしない。固定のホストに、形を確かめた値を encodeURIComponent して付けて作る。
 */

const DOI_RE = /^10\.\d{4,9}\/[^\s<>"'\\]+$/
const ARXIV_RE = /^\d{4}\.\d{4,5}(v\d+)?$/

export const doiUrl = (doi: string) => `https://doi.org/${encodeURIComponent(doi)}`
export const arxivUrl = (id: string) => `https://arxiv.org/abs/${encodeURIComponent(id)}`
export const scholarUrl = (title: string) => `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`

export type FoundationLink = { label: string; href: string }

export function foundationLinks(f: Pick<Foundation, 'title' | 'doi' | 'arxiv_id'>): FoundationLink[] {
  const links: FoundationLink[] = []
  if (typeof f.doi === 'string' && DOI_RE.test(f.doi)) links.push({ label: 'DOI', href: doiUrl(f.doi) })
  if (typeof f.arxiv_id === 'string' && ARXIV_RE.test(f.arxiv_id)) links.push({ label: 'arXiv', href: arxivUrl(f.arxiv_id) })
  links.push({ label: '検索', href: scholarUrl(f.title) })
  return links
}
