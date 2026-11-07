import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { JumpContext } from '../jumpContext'
import { step2 } from '../test/fixtures'
import { Step2Walkthrough } from './Step2Walkthrough'

const concepts = [
  { id: 'attention', name: 'Attention' },
  { id: 'expectation', name: '期待値' },
]

describe('Step2Walkthrough equation concepts', () => {
  it('shows the prerequisite concepts of an equation and opens the one that is clicked', async () => {
    const onOpenConcept = vi.fn()
    render(<Step2Walkthrough data={step2} concepts={concepts} onOpenConcept={onOpenConcept} />)
    const group = screen.getByRole('group', { name: 'この式に必要な前提' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Attention', '期待値'])
    await userEvent.click(within(group).getByRole('button', { name: '期待値' }))
    expect(onOpenConcept).toHaveBeenCalledWith('expectation')
  })

  it('shows no prerequisite section when the equation has no known concepts (old results)', () => {
    const old = { ...step2, stages: [{ ...step2.stages[0], equations: [{ ...step2.stages[0].equations[0], concepts: undefined }] }] }
    render(<Step2Walkthrough data={old} concepts={concepts} onOpenConcept={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'この式に必要な前提' })).not.toBeInTheDocument()
    cleanup()
    render(<Step2Walkthrough data={step2} />)
    expect(screen.queryByRole('group', { name: 'この式に必要な前提' })).not.toBeInTheDocument()
  })

  it('starts at the focused stage and moves the PDF to the equation page instead of the first stage', () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={step2} focus={{ stage: 0, index: 0 }} />
      </JumpContext.Provider>,
    )
    expect(jump).toHaveBeenCalledTimes(1)
    expect(jump).toHaveBeenCalledWith(3, undefined, { switchView: false })
  })

  it('ignores a focus that points at a missing stage or equation', () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={step2} focus={{ stage: 9, index: 4 }} />
      </JumpContext.Provider>,
    )
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(jump).toHaveBeenCalledWith(2, 'we embed tokens', { switchView: false })
  })

  it('scrolls the focused equation card to the center', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      render(<Step2Walkthrough data={step2} focus={{ stage: 0, index: 0 }} />)
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(scroll).toHaveBeenCalledWith({ block: 'center' })
      expect(document.getElementById('equation-0-0')).toBeInTheDocument()
    } finally {
      // @ts-expect-error jsdom には無いので元に戻す
      delete Element.prototype.scrollIntoView
    }
  })

  it('does not scroll without a focus', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      render(<Step2Walkthrough data={step2} />)
      expect(scroll).not.toHaveBeenCalled()
    } finally {
      // @ts-expect-error jsdom には無いので元に戻す
      delete Element.prototype.scrollIntoView
    }
  })
})
