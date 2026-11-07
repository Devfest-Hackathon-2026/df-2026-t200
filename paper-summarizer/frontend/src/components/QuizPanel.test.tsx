import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api'
import { JumpContext } from '../jumpContext'
import { quiz, quizResult } from '../test/fixtures'
import { QuizPanel } from './QuizPanel'
import { EMPTY_DRAFT, type QuizDraft } from './quizDraft'

const renderPanel = (jump = vi.fn()) =>
  render(
    <JumpContext.Provider value={jump}>
      <QuizPanel paperId="pid" pageCount={3} />
    </JumpContext.Provider>,
  )

/** App と同じく、下書きを親が持つ。タブを移るのは panel を隠して出し直すことで表す */
function Harness() {
  const [draft, setDraft] = useState<QuizDraft>(EMPTY_DRAFT)
  const [shown, setShown] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setShown((v) => !v)}>
        タブを移る
      </button>
      {shown && <QuizPanel paperId="pid" pageCount={3} draft={draft} onDraftChange={setDraft} />}
    </>
  )
}

describe('QuizPanel', () => {
  it('says it is a separate mode that may contain wrong sentences', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: null })
    renderPanel()
    expect(await screen.findByRole('heading', { name: '誤り探しモード' })).toBeInTheDocument()
    expect(screen.getByText(/わざと誤りを混ぜた文が含まれます/)).toBeInTheDocument()
    expect(screen.getByText(/Step 1〜3と質問には誤りを混ぜていません/)).toBeInTheDocument()
  })

  it('announces loading and creating with role=status', async () => {
    let finish: (v: { quiz: typeof quiz }) => void = () => {}
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: null })
    vi.spyOn(api, 'createQuiz').mockReturnValue(new Promise((r) => (finish = r)))
    renderPanel()
    expect(screen.getByRole('status')).toHaveTextContent('読み込んでいます')
    await userEvent.click(await screen.findByRole('button', { name: '問題を作る' }))
    expect(screen.getByRole('status')).toHaveTextContent('問題を作っています')
    finish({ quiz })
    expect(await screen.findByText('提案手法は層を12枚重ねる。')).toBeInTheDocument()
  })

  it('creates a quiz on demand and does not create one by itself', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: null })
    const create = vi.spyOn(api, 'createQuiz').mockResolvedValue({ quiz })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '問題を作る' }))
    expect(create).toHaveBeenCalledWith('pid', false, expect.any(AbortSignal))
    expect(await screen.findByText('提案手法は層を12枚重ねる。')).toBeInTheDocument()
  })

  it('shows a saved quiz without calling Gemini again', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    const create = vi.spyOn(api, 'createQuiz')
    renderPanel()
    expect(await screen.findByText('注意の重みは softmax で確率にそろえる。')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('shows no answer and no new-quiz button before submitting', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    renderPanel()
    await screen.findByText('提案手法は層を12枚重ねる。')
    expect(screen.queryByText(/元の文/)).not.toBeInTheDocument()
    expect(screen.queryByText(/見つけた誤り/)).not.toBeInTheDocument()
    // 答える前に作り直せると、変わった文から誤りが分かってしまう
    expect(screen.queryByRole('button', { name: '新しい問題' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('needs a valid page for every selected sentence and explains an out-of-range page', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    renderPanel()
    const submit = await screen.findByRole('button', { name: '答え合わせ' })
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /文3/ }))
    expect(submit).toBeDisabled()
    const page = screen.getByLabelText('文3の根拠ページ')
    expect(page).not.toHaveAttribute('aria-invalid', 'true') // 未入力の間は責めない
    await userEvent.type(page, '9')
    expect(submit).toBeDisabled() // 3ページしかない
    expect(page).toHaveAttribute('aria-invalid', 'true')
    const hint = document.getElementById(page.getAttribute('aria-describedby')!)!
    expect(hint).toHaveTextContent('1〜3')
    await userEvent.clear(page)
    await userEvent.type(page, '2')
    expect(submit).toBeEnabled()
    expect(page).not.toHaveAttribute('aria-invalid', 'true')
    await userEvent.click(screen.getByRole('checkbox', { name: /文3/ }))
    expect(screen.queryByLabelText('文3の根拠ページ')).not.toBeInTheDocument()
    expect(submit).toBeDisabled()
  })

  it('submits the selected sentences with their pages, shows the result and moves focus to it', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    const answer = vi.spyOn(api, 'answerQuiz').mockResolvedValue({ quiz: quizResult })
    const jump = vi.fn()
    renderPanel(jump)
    await userEvent.click(await screen.findByRole('checkbox', { name: /文1/ }))
    await userEvent.type(screen.getByLabelText('文1の根拠ページ'), '3')
    await userEvent.click(screen.getByRole('checkbox', { name: /文3/ }))
    await userEvent.type(screen.getByLabelText('文3の根拠ページ'), '2')
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    expect(answer).toHaveBeenCalledWith(
      'pid',
      'quiz1',
      [
        { id: 'q1', page: 3 },
        { id: 'q3', page: 2 },
      ],
      expect.any(AbortSignal),
    )
    expect(await screen.findByText('見つけた誤り 1 / 1 件')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '答え合わせ' })).toHaveFocus()
    expect(screen.getByText('正しい文を誤りとした数 1 件')).toBeInTheDocument()
    // 誤りの文は元の文と並べる
    const row = screen.getByText('実験では従来手法より誤差が小さかった。').closest('li')!
    expect(within(row).getByText('実験では従来手法より誤差が大きかった。')).toBeInTheDocument()
    expect(within(row).getByText('比較の向きを逆にした')).toBeInTheDocument()
    expect(within(row).getByText(/小さかった → 大きかった/)).toBeInTheDocument()
    expect(within(row).getByText(/the error was smaller than the baseline/)).toBeInTheDocument()
    expect(within(row).getByText(/あなたの根拠ページ p\.2（正解）/)).toBeInTheDocument()
    // 根拠ページを開くと、変えた事実を述べている部分が強調される
    await userEvent.click(within(row).getByRole('button', { name: /p\.2/ }))
    expect(jump).toHaveBeenCalledWith(2, 'the error was smaller than the baseline')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('does not move focus when an answered quiz is merely reopened', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: quizResult })
    renderPanel()
    expect(await screen.findByText('見つけた誤り 1 / 1 件')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '答え合わせ' })).not.toHaveFocus()
  })

  it('shows missed errors only when there are some', async () => {
    const missed = { ...quizResult, result: { ...quizResult.result!, found: 0, missed: 1 } }
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: missed })
    renderPanel()
    expect(await screen.findByText('見逃した誤り 1 件')).toBeInTheDocument()
  })

  it('offers a new quiz only after answering, and shows limit errors without losing the result', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: quizResult })
    const create = vi
      .spyOn(api, 'createQuiz')
      .mockRejectedValueOnce(new ApiError('本日の利用上限に達しました。', 429))
      .mockResolvedValue({ quiz })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '新しい問題' }))
    expect(create).toHaveBeenCalledWith('pid', true, expect.any(AbortSignal))
    expect(await screen.findByRole('alert')).toHaveTextContent('本日の利用上限に達しました。')
    expect(screen.getByText('見つけた誤り 1 / 1 件')).toBeInTheDocument() // 失敗しても今の画面は消えない
    await userEvent.click(screen.getByRole('button', { name: '新しい問題' }))
    expect(await screen.findByRole('checkbox', { name: /文1/ })).toBeInTheDocument()
  })

  it('shows an error when loading fails', async () => {
    vi.spyOn(api, 'getQuiz').mockRejectedValue(new Error('down'))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('down')
  })

  it('keeps the selection when answering fails', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    vi.spyOn(api, 'answerQuiz').mockRejectedValue(new Error('busy'))
    renderPanel()
    await userEvent.click(await screen.findByRole('checkbox', { name: /文2/ }))
    await userEvent.type(screen.getByLabelText('文2の根拠ページ'), '1')
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('busy')
    expect(screen.getByLabelText('文2の根拠ページ')).toHaveValue(1)
  })

  it('keeps the draft (checks and pages) when the tab is left and reopened', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    render(<Harness />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /文2/ }))
    await userEvent.type(screen.getByLabelText('文2の根拠ページ'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'タブを移る' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'タブを移る' }))
    expect(await screen.findByRole('checkbox', { name: /文2/ })).toBeChecked()
    expect(screen.getByLabelText('文2の根拠ページ')).toHaveValue(3)
    expect(screen.getByRole('checkbox', { name: /文1/ })).not.toBeChecked()
  })

  it('drops a draft that belongs to a different quiz', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    const stale: QuizDraft = { quizId: 'old-quiz', entries: { q2: { checked: true, page: '1' } } }
    render(<QuizPanel paperId="pid" pageCount={3} draft={stale} onDraftChange={() => {}} />)
    expect(await screen.findByRole('checkbox', { name: /文2/ })).not.toBeChecked()
  })

  it('aborts a request in flight when it is unmounted', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: null })
    let signal: AbortSignal | undefined
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(api, 'createQuiz').mockImplementation((_id, _force, s) => {
      signal = s
      return new Promise((_resolve, reject) => s?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const { unmount } = renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '問題を作る' }))
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
    await waitFor(() => expect(error).not.toHaveBeenCalled())
  })

  it('aborts the quiz lookup when it is unmounted', async () => {
    let signal: AbortSignal | undefined
    vi.spyOn(api, 'getQuiz').mockImplementation((_id, s) => {
      signal = s
      return new Promise(() => {})
    })
    const { unmount } = renderPanel()
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
