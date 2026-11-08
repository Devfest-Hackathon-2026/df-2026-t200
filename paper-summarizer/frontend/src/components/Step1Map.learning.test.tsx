import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Concept, Step1 } from '../api'
import { step1 } from '../test/fixtures'
import { Step1Map } from './Step1Map'

const mk = (id: string, name: string, depends_on: string[] = [], importance: Concept['importance'] = 'essential'): Concept => ({
  id,
  name,
  description: `${name}の説明`,
  why_needed: 'w',
  first_page: null,
  depends_on,
  importance,
  origin: 'paper',
  evidence: [],
})
const data = (concepts: Concept[]): Step1 => ({ ...step1, concepts })

const MEM = 'knownConcepts'
const rec = (full: string, outer = full, inner: string[] = []) => ({ full, outer, inner })
const flushStorage = () => window.dispatchEvent(new Event('pagehide'))

describe('学ぶ順番', () => {
  const chain = data([mk('c', '最後', ['b']), mk('b', '中間', ['a']), mk('a', '最初')])

  it('lists only unknown concepts, prerequisites first, and selects a concept on click', async () => {
    render(<Step1Map data={chain} paperId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /^最後/ }))
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    await userEvent.click(screen.getByRole('button', { name: /^最初/ }))
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    const list = screen.getByRole('list', { name: '学ぶ順番' })
    const items = within(list).getAllByRole('button')
    expect(items.map((b) => b.textContent)).toEqual(['最初', '最後'])
    await userEvent.click(items[1])
    expect(screen.getByRole('heading', { level: 3, name: '最後' })).toBeInTheDocument()
  })

  it('shows a notice instead of an order when the dependencies are circular', async () => {
    render(<Step1Map data={data([mk('a', 'あ', ['b']), mk('b', 'い', ['a'])])} paperId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    expect(screen.queryByRole('list', { name: '学ぶ順番' })).not.toBeInTheDocument()
    expect(screen.getByText(/循環/)).toBeInTheDocument()
  })

  it('only lists concepts inside the display range', async () => {
    const d = data([mk('a', '必須の概念'), mk('b', '発展の概念', ['a'], 'advanced')])
    render(<Step1Map data={d} paperId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /^発展の概念/ }))
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    await userEvent.click(screen.getByRole('button', { name: '必須だけ' }))
    expect(screen.queryByRole('list', { name: '学ぶ順番' })).not.toBeInTheDocument()
  })
})

describe('知っている概念の記憶', () => {
  it('remembers a known concept, including its English name in brackets', async () => {
    render(<Step1Map data={data([mk('sa', '自己注意機構 (Self-Attention)')])} paperId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: '知っている' }))
    flushStorage()
    const mem = JSON.parse(localStorage.getItem(MEM)!) as { full: string; inner: string[] }[]
    expect(mem).toEqual([{ full: '自己注意機構selfattention', outer: '自己注意機構', inner: ['selfattention'] }])
  })

  it('marks matching unsorted concepts as known in the next paper and says so', async () => {
    localStorage.setItem(MEM, JSON.stringify([rec('selfattention')]))
    render(<Step1Map data={data([mk('x', 'Self-Attention'), mk('y', '別の概念')])} paperId="p2" />)
    expect(await screen.findByText(/前の論文で知っているとした概念を仕分け済みにしました（1件）/)).toBeInTheDocument()
    expect(screen.getByText('知っている', { selector: 'small' })).toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('knowledge:p2')!)).toEqual({ x: 'known' }))
  })

  it('keeps a mark the reader set explicitly in this paper', async () => {
    localStorage.setItem(MEM, JSON.stringify([rec('内積')]))
    localStorage.setItem('knowledge:p2', JSON.stringify({ x: 'unknown' }))
    render(<Step1Map data={data([mk('x', '内積')])} paperId="p2" />)
    expect(screen.queryByText(/仕分け済みにしました/)).not.toBeInTheDocument()
    expect(screen.getByText('知らない', { selector: 'small' })).toBeInTheDocument()
  })

  it('forgets the name when the reader marks the concept as unknown', async () => {
    localStorage.setItem(MEM, JSON.stringify([rec('内積dotproduct', '内積', ['dotproduct']), rec('内積別名', '内積')]))
    localStorage.setItem('knowledge:p2', JSON.stringify({ x: 'known' }))
    render(<Step1Map data={data([mk('x', '内積 (dot product)')])} paperId="p2" />)
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    flushStorage()
    expect(JSON.parse(localStorage.getItem(MEM)!)).toEqual([rec('内積別名', '内積')])
  })

  it('treats an old or broken stored value as empty', async () => {
    localStorage.setItem(MEM, JSON.stringify(['内積']))
    render(<Step1Map data={data([mk('x', '内積')])} paperId="p5" />)
    expect(screen.queryByText(/仕分け済みにしました/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /覚えた/ })).not.toBeInTheDocument()
  })

  it('keeps a permanent status container and fills it only when concepts were sorted automatically', async () => {
    localStorage.setItem(MEM, JSON.stringify([rec('内積')]))
    const { container } = render(<Step1Map data={data([mk('x', '内積')])} paperId="p6" />)
    const status = container.querySelector('[role=status]')
    expect(status).not.toBeNull()
    expect(status).toHaveTextContent('前の論文で知っているとした概念を仕分け済みにしました（1件）')
  })

  it('clears the memory only after confirmation', async () => {
    localStorage.setItem(MEM, JSON.stringify([rec('内積')]))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<Step1Map data={data([mk('x', '別')])} paperId="p3" />)
    const btn = screen.getByRole('button', { name: /覚えた「知っている」を消す/ })
    await userEvent.click(btn)
    expect(JSON.parse(localStorage.getItem(MEM)!)).toEqual([rec('内積')])
    await userEvent.click(btn)
    flushStorage()
    expect(JSON.parse(localStorage.getItem(MEM)!)).toEqual([])
    expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })

  it('works when localStorage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(<Step1Map data={data([mk('x', '内積')])} paperId="p4" />)
    await userEvent.click(screen.getByRole('button', { name: '知っている' }))
    flushStorage()
    expect(screen.getByText('知っている', { selector: 'small' })).toBeInTheDocument()
    get.mockRestore()
    set.mockRestore()
  })
})

describe('確認モードの仕分け', () => {
  it('marks concepts through the same path as the manual buttons, including the memory', async () => {
    const { api } = await import('../api')
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
    const create = vi.spyOn(api, 'createCheck').mockResolvedValue({
      check: {
        id: 'ck',
        created_at: 't',
        submitted: false,
        items: [
          { id: 'q1', concept_id: 'a', question: 'Aの問題', options: ['x1', 'x2', 'x3', '分からない'], general_knowledge: false },
          { id: 'q2', concept_id: 'b', question: 'Bの問題', options: ['y1', 'y2', 'y3', '分からない'], general_knowledge: false },
        ],
        result: null,
      },
    })
    const base = {
      question: '',
      options: [],
      chosen: 0,
      correct_index: 0,
      dont_know: false,
      explanation: '解説文です',
      evidence: null,
      general_knowledge: false,
    }
    vi.spyOn(api, 'answerCheck').mockResolvedValue({
      check: {
        id: 'ck',
        created_at: 't',
        submitted: true,
        items: [],
        result: {
          correct: 1,
          verdicts: { a: 'known', b: 'unknown' },
          items: [
            { ...base, id: 'q1', concept_id: 'a', is_correct: true },
            { ...base, id: 'q2', concept_id: 'b', is_correct: false },
          ],
        },
      },
    })
    localStorage.setItem('knowledge:pc', JSON.stringify({ c: 'known' }))
    render(<Step1Map data={data([mk('a', '概念あ'), mk('b', '概念い'), mk('c', '概念う')])} paperId="pc" />)
    await userEvent.click(await screen.findByRole('button', { name: '問題に答えて仕分ける' }))
    expect(create).toHaveBeenCalledWith('pc', ['a', 'b'], false, expect.any(AbortSignal)) // 仕分け済みの c は対象外
    await userEvent.click(await screen.findByRole('radio', { name: 'x1' }))
    await userEvent.click(screen.getByRole('radio', { name: 'y2' }))
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    expect(await screen.findAllByText('解説文です')).toHaveLength(2)
    const nodes = within(screen.getByRole('list', { name: '前提知識の概念' }))
    expect(nodes.getByRole('button', { name: /^概念あ/ })).toHaveTextContent('知っている')
    expect(nodes.getByRole('button', { name: /^概念い/ })).toHaveTextContent('知らない')
    flushStorage()
    const mem = JSON.parse(localStorage.getItem(MEM) ?? '[]') as { full: string }[]
    expect(mem.map((r) => r.full)).toContain('概念あ')
    expect(mem.map((r) => r.full)).not.toContain('概念い')
  })

  it('does not overwrite a mark the student set by hand while answering', async () => {
    const { api } = await import('../api')
    const q = (id: string, cid: string) => ({
      id,
      concept_id: cid,
      question: `${cid}の問題`,
      options: ['x1', 'x2', 'x3', '分からない'],
      general_knowledge: false,
    })
    vi.spyOn(api, 'createCheck').mockResolvedValue({
      check: { id: 'ck', created_at: 't', submitted: false, items: [q('q1', 'a'), q('q2', 'b')], result: null },
    })
    const base = {
      question: '',
      options: [],
      chosen: 0,
      correct_index: 0,
      dont_know: false,
      explanation: '解説文です',
      evidence: null,
      general_knowledge: false,
    }
    vi.spyOn(api, 'answerCheck').mockResolvedValue({
      check: {
        id: 'ck',
        created_at: 't',
        submitted: true,
        items: [],
        result: {
          correct: 0,
          verdicts: { a: 'unknown', b: 'unknown' },
          items: [
            { ...base, id: 'q1', concept_id: 'a', is_correct: false },
            { ...base, id: 'q2', concept_id: 'b', is_correct: false },
          ],
        },
      },
    })
    render(<Step1Map data={data([mk('a', '概念あ'), mk('b', '概念い')])} paperId="pm" />)
    await userEvent.click(await screen.findByRole('button', { name: '問題に答えて仕分ける' }))
    await screen.findByText('aの問題')
    // 答えている間に、概念あを手で「知っている」にする
    const nodes = within(screen.getByRole('list', { name: '前提知識の概念' }))
    await userEvent.click(nodes.getByRole('button', { name: /^概念あ/ }))
    await userEvent.click(screen.getByRole('button', { name: '知っている' }))
    await userEvent.click(screen.getAllByRole('radio', { name: 'x1' })[0])
    await userEvent.click(screen.getAllByRole('radio', { name: 'x1' })[1])
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    expect(await screen.findAllByText('解説文です')).toHaveLength(2)
    expect(nodes.getByRole('button', { name: /^概念あ/ })).toHaveTextContent('知っている') // 手で付けた印のまま
    expect(nodes.getByRole('button', { name: /^概念い/ })).toHaveTextContent('知らない')
    expect(screen.getAllByText('判定は「知らない」')).toHaveLength(2) // 結果の画面には判定をそのまま出す
  })
})
