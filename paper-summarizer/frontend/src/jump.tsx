import { createContext, useContext } from 'react'
import type { Evidence } from './api'

/** 根拠チップから左ペインの PDF へジャンプ（該当ページへスクロールし、引用箇所を強調）するための関数を配る。 */
/** switchView: false なら、狭い画面でも「PDF」タブへ切り替えない（移動は PDF が表示されたときに行われる） */
export type JumpOptions = { switchView?: boolean }
export type JumpFn = (page: number, quote?: string, options?: JumpOptions) => void
export const JumpContext = createContext<JumpFn>(() => {})
export const useJump = () => useContext(JumpContext)

export function EvidenceChip({ ev, label }: { ev: Evidence; label?: string }) {
  const jump = useJump()
  const unverified = ev.verified === false
  return (
    <button
      type="button"
      className={`chip evidence ${unverified ? 'unverified' : ''}`}
      onClick={() => jump(ev.page, ev.quote)}
      title={unverified ? `PDF内で引用を確認できませんでした（要確認）\n“${ev.quote}”` : `“${ev.quote}”`}
    >
      {label ?? `p.${ev.page}`}
      {unverified && <span className="chip-flag">未確認</span>}
    </button>
  )
}

export function PageChip({ page, label }: { page: number | null; label?: string }) {
  const jump = useJump()
  if (page == null) return null
  return (
    <button type="button" className="chip" onClick={() => jump(page)}>
      {label ?? `p.${page}`}
    </button>
  )
}

export function EvidenceList({ items }: { items: Evidence[] }) {
  if (!items?.length) return null
  return (
    <span className="chips">
      {items.map((ev, i) => (
        <EvidenceChip key={i} ev={ev} />
      ))}
    </span>
  )
}
