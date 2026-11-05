import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { JumpContext } from '../jump'
import { step2 } from '../test/fixtures'
import { Step2Walkthrough } from './Step2Walkthrough'

describe('Step2Walkthrough', () => {
  it('jumps the PDF to the first evidence of the current stage', () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={step2} />
      </JumpContext.Provider>,
    )
    expect(jump).toHaveBeenCalledWith(2, 'we embed tokens')
    expect(screen.getByText('全体構成')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
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
