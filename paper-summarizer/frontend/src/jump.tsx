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
  const verified = ev.verified === true
  return (
    <button
      type="button"
      className={`chip evidence ${unverified ? 'unverified' : ''} ${verified ? 'verified' : ''}`.trim()}
      onClick={() => jump(ev.page, ev.quote)}
      title={unverified ? `PDFの中でこの引用を見つけられませんでした。原文で確かめてください。\n“${ev.quote}”` : `“${ev.quote}”`}
    >
      {label ?? `p.${ev.page}`}
      {unverified && <span className="chip-flag">未確認</span>}
      {verified && <span className="chip-flag">照合済み</span>}
    </button>
  )
}

export function PageChip({ page, label }: { page: number | null; label?: string }) {
  const jump = useJump()
  if (page == null) return null
  return (
    <button type="button" className="chip page" onClick={() => jump(page)}>
      {label ?? `p.${page}を開く`}
    </button>
  )
}

export function EvidenceList({ items }: { items: Evidence[] }) {
  if (!items?.length) return null
  return (
    <span className="chips">
      <span className="chips-label">根拠</span>
      {items.map((ev, i) => (
        <EvidenceChip key={i} ev={ev} />
      ))}
    </span>
  )
}
