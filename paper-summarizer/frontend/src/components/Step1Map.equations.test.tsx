import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { step1, step1Old, step2 } from '../test/fixtures'
import { Step1Map } from './Step1Map'

const detail = () => document.querySelector('.concept-detail') as HTMLElement
const level = (name: string) => screen.getByRole('button', { name })

describe('Step1Map equations that use a concept', () => {
  it('lists the equations that use the selected concept and opens the one that is clicked', async () => {
    const onOpenEquation = vi.fn()
    render(<Step1Map data={step1} paperId="pe1" step2={step2} onOpenEquation={onOpenEquation} />)
    await userEvent.click(screen.getByRole('button', { name: /Attention/ }))
    const group = within(detail()).getByRole('group', { name: 'この概念を使う式' })
    await userEvent.click(within(group).getByRole('button', { name: '式 (1)（p.3）' }))
    expect(onOpenEquation).toHaveBeenCalledWith(0, 0)
  })

  it('shows nothing for a concept that no equation uses', async () => {
    render(<Step1Map data={step1} paperId="pe2" step2={step2} onOpenEquation={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /softmax/ }))
    expect(screen.queryByRole('group', { name: 'この概念を使う式' })).not.toBeInTheDocument()
  })

  it('does not crash with old Step 1 results and no Step 2', () => {
    render(<Step1Map data={step1Old} paperId="pe3" />)
    expect(screen.queryByRole('group', { name: 'この概念を使う式' })).not.toBeInTheDocument()
  })

  it('selects the focused concept', () => {
    render(<Step1Map data={step1} paperId="pe4" focus={{ id: 'softmax' }} />)
    expect(within(detail()).getByRole('heading', { name: 'softmax' })).toBeInTheDocument()
  })

  it('switches to "all" when the focused concept is hidden by the importance filter', () => {
    localStorage.setItem('conceptLevel:pe5', JSON.stringify('essential'))
    render(<Step1Map data={step1} paperId="pe5" focus={{ id: 'expectation' }} />)
    expect(within(detail()).getByRole('heading', { name: '期待値' })).toBeInTheDocument()
    expect(level('すべて')).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not save the temporary "all", but saves a level the student picks', async () => {
    localStorage.setItem('conceptLevel:pe8', JSON.stringify('essential'))
    const { unmount } = render(<Step1Map data={step1} paperId="pe8" focus={{ id: 'expectation' }} />)
    unmount()
    expect(JSON.parse(localStorage.getItem('conceptLevel:pe8')!)).toBe('essential')
    render(<Step1Map data={step1} paperId="pe8" focus={{ id: 'expectation' }} />)
    expect(level('すべて')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(level('推奨まで'))
    expect(level('推奨まで')).toHaveAttribute('aria-pressed', 'true')
    cleanup()
    expect(JSON.parse(localStorage.getItem('conceptLevel:pe8')!)).toBe('recommended')
  })

  it('keeps the chosen level when the focused concept is already visible', () => {
    localStorage.setItem('conceptLevel:pe6', JSON.stringify('essential'))
    render(<Step1Map data={step1} paperId="pe6" focus={{ id: 'attention' }} />)
    expect(level('必須だけ')).toHaveAttribute('aria-pressed', 'true')
    expect(within(detail()).getByRole('heading', { name: 'Attention' })).toBeInTheDocument()
  })

  it('ignores a focus on an unknown concept', () => {
    render(<Step1Map data={step1} paperId="pe7" focus={{ id: 'ghost' }} />)
    expect(within(detail()).getByRole('heading', { name: '内積' })).toBeInTheDocument()
  })
})
