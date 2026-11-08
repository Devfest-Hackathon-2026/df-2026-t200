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

  it('moves focus to the heading after the answer is checked', async () => {
    vi.spyOn(api, 'getCheck').mockResolvedValue({ check: view })
    vi.spyOn(api, 'answerCheck').mockResolvedValue({ check: done })
    renderCheck()
    await userEvent.click(await screen.findByRole('radio', { name: '類似度を測る' }))
    await userEvent.click(screen.getAllByRole('radio', { name: '分からない' })[1])
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    await screen.findByText('内積は類似度の計算に使う。')
    expect(screen.getByRole('heading', { name: '確認モード' })).toHaveFocus()
  })
})
