import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { JumpContext } from '../jump'
import { step2 } from '../test/fixtures'
import { Step2Walkthrough } from './Step2Walkthrough'

describe('Step2Walkthrough', () => {
  it('highlights the first stage evidence once when the step is opened, without switching views', () => {
    const jump = vi.fn()
    const { rerender } = render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={step2} />
      </JumpContext.Provider>,
    )
    expect(jump).toHaveBeenCalledTimes(1)
    expect(jump).toHaveBeenCalledWith(2, 'we embed tokens', { switchView: false })
    expect(screen.getByText('全体構成')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    // 解析中の定期取得でデータが新しいオブジェクトになっても、もう一度は移動しない
    rerender(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={{ ...step2, stages: [...step2.stages] }} />
      </JumpContext.Provider>,
    )
    expect(jump).toHaveBeenCalledTimes(1)
  })

  it('does not move the PDF on open when the first stage has no evidence or figure', () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={{ ...step2, stages: [step2.stages[1]] }} />
      </JumpContext.Provider>,
    )
    expect(jump).not.toHaveBeenCalled()
  })

  it('jumps the PDF to the evidence of the stage the student moves to', async () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={step2} />
      </JumpContext.Provider>,
    )
    jump.mockClear() // 開いたときの強調は別のテストで確かめる
    await userEvent.click(screen.getByRole('button', { name: '次の段階 →' }))
    // 段階2には根拠も図表もないので移動しない
    expect(jump).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /入力の埋め込み/ }))
    expect(jump).toHaveBeenCalledWith(2, 'we embed tokens')
  })

  it('falls back to the first figure page when a stage has no evidence', async () => {
    const jump = vi.fn()
    const data = { ...step2, stages: [step2.stages[1], { ...step2.stages[0], evidence: [] }] }
    render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={data} />
      </JumpContext.Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '次の段階 →' }))
    expect(jump).toHaveBeenCalledWith(3)
  })

  it('moves between stages with next/prev buttons', async () => {
    render(<Step2Walkthrough data={step2} />)
    const prev = screen.getByRole('button', { name: '← 前の段階' })
    const next = screen.getByRole('button', { name: '次の段階 →' })
    expect(prev).toBeDisabled()
    await userEvent.click(next)
    expect(screen.getByText('確率を出す')).toBeInTheDocument()
    expect(next).toBeDisabled()
    await userEvent.click(prev)
    expect(screen.getByText('単語をベクトルにする')).toBeInTheDocument()
  })

  it('shows a message when there are no stages', () => {
    render(<Step2Walkthrough data={{ overview: '', stages: [] }} />)
    expect(screen.getByText('ウォークスルーを生成できませんでした。')).toBeInTheDocument()
  })
})
