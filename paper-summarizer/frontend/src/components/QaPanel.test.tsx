import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { answer } from '../test/fixtures'
import { QaPanel } from './QaPanel'

const user = { role: 'user' as const, text: '弱点は？', created_at: '2026-11-05T00:00:00Z' }

describe('QaPanel', () => {
  it('sends a question and shows the grounded answer', async () => {
    const ask = vi.spyOn(api, 'ask').mockResolvedValue({ messages: [user, answer] })
    render(<QaPanel paperId="pid" initial={[]} currentStep={2} />)
    await userEvent.type(screen.getByLabelText('論文への質問'), '弱点は？')
    await userEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(ask).toHaveBeenCalledWith('pid', '弱点は？', 2)
    expect(await screen.findByText('論文の4ページに書かれています')).toBeInTheDocument()
    expect(screen.getByText('論文に記載')).toBeInTheDocument()
    expect(screen.getByText('確信度 高')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('回答が届きました')
  })

  it('starts collapsed with only a one-line input', () => {
    const { container } = render(<QaPanel paperId="pid" initial={[answer]} currentStep={1} />)
    expect(screen.getByPlaceholderText('質問を入力')).toBeInTheDocument()
    expect(screen.queryByText('論文の4ページに書かれています')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この手法の弱点は？' })).not.toBeInTheDocument()
    expect(container.querySelector('.qa')).not.toHaveClass('open')
    expect(screen.getByText('（1件）')).toBeInTheDocument()
  })

  it('opens when a question is sent', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue({ messages: [user, answer] })
    const { container } = render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.type(screen.getByPlaceholderText('質問を入力'), '弱点は？{Enter}')
    expect(container.querySelector('.qa')).toHaveClass('open')
    expect(await screen.findByText('論文の4ページに書かれています')).toBeInTheDocument()
  })

  it('sends a suggested question with one click', async () => {
    const ask = vi.spyOn(api, 'ask').mockResolvedValue({ messages: [user, answer] })
    render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.click(screen.getByRole('button', { name: /質問と回答/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この手法の弱点は？' }))
    expect(ask).toHaveBeenCalledWith('pid', 'この手法の弱点は？', 1)
  })

  it('restores the input and shows the error when asking fails', async () => {
    vi.spyOn(api, 'ask').mockRejectedValue(new Error('レート制限に達しました'))
    render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.type(screen.getByPlaceholderText('質問を入力'), '質問A')
    await userEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('レート制限に達しました')
    expect(screen.getByPlaceholderText('質問を入力')).toHaveValue('質問A')
  })

  it('can be expanded and collapsed again', async () => {
    render(<QaPanel paperId="pid" initial={[answer]} currentStep={1} />)
    const toggle = screen.getByRole('button', { name: /質問と回答/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('log')).toHaveTextContent('論文の4ページに書かれています')
    expect(screen.getByText('論文の4ページに書かれています')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.queryByText('論文の4ページに書かれています')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('質問を入力')).toBeInTheDocument()
  })
})
