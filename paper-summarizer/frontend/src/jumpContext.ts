import { createContext, useContext } from 'react'

/** 根拠チップから左ペインの PDF へジャンプ（該当ページへスクロールし、引用箇所を強調）するための関数を配る。 */
/** switchView: false なら、狭い画面でも「PDF」タブへ切り替えない（移動は PDF が表示されたときに行われる） */
export type JumpOptions = { switchView?: boolean }
export type JumpFn = (page: number, quote?: string, options?: JumpOptions) => void
export const JumpContext = createContext<JumpFn>(() => {})
export const useJump = () => useContext(JumpContext)
