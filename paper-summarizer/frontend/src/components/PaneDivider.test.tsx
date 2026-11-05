import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PaneDivider } from './PaneDivider'
import { clampSplit, splitBounds, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, type SplitBounds } from './paneSplit'

function Harness({
  initial = SPLIT_DEFAULT,
  bounds = { min: SPLIT_MIN, max: SPLIT_MAX },
  onChange,
}: {
  initial?: number
  bounds?: SplitBounds
  onChange?: (v: number) => void
}) {
  const [value, setValue] = useState(initial)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setBox} data-testid="box">
      <PaneDivider
        value={value}
        bounds={bounds}
        container={box}
        onChange={(v) => {
          setValue(v)
          onChange?.(v)
        }}
      />
    </div>
  )
}

const divider = () => screen.getByRole('separator', { name: 'PDFと解説の幅' })

describe('clampSplit', () => {
  it('keeps the split between the minimum and maximum', () => {
    expect(clampSplit(10)).toBe(SPLIT_MIN)
    expect(clampSplit(90)).toBe(SPLIT_MAX)
    expect(clampSplit(42.4)).toBe(42.4)
    expect(clampSplit(Number.NaN)).toBe(SPLIT_DEFAULT)
    expect(clampSplit(70, { min: 30, max: 57.1 })).toBe(57.1)
  })
})

describe('splitBounds', () => {
  it('leaves room for both panes on a narrow window', () => {
    // 901px: PDF に 240px、解説に 380px、境目に 12px を残すと 27.4〜57.1%
    expect(splitBounds(901)).toEqual({ min: 27.4, max: 57.1 })
  })

  it('uses the percentage limits on a wide window', () => {
    expect(splitBounds(2000)).toEqual({ min: SPLIT_MIN, max: SPLIT_MAX })
  })

  it('falls back to the percentage limits when the width is unknown or too small', () => {
    expect(splitBounds(0)).toEqual({ min: SPLIT_MIN, max: SPLIT_MAX })
    expect(splitBounds(500)).toEqual({ min: SPLIT_MIN, max: SPLIT_MAX })
  })
})

describe('PaneDivider', () => {
  it('exposes its position to assistive technology', () => {
    render(<Harness initial={40} />)
    const sep = divider()
    expect(sep).toHaveAttribute('aria-orientation', 'vertical')
    expect(sep).toHaveAttribute('aria-valuenow', '40')
    expect(sep).toHaveAttribute('aria-valuemin', String(SPLIT_MIN))
    expect(sep).toHaveAttribute('aria-valuemax', String(SPLIT_MAX))
    expect(sep).toHaveAttribute('aria-controls', 'view-panel-pdf')
    expect(sep).toHaveAttribute('tabindex', '0')
    expect(sep).toHaveAttribute('aria-valuetext', 'PDF 40%')
  })

  it('keeps the keys and the announced range inside the bounds for this window', () => {
    render(<Harness initial={50} bounds={{ min: 27.4, max: 57.1 }} />)
    const sep = divider()
    expect(sep).toHaveAttribute('aria-valuemin', '27.4')
    expect(sep).toHaveAttribute('aria-valuemax', '57.1')
    fireEvent.keyDown(sep, { key: 'ArrowRight', shiftKey: true })
    expect(sep).toHaveAttribute('aria-valuenow', '57.1')
    fireEvent.keyDown(sep, { key: 'Home' })
    expect(sep).toHaveAttribute('aria-valuenow', '27.4')
  })

  it('cleans up the dragging state if it unmounts in the middle of a drag', () => {
    const { unmount } = render(<Harness />)
    fireEvent.pointerDown(divider(), { clientX: 600, pointerId: 1, button: 0 })
    expect(document.body).toHaveClass('pane-resizing')
    unmount()
    expect(document.body).not.toHaveClass('pane-resizing')
  })

  it('moves with the arrow keys and stops at the limits', () => {
    render(<Harness initial={50} />)
    const sep = divider()
    fireEvent.keyDown(sep, { key: 'ArrowRight' })
    expect(sep).toHaveAttribute('aria-valuenow', '52')
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(sep).toHaveAttribute('aria-valuenow', '48')
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true })
    expect(sep).toHaveAttribute('aria-valuenow', '38')
    fireEvent.keyDown(sep, { key: 'Home' })
    expect(sep).toHaveAttribute('aria-valuenow', String(SPLIT_MIN))
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(sep).toHaveAttribute('aria-valuenow', String(SPLIT_MIN))
    fireEvent.keyDown(sep, { key: 'End' })
    expect(sep).toHaveAttribute('aria-valuenow', String(SPLIT_MAX))
  })

  it('ignores keys it does not handle', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.keyDown(divider(), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('returns to the middle on double click', () => {
    render(<Harness initial={30} />)
    fireEvent.doubleClick(divider())
    expect(divider()).toHaveAttribute('aria-valuenow', String(SPLIT_DEFAULT))
  })

  it('follows the pointer while dragging, relative to the container', () => {
    render(<Harness />)
    const box = screen.getByTestId('box')
    box.getBoundingClientRect = () => ({
      left: 100,
      width: 1000,
      top: 0,
      height: 600,
      right: 1100,
      bottom: 600,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    const sep = divider()
    fireEvent.pointerDown(sep, { clientX: 600, pointerId: 1, button: 0 })
    expect(document.body).toHaveClass('pane-resizing')
    fireEvent.pointerMove(sep, { clientX: 400, pointerId: 1 })
    expect(sep).toHaveAttribute('aria-valuenow', '30')
    // 最小幅より左へは行かない
    fireEvent.pointerMove(sep, { clientX: 120, pointerId: 1 })
    expect(sep).toHaveAttribute('aria-valuenow', String(SPLIT_MIN))
    fireEvent.pointerUp(sep, { clientX: 120, pointerId: 1 })
    expect(document.body).not.toHaveClass('pane-resizing')
    // 離したあとの移動では動かない
    fireEvent.pointerMove(sep, { clientX: 700, pointerId: 1 })
    expect(sep).toHaveAttribute('aria-valuenow', String(SPLIT_MIN))
  })

  it('does not start dragging with a secondary mouse button', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const sep = divider()
    fireEvent.pointerDown(sep, { clientX: 600, pointerId: 1, button: 2 })
    fireEvent.pointerMove(sep, { clientX: 400, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
