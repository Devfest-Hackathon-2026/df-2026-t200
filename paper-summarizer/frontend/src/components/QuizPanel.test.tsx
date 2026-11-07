import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api'
import { JumpContext } from '../jumpContext'
import { quiz, quizResult } from '../test/fixtures'
import { QuizPanel } from './QuizPanel'

const renderPanel = (jump = vi.fn()) =>
  render(
    <JumpContext.Provider value={jump}>
      <QuizPanel paperId="pid" pageCount={3} />
    </JumpContext.Provider>,
  )

describe('QuizPanel', () => {
  it('says it is a separate mode that may contain wrong sentences', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: null })
    renderPanel()
    expect(await screen.findByRole('heading', { name: '誤り探しモード' })).toBeInTheDocument()
    expect(screen.getByText(/わざと誤りを混ぜた文が含まれます/)).toBeInTheDocument()
    expect(screen.getByText(/Step 1〜3と質問には誤りを混ぜていません/)).toBeInTheDocument()
  })

  it('creates a quiz on demand and does not create one by itself', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: null })
    const create = vi.spyOn(api, 'createQuiz').mockResolvedValue({ quiz })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '問題を作る' }))
    expect(create).toHaveBeenCalledWith('pid', false)
    expect(await screen.findByText('提案手法は層を12枚重ねる。')).toBeInTheDocument()
  })

  it('shows a saved quiz without calling Gemini again', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    const create = vi.spyOn(api, 'createQuiz')
    renderPanel()
    expect(await screen.findByText('注意の重みは softmax で確率にそろえる。')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('shows no answer before submitting', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    renderPanel()
    await screen.findByText('提案手法は層を12枚重ねる。')
    expect(screen.queryByText(/元の文/)).not.toBeInTheDocument()
    expect(screen.queryByText(/見つけた誤り/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('needs a page for every selected sentence before it can submit', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    renderPanel()
    const submit = await screen.findByRole('button', { name: '答え合わせ' })
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /文3/ }))
    expect(submit).toBeDisabled()
    const page = screen.getByLabelText('文3の根拠ページ')
    await userEvent.type(page, '9')
    expect(submit).toBeDisabled() // 3ページしかない
    await userEvent.clear(page)
    await userEvent.type(page, '2')
    expect(submit).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /文3/ }))
    expect(screen.queryByLabelText('文3の根拠ページ')).not.toBeInTheDocument()
    expect(submit).toBeDisabled()
  })

  it('submits the selected sentences with their pages and shows the result', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz })
    const answer = vi.spyOn(api, 'answerQuiz').mockResolvedValue({ quiz: quizResult })
    const jump = vi.fn()
    renderPanel(jump)
    await userEvent.click(await screen.findByRole('checkbox', { name: /文1/ }))
    await userEvent.type(screen.getByLabelText('文1の根拠ページ'), '3')
    await userEvent.click(screen.getByRole('checkbox', { name: /文3/ }))
    await userEvent.type(screen.getByLabelText('文3の根拠ページ'), '2')
    await userEvent.click(screen.getByRole('button', { name: '答え合わせ' }))
    expect(answer).toHaveBeenCalledWith('pid', 'quiz1', [
      { id: 'q1', page: 3 },
      { id: 'q3', page: 2 },
    ])
    expect(await screen.findByText('見つけた誤り 1 / 1 件')).toBeInTheDocument()
    expect(screen.getByText('正しい文を誤りとした数 1 件')).toBeInTheDocument()
    // 誤りの文は元の文と並べる
    const row = screen.getByText('実験では従来手法より誤差が小さかった。').closest('li')!
    expect(within(row).getByText('実験では従来手法より誤差が大きかった。')).toBeInTheDocument()
    expect(within(row).getByText('比較の向きを逆にした')).toBeInTheDocument()
    expect(within(row).getByText(/あなたの根拠ページ p\.2（正解）/)).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: /p\.2/ }))
    expect(jump).toHaveBeenCalledWith(2, 'the error was smaller than the baseline')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('shows the result of an already answered quiz when reopened', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: quizResult })
    renderPanel()
    expect(await screen.findByText('見つけた誤り 1 / 1 件')).toBeInTheDocument()
  })

  it('shows missed errors only when there are some', async () => {
    const missed = { ...quizResult, result: { ...quizResult.result!, found: 0, missed: 1 } }
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: missed })
    renderPanel()
    expect(await screen.findByText('見逃した誤り 1 件')).toBeInTheDocument()
  })

  it('creates a fresh quiz with the new-quiz button and shows limit errors', async () => {
    vi.spyOn(api, 'getQuiz').mockResolvedValue({ quiz: quizResult })
    const create = vi
      .spyOn(api, 'createQuiz')
      .mockRejectedValueOnce(new ApiError('本日の利用上限に達しました。', 429))
      .mockResolvedValue({ quiz })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '新しい問題' }))
    expect(create).toHaveBeenCalledWith('pid', true)
    expect(await screen.findByRole('alert')).toHaveTextContent('本日の利用上限に達しました。')
    expect(screen.getByText('見つけた誤り 1 / 1 件')).toBeInTheDocument() // 失敗しても今の画面は消えない
    await userEvent.click(screen.getByRole('button', { name: '新しい問題' }))
    expect(await screen.findByRole('checkbox', { name: /文1/ })).toBeInTheDocument()
  })

  it('shows an error when loading or answering fails', async () => {
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
})
