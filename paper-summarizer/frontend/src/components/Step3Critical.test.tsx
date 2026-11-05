import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { step3 } from '../test/fixtures'
import { Step3Critical } from './Step3Critical'

describe('Step3Critical', () => {
  it('hides the analysis until the student writes their thoughts', async () => {
    render(<Step3Critical data={step3} paperId="p1" />)
    expect(screen.queryByText('実装が単純')).not.toBeInTheDocument()
    const reveal = screen.getByRole('button', { name: '解説を見る' })
    expect(reveal).toBeDisabled()
    await userEvent.type(screen.getByLabelText('あなたの考え'), '実験が少ない')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('thoughts:p1')!)).toBe('実験が少ない'))
    await userEvent.click(reveal)
    expect(screen.getByText('実装が単純')).toBeInTheDocument()
  })

  it('labels paper claims and AI inferences separately', async () => {
    render(<Step3Critical data={step3} paperId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: '書かずに解説を見る' }))
    const paperItem = screen.getByText('実装が単純').closest('li')!
    const aiItem = screen.getByText('計算量が大きい').closest('li')!
    expect(paperItem).toHaveTextContent('論文の記述')
    expect(aiItem).toHaveTextContent('AIの指摘（要検証）')
    expect(screen.getByText('RNN')).toBeInTheDocument()
    expect(screen.getByText('弱点は？')).toBeInTheDocument()
  })

  it('scrolls only the explanation pane to the first result when the analysis is revealed', async () => {
    const pane = document.createElement('div')
    pane.style.overflowY = 'auto'
    const scrollTo = vi.fn()
    pane.scrollTo = scrollTo as unknown as typeof pane.scrollTo
    document.body.appendChild(pane)
    render(<Step3Critical data={step3} paperId="p1" />, { container: pane })
    await userEvent.click(screen.getByRole('button', { name: '書かずに解説を見る' }))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    pane.remove()
  })

  it('restores saved thoughts', () => {
    localStorage.setItem('thoughts:p9', '保存済み')
    render(<Step3Critical data={step3} paperId="p9" />)
    expect(screen.getByRole('textbox')).toHaveValue('保存済み')
  })
})
