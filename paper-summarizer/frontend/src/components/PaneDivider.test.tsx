import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PaneDivider } from './PaneDivider'
import { clampSplit, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN } from './paneSplit'

function Harness({ initial = SPLIT_DEFAULT, onChange }: { initial?: number; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(initial)
  const box = useRef<HTMLDivElement>(null)
  return (
    <div ref={box} data-testid="box">
      <PaneDivider
        value={value}
        containerRef={box}
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
