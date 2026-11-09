import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Progress } from '../api'
import { AnalysisProgress } from './AnalysisProgress'
import { formatChars, formatElapsed, stepLabel, stepLine } from './progressText'

describe('progress text', () => {
  it('rounds characters to the nearest hundred and keeps small counts exact', () => {
    expect(formatChars(0)).toBe('')
    expect(formatChars(42)).toBe('42字')
    expect(formatChars(1180)).toBe('約1,200字')
    expect(formatChars(24_049)).toBe('約24,000字')
  })

  it('formats elapsed seconds', () => {
    expect(formatElapsed(0)).toBe('0秒')
    expect(formatElapsed(18.7)).toBe('18秒')
    expect(formatElapsed(60)).toBe('1分00秒')
    expect(formatElapsed(125)).toBe('2分05秒')
  })

  it('describes what each phase is doing', () => {
    expect(stepLabel(1, 'reading')).toBe('Step 1：論文を読んでいます')
    expect(stepLabel(2, 'writing')).toBe('Step 2：解説を書いています')
    expect(stepLabel(3, 'verifying')).toBe('Step 3：引用を照合しています')
    expect(stepLabel(1, 'done')).toBe('Step 1：完了')
  })

  it('puts characters and time in brackets only when known', () => {
    expect(stepLine(1, { phase: 'writing', chars: 1200, elapsed: 18 }, 18)).toBe('Step 1：解説を書いています（約1,200字・18秒）')
    expect(stepLine(1, { phase: 'reading', chars: 0, elapsed: 3 }, 3)).toBe('Step 1：論文を読んでいます（3秒）')
    expect(stepLine(2, { phase: 'writing', chars: 300 }, undefined)).toBe('Step 2：解説を書いています（約300字）')
    expect(stepLine(2, { phase: 'reading', chars: 0 }, undefined)).toBe('Step 2：論文を読んでいます')
  })
})

describe('AnalysisProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const writing: Progress = { step1: { phase: 'writing', chars: 1200, elapsed: 18 } }

  it('shows nothing before any progress is known', () => {
    const { container } = render(<AnalysisProgress progress={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows what is being done, the characters and the elapsed time', () => {
    render(<AnalysisProgress progress={writing} />)
    expect(screen.getByText('Step 1：解説を書いています（約1,200字・18秒）')).toBeInTheDocument()
  })

  it('advances the elapsed time every second without a new event', () => {
    render(<AnalysisProgress progress={writing} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('Step 1：解説を書いています（約1,200字・21秒）')).toBeInTheDocument()
  })

  it('restarts from the server time when a new event arrives', () => {
    const { rerender } = render(<AnalysisProgress progress={writing} />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    rerender(<AnalysisProgress progress={{ step1: { phase: 'writing', chars: 1800, elapsed: 22 } }} />)
    expect(screen.getByText('Step 1：解説を書いています（約1,800字・22秒）')).toBeInTheDocument()
  })

  it('shows Step 2 and Step 3 together, and stops the clock of a finished step', () => {
    const progress: Progress = {
      step1: { phase: 'done', chars: 2000, elapsed: 30 },
      step2: { phase: 'writing', chars: 900, elapsed: 10 },
      step3: { phase: 'verifying', chars: 700, elapsed: 8 },
    }
    render(<AnalysisProgress progress={progress} />)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('Step 1：完了（30秒）')).toBeInTheDocument()
    expect(screen.getByText('Step 2：解説を書いています（約900字・12秒）')).toBeInTheDocument()
    expect(screen.getByText('Step 3：引用を照合しています（約700字・10秒）')).toBeInTheDocument()
  })

  it('announces only the phase wording, never the changing numbers', () => {
    render(<AnalysisProgress progress={writing} />)
    const live = screen.getByRole('status')
    expect(live).toHaveTextContent('Step 1：解説を書いています')
    expect(live).not.toHaveTextContent('18')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByRole('status')).toHaveTextContent(/^Step 1：解説を書いています$/)
  })

  it('stops the timer on unmount', () => {
    const { unmount } = render(<AnalysisProgress progress={writing} />)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not tick when no step has a running clock', () => {
    render(<AnalysisProgress progress={{ step1: { phase: 'writing', chars: 10 } }} />)
    expect(vi.getTimerCount()).toBe(0)
  })
})
