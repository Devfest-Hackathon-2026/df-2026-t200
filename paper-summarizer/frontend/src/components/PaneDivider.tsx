import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { clampSplit, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN } from './paneSplit'

const STEP = 2
const BIG_STEP = 10

const round = (v: number) => Math.round(v * 10) / 10

type Props = {
  value: number
  onChange: (value: number) => void
  /** 割合の基準になる要素（左右のペインを並べている箱） */
  containerRef: RefObject<HTMLElement | null>
}

/** PDF と解説の境目。ドラッグ・矢印キー・Home/End で動かし、ダブルクリックで半分ずつに戻す */
export function PaneDivider({ value, onChange, containerRef }: Props) {
  const dragging = useRef<number | null>(null)

  const fromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    onChange(clampSplit(round(((clientX - rect.left) / rect.width) * 100)))
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
      Home: SPLIT_MIN,
      End: SPLIT_MAX,
    }
    if (!(e.key in next)) return
    e.preventDefault()
    onChange(clampSplit(next[e.key]))
  }

  return (
    <div
      className="pane-divider"
      role="separator"
      aria-label="PDFと解説の幅"
      aria-orientation="vertical"
      aria-controls="view-panel-pdf"
      aria-valuenow={value}
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      tabIndex={0}
      title="ドラッグで幅を変更（ダブルクリックで半分ずつに戻す）"
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(SPLIT_DEFAULT)}
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
