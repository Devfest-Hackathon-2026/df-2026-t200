import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { api, type Check } from '../api'
import { JumpContext } from '../jumpContext'
import { step1 } from '../test/fixtures'
import { ConceptCheck } from './ConceptCheck'

const view: Check = {
  id: 'ck1',
  created_at: '2026-11-08T00:00:00Z',
  submitted: false,
  items: [
    {
      id: 'q1',
      concept_id: 'dot',
      question: '内積の使いどころはどれか。',
      options: ['類似度を測る', '画像を拡大する', '文を翻訳する', '分からない'],
      general_knowledge: false,
    },
    {
      id: 'q2',
      concept_id: 'expectation',
      question: '期待値とは何か。',
      options: ['平均', '最大値', '中央値', '分からない'],
      general_knowledge: true,
    },
  ],
  result: null,
}
const done: Check = {
  ...view,
  submitted: true,
  result: {
    correct: 1,
    verdicts: { dot: 'known', expectation: 'unknown' },
    items: [
      {
        id: 'q1',
        concept_id: 'dot',
        question: view.items[0].question,
        options: view.items[0].options,
        chosen: 0,
        correct_index: 0,
        is_correct: true,
        dont_know: false,
        explanation: '内積は類似度の計算に使う。',
        evidence: { page: 2, quote: 'the dot product measures similarity', verified: true },
        general_knowledge: false,
      },
      {
        id: 'q2',
        concept_id: 'expectation',
        question: view.items[1].question,
        options: view.items[1].options,
        chosen: 3,
        correct_index: 0,
        is_correct: false,
        dont_know: true,
        explanation: '期待値は確率で重みを付けた平均。',
        evidence: null,
        general_knowledge: true,
      },
    ],
  },
}

const [dot, expectation] = step1.concepts
const renderCheck = (props: Partial<ComponentProps<typeof ConceptCheck>> = {}) => {
  const onJudge = vi.fn()
  const jump = vi.fn()
  render(
    <JumpContext.Provider value={jump}>
      <ConceptCheck paperId="pid" concepts={step1.concepts} targets={[dot, expectation]} onJudge={onJudge} {...props} />
    </JumpContext.Provider>,
  )
  return { onJudge, jump }
}

describe('ConceptCheck', () => {
  it('creates nothing by itself and creates the questions for the targets on the button', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
    const create = vi.spyOn(api, 'createCheck').mockResolvedValue({ check: view })
    renderCheck()
    const button = await screen.findByRole('button', { name: '問題に答えて仕分ける' })
    expect(create).not.toHaveBeenCalled()
    await userEvent.click(button)
    expect(create).toHaveBeenCalledWith('pid', ['dot', 'expectation'], false, expect.any(AbortSignal))
    expect(await screen.findByText('内積の使いどころはどれか。')).toBeInTheDocument()
  })

  it('disables the button and says why when there is nothing to sort', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
    renderCheck({ targets: [] })
    const button = await screen.findByRole('button', { name: '問題に答えて仕分ける' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/仕分けていない概念がありません/)).toBeInTheDocument()
  })

  it('says the questions are AI-made and which ones are general knowledge, and shows no answer', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: view })
    renderCheck()
    expect(await screen.findByText(/AIが作った確認問題です/)).toBeInTheDocument()
    expect(screen.getAllByText('一般知識による問題')).toHaveLength(1)
    expect(screen.queryByText(/解説/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio', { name: '分からない' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: '答え合わせ' })).toBeDisabled()
  })

  it('submits the chosen options, then reports the verdicts once and shows explanations with evidence', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: view })
    const answer = vi.spyOn(api, 'answerCheck').mockResolvedValue({ check: done })
    const { onJudge, jump } = renderCheck()
    const g1 = await screen.findByRole('group', { name: /内積の使いどころ/ })
    await userEvent.click(within(g1).getByRole('radio', { name: '類似度を測る' }))
    const g2 = screen.getByRole('group', { name: /期待値とは何か/ })
    await userEvent.click(within(g2).getByRole('radio', { name: '分からない' }))
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    expect(answer).toHaveBeenCalledWith(
      'pid',
      'ck1',
      [
        { id: 'q1', choice: 0 },
        { id: 'q2', choice: 3 },
      ],
      expect.any(AbortSignal),
    )
    expect(await screen.findByText('内積は類似度の計算に使う。')).toBeInTheDocument()
    expect(onJudge).toHaveBeenCalledTimes(1)
    expect(onJudge).toHaveBeenCalledWith({ dot: 'known', expectation: 'unknown' })
    await userEvent.click(screen.getByRole('button', { name: /p\.2/ }))
    expect(jump).toHaveBeenCalledWith(2, 'the dot product measures similarity')
    expect(screen.getByText('判定は「知っている」')).toBeInTheDocument()
    expect(screen.getByText('判定は「知らない」')).toBeInTheDocument()
  })

  it('does not apply the verdicts again when a saved result is opened', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: done })
    const { onJudge } = renderCheck()
    expect(await screen.findByText('内積は類似度の計算に使う。')).toBeInTheDocument()
    expect(onJudge).not.toHaveBeenCalled()
  })

  it('offers a new set only for concepts that are still unsorted, using force', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: done })
    const create = vi.spyOn(api, 'createCheck').mockResolvedValue({ check: view })
    renderCheck({ targets: [dot] })
    await userEvent.click(await screen.findByRole('button', { name: '残りの概念で問題を作る' }))
    expect(create).toHaveBeenCalledWith('pid', ['dot'], true, expect.any(AbortSignal))
  })

  it('shows the error message when creation fails', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
    vi.spyOn(api, 'createCheck').mockRejectedValue(new Error('本日の利用上限に達しました。'))
    renderCheck()
    await userEvent.click(await screen.findByRole('button', { name: '問題に答えて仕分ける' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('本日の利用上限')
  })

  it('moves focus to the summary after the answer is checked', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: view })
    vi.spyOn(api, 'answerCheck').mockResolvedValue({ check: done })
    renderCheck()
    await userEvent.click(await screen.findByRole('radio', { name: '類似度を測る' }))
    await userEvent.click(screen.getAllByRole('radio', { name: '分からない' })[1])
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    await screen.findByText('内積は類似度の計算に使う。')
    expect(summaryOf()).toHaveFocus()
  })
})

const summaryOf = () => document.querySelector('.concept-check > summary') as HTMLElement
const sheet = () => document.querySelector('.concept-check') as HTMLDetailsElement
const rowDetails = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('.check-row > details'))

describe('ConceptCheck の開け閉め', () => {
  it('is a closed <details> with a one-line summary before any questions exist', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
    renderCheck()
    await screen.findByRole('button', { name: '問題に答えて仕分ける' })
    expect(sheet().tagName).toBe('DETAILS')
    expect(sheet()).not.toHaveAttribute('open')
    expect(summaryOf()).toHaveTextContent('確認モード：問題に答えて仕分ける')
  })

  it('summarises the score once the answers are checked, and stays closed by default', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: done })
    renderCheck()
    await screen.findByText('内積は類似度の計算に使う。')
    expect(summaryOf()).toHaveTextContent('確認モード：2問中1問正解')
    expect(sheet()).not.toHaveAttribute('open')
  })

  it('opens by itself right after the questions are made, and remembers it per paper', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
    vi.spyOn(api, 'createCheck').mockResolvedValue({ check: view })
    const { unmount } = render(
      <JumpContext.Provider value={vi.fn()}>
        <ConceptCheck paperId="pid" concepts={step1.concepts} targets={[dot, expectation]} onJudge={vi.fn()} />
      </JumpContext.Provider>,
    )
    await userEvent.click(summaryOf())
    await userEvent.click(await screen.findByRole('button', { name: '問題に答えて仕分ける' }))
    await screen.findByText('内積の使いどころはどれか。')
    expect(sheet()).toHaveAttribute('open')
    unmount()
    expect(JSON.parse(localStorage.getItem('checkOpen:pid') ?? 'null')).toBe('open')
  })

  it('is open while a draft of answers exists', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: view })
    localStorage.setItem('checkDraft:pid', JSON.stringify({ checkId: 'ck1', choices: { q1: 0 } }))
    renderCheck()
    await screen.findByText('内積の使いどころはどれか。')
    expect(sheet()).toHaveAttribute('open')
  })

  it('is closed for questions without any answer yet', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: view })
    renderCheck()
    await screen.findByText('内積の使いどころはどれか。')
    expect(sheet()).not.toHaveAttribute('open')
    expect(summaryOf()).toHaveTextContent('確認モード：2問に回答中')
  })

  it('remembers what the student chose per paper, even against the default', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: view })
    localStorage.setItem('checkDraft:pid', JSON.stringify({ checkId: 'ck1', choices: { q1: 0 } }))
    const first = render(
      <JumpContext.Provider value={vi.fn()}>
        <ConceptCheck paperId="pid" concepts={step1.concepts} targets={[dot]} onJudge={vi.fn()} />
      </JumpContext.Provider>,
    )
    await screen.findByText('内積の使いどころはどれか。')
    await userEvent.click(summaryOf()) // 下書きで開いているのを閉じる
    expect(sheet()).not.toHaveAttribute('open')
    first.unmount()
    expect(JSON.parse(localStorage.getItem('checkOpen:pid') ?? 'null')).toBe('closed')
    renderCheck()
    await screen.findByText('内積の使いどころはどれか。')
    expect(sheet()).not.toHaveAttribute('open')
    // 別の論文には引き継がない
    expect(localStorage.getItem('checkOpen:other')).toBeNull()
  })

  it('still works when localStorage throws', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: null })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    renderCheck()
    await screen.findByRole('button', { name: '問題に答えて仕分ける' })
    await userEvent.click(summaryOf())
    expect(sheet()).toHaveAttribute('open')
  })
})

describe('答え合わせ後の各問題', () => {
  it('lists every question as a <details> with the concept and the result, opening only the ones to review', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: done })
    renderCheck()
    await screen.findByText('内積は類似度の計算に使う。')
    const rows = rowDetails()
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('summary')).toHaveTextContent(/内積.*正解/)
    expect(rows[1].querySelector('summary')).toHaveTextContent(/期待値.*分からない/)
    expect(rows[0]).not.toHaveAttribute('open') // 正解は読み返さなくてよい
    expect(rows[1]).toHaveAttribute('open') // 分からない・不正解は解説を読む
  })

  it('labels a wrong answer as incorrect and opens it', async () => {
    const wrong: Check = {
      ...done,
      result: { ...done.result!, items: [{ ...done.result!.items[0], is_correct: false, chosen: 1 }, done.result!.items[1]] },
    }
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: wrong })
    renderCheck()
    await screen.findByText('内積は類似度の計算に使う。')
    const first = rowDetails()[0]
    expect(first.querySelector('summary')).toHaveTextContent('不正解')
    expect(first).toHaveAttribute('open')
  })

  it('shows the details of a closed question when its summary is opened', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: done })
    renderCheck()
    await screen.findByText('内積は類似度の計算に使う。')
    await userEvent.click(rowDetails()[0].querySelector('summary')!)
    expect(rowDetails()[0]).toHaveAttribute('open')
  })
})
