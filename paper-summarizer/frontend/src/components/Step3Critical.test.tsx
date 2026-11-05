import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { step3 } from '../test/fixtures'
import { Step3Critical } from './Step3Critical'

describe('Step3Critical', () => {
  it('hides the analysis until the student writes their thoughts', async () => {
    render(<Step3Critical data={step3} paperId="p1" />)
    expect(screen.queryByText('実装が単純')).not.toBeInTheDocument()
    const reveal = screen.getByRole('button', { name: '考えを書いたので解説を見る' })
    expect(reveal).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), '実験が少ない')
    expect(localStorage.getItem('thoughts:p1')).toBe('実験が少ない')
    await userEvent.click(reveal)
    expect(screen.getByText('実装が単純')).toBeInTheDocument()
  })

  it('labels paper claims and AI inferences separately', async () => {
    render(<Step3Critical data={step3} paperId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: '書かずに見る' }))
    const paperItem = screen.getByText('実装が単純').closest('li')!
    const aiItem = screen.getByText('計算量が大きい').closest('li')!
    expect(paperItem).toHaveTextContent('論文の記述')
    expect(aiItem).toHaveTextContent('AIの指摘・要検証')
    expect(screen.getByText('RNN')).toBeInTheDocument()
    expect(screen.getByText('弱点は？')).toBeInTheDocument()
  })

  it('restores saved thoughts', () => {
    localStorage.setItem('thoughts:p9', '保存済み')
    render(<Step3Critical data={step3} paperId="p9" />)
    expect(screen.getByRole('textbox')).toHaveValue('保存済み')
  })
})
