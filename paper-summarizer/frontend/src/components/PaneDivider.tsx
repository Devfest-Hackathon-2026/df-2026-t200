import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { clampSplit, SPLIT_DEFAULT, type SplitBounds } from './paneSplit'

const STEP = 2
const BIG_STEP = 10

const round = (v: number) => Math.round(v * 10) / 10

type Props = {
  /** 表示中の割合（bounds の範囲に収めた値） */
  value: number
  /** この画面幅で動かせる範囲（splitBounds） */
  bounds: SplitBounds
  onChange: (value: number) => void
  /** 割合の基準になる要素（左右のペインを並べている箱） */
  container: HTMLElement | null
}

/** PDF と解説の境目。ドラッグ・矢印キー・Home/End で動かし、ダブルクリックで半分ずつに戻す */
export function PaneDivider({ value, bounds, onChange, container }: Props) {
  const dragging = useRef<number | null>(null)
  // ドラッグ中に画面が切り替わって消えても、ドラッグ用の body のクラスを残さない
  useEffect(() => () => document.body.classList.remove('pane-resizing'), [])

  const fromPointer = (clientX: number) => {
    const rect = container?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    onChange(clampSplit(round(((clientX - rect.left) / rect.width) * 100), bounds))
  }

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== e.pointerId) return
    dragging.current = null
    document.body.classList.remove('pane-resizing')
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP
    const next: Record<string, number> = {
      ArrowLeft: value - step,
      ArrowRight: value + step,
      Home: bounds.min,
      End: bounds.max,
    }
    if (!(e.key in next)) return
    e.preventDefault()
    onChange(clampSplit(round(next[e.key]), bounds))
  }

  return (
    <div
      className="pane-divider"
      role="separator"
      aria-label="PDFと解説の幅"
      aria-orientation="vertical"
      aria-controls="view-panel-pdf"
      aria-valuenow={value}
      aria-valuetext={`PDF ${Math.round(value)}%`}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      title="ドラッグで幅を変更（ダブルクリックで半分ずつに戻す）"
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(clampSplit(SPLIT_DEFAULT, bounds))}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        dragging.current = e.pointerId
        e.currentTarget.setPointerCapture?.(e.pointerId)
        document.body.classList.add('pane-resizing')
      }}
      onPointerMove={(e) => {
        if (dragging.current === e.pointerId) fromPointer(e.clientX)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  )
}
