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
    await userEvent.type(screen.getByPlaceholderText('論文について質問する'), '弱点は？')
    await userEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(ask).toHaveBeenCalledWith('pid', '弱点は？', 2)
    expect(await screen.findByText('論文の4ページに書かれています')).toBeInTheDocument()
    expect(screen.getByText('論文に記載')).toBeInTheDocument()
    expect(screen.getByText('確信度: 高')).toBeInTheDocument()
  })

  it('sends a suggested question with one click', async () => {
    const ask = vi.spyOn(api, 'ask').mockResolvedValue({ messages: [user, answer] })
    render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'この手法の弱点は？' }))
    expect(ask).toHaveBeenCalledWith('pid', 'この手法の弱点は？', 1)
  })

  it('restores the input and shows the error when asking fails', async () => {
    vi.spyOn(api, 'ask').mockRejectedValue(new Error('レート制限に達しました'))
    render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.type(screen.getByPlaceholderText('論文について質問する'), '質問A')
    await userEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(await screen.findByText('レート制限に達しました')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('論文について質問する')).toHaveValue('質問A')
  })

  it('can be collapsed', async () => {
    render(<QaPanel paperId="pid" initial={[answer]} currentStep={1} />)
    await userEvent.click(screen.getByRole('button', { name: /根拠付きQ&A/ }))
    expect(screen.queryByPlaceholderText('論文について質問する')).not.toBeInTheDocument()
  })
})
