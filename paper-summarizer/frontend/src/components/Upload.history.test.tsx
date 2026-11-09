import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type Health, type PaperSummary } from '../api'
import { Upload } from './Upload'

const health: Health = { demo_mode: true, backend: 'demo', analysis_model: 'm', max_upload_mb: 1 }

const paper = (n: number): PaperSummary => ({
  id: String(n).padStart(16, '0'),
  filename: `p${n}.pdf`,
  title: `論文${n}`,
  status: 'done',
  created_at: `2026-11-${String(30 - n).padStart(2, '0')}T00:00:00+00:00`,
})
const papers = (count: number) => Array.from({ length: count }, (_, i) => paper(i + 1))

function setNarrow(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

afterEach(() => setNarrow(false))

describe('Upload history: count limit', () => {
  it('shows 6 items on a wide screen and a show-all button for the rest', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(9))
    render(<Upload health={health} onOpen={vi.fn()} />)
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'すべて表示（9件）' })).toBeInTheDocument()
  })

  it('shows 4 items on a narrow screen', async () => {
    setNarrow(true)
    vi.spyOn(api, 'list').mockResolvedValue(papers(9))
    render(<Upload health={health} onOpen={vi.fn()} />)
    expect(within(await screen.findByRole('list')).getAllByRole('listitem')).toHaveLength(4)
  })

  it('has no toggle when everything fits', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(6))
    render(<Upload health={health} onOpen={vi.fn()} />)
    await screen.findByRole('list')
    expect(screen.queryByRole('button', { name: /すべて表示/ })).toBeNull()
  })

  it('expands, keeps the newest-first order, and collapses again with the keyboard', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(8))
    render(<Upload health={health} onOpen={vi.fn()} />)
    const more = await screen.findByRole('button', { name: 'すべて表示（8件）' })
    more.focus()
    await userEvent.keyboard('{Enter}')
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(8)
    const titles = screen.getAllByText(/^論文\d$/).map((e) => e.textContent)
    expect(titles).toEqual(papers(8).map((p) => p.title))
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6)
  })
})

describe('Upload history: fitting to the screen height', () => {
  /** jsdom にはレイアウトが無いので、枠・見出し・カードの高さを与える */
  function stubLayout(sectionHeight: number) {
    const heights: Record<string, number> = { SECTION: sectionHeight, H2: 40, LI: 150 }
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return heights[this.tagName] ?? 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return heights[this.tagName] ?? 0
    })
  }

  it('shows as many as fit in the available height', async () => {
    stubLayout(900) // 900 - 40 - 6 - 56 = 798。カード 150 で 5 件（jsdom の gap と padding は 0）
    vi.spyOn(api, 'list').mockResolvedValue(papers(9))
    render(<Upload health={health} onOpen={vi.fn()} />)
    await screen.findByRole('list')
    await waitFor(() => expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5))
    expect(screen.getByRole('button', { name: 'すべて表示（9件）' })).toBeInTheDocument()
  })

  it('never shows fewer than 3 even in a very short window', async () => {
    stubLayout(200)
    vi.spyOn(api, 'list').mockResolvedValue(papers(9))
    render(<Upload health={health} onOpen={vi.fn()} />)
    await screen.findByRole('list')
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('Upload history: delete', () => {
  it('asks for confirmation and does nothing when cancelled', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(2))
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文1を削除' }))
    expect(confirm).toHaveBeenCalledWith('「論文1」を削除しますか。解析結果と質問の記録も消え、元に戻せません')
    expect(del).not.toHaveBeenCalled()
    expect(screen.getByText('論文1')).toBeInTheDocument()
  })

  it('deletes, removes the item and clears that paper from localStorage only', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(2))
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const target = paper(1).id
    localStorage.setItem(`thoughts:${target}`, 'x')
    localStorage.setItem('knownConcepts', '[]')
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文1を削除' }))
    await waitFor(() => expect(screen.queryByText('論文1')).toBeNull())
    expect(del).toHaveBeenCalledWith(target)
    expect(screen.getByText('論文2')).toBeInTheDocument()
    expect(localStorage.getItem(`thoughts:${target}`)).toBeNull()
    expect(localStorage.getItem('knownConcepts')).toBe('[]')
  })

  it('shows an error and keeps the item when deleting fails', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(2))
    vi.spyOn(api, 'delete').mockRejectedValue(new Error('サーバーエラー'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    localStorage.setItem(`thoughts:${paper(1).id}`, 'x')
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文1を削除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('削除できませんでした。サーバーエラー')
    expect(screen.getByText('論文1')).toBeInTheDocument()
    expect(localStorage.getItem(`thoughts:${paper(1).id}`)).toBe('x')
  })

  it('does not open the paper when delete is pressed, and labels the button with text', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(1))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onOpen = vi.fn()
    render(<Upload health={health} onOpen={onOpen} />)
    const btn = await screen.findByRole('button', { name: '論文1を削除' })
    expect(btn).toHaveTextContent('削除')
    await userEvent.click(btn)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("moves focus to the next card's delete button and announces the deletion", async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(3))
    vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文1を削除' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '論文2を削除' })).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('「論文1」を削除しました')
  })

  it('moves focus to the heading when the last card was deleted', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(2))
    vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文2を削除' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'これまでの論文' })).toHaveFocus())
  })

  it('moves focus to the upload button when no paper is left', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(1))
    vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文1を削除' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDFを選択' })).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('「論文1」を削除しました')
  })

  it('shows 削除中… on the button while deleting', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(2))
    let finish: () => void = () => {}
    vi.spyOn(api, 'delete').mockReturnValue(new Promise<void>((r) => (finish = r)))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文1を削除' }))
    expect(screen.getByRole('button', { name: '論文1を削除' })).toHaveTextContent('削除中…')
    expect(screen.getByRole('button', { name: '論文1を削除' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.queryByText('論文1')).toBeNull())
  })

  it('works when matchMedia is unavailable', async () => {
    // @ts-expect-error 古い環境を想定して取り除く
    window.matchMedia = undefined
    vi.spyOn(api, 'list').mockResolvedValue(papers(8))
    render(<Upload health={health} onOpen={vi.fn()} />)
    expect(within(await screen.findByRole('list')).getAllByRole('listitem')).toHaveLength(6)
  })

  it('keeps a fixed label on the show-all button without aria-expanded', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(8))
    render(<Upload health={health} onOpen={vi.fn()} />)
    const more = await screen.findByRole('button', { name: 'すべて表示（8件）' })
    expect(more).not.toHaveAttribute('aria-expanded')
  })

  it('fills the list from the rest after a delete while collapsed', async () => {
    vi.spyOn(api, 'list').mockResolvedValue(papers(7))
    vi.spyOn(api, 'delete').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '論文1を削除' }))
    await waitFor(() => expect(screen.queryByText('論文1')).toBeNull())
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /すべて表示/ })).toBeNull()
  })
})
