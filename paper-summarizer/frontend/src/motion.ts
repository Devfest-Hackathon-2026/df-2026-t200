/** 動きを減らす設定のときは、スクロールのアニメーションをしない */
export const scrollBehavior = (): ScrollBehavior => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

/** el を囲む、いちばん近いスクロールできる要素。見つからなければ null（ページ全体は動かさない） */
export function scrollContainer(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

/**
 * el が見えるよう、el を囲むスクロール欄だけを動かす。
 * scrollIntoView は外側の要素やページ全体までスクロールさせるので使わない。
 */
export function scrollWithin(el: Element, block: 'start' | 'center' | 'end', behavior: ScrollBehavior = 'auto') {
  const box = scrollContainer(el)
  // 隠れている欄（狭い画面で表示していないタブ）は大きさが 0 になり、位置を測れないので動かさない
  if (!box || box.clientHeight === 0) return
  const r = el.getBoundingClientRect()
  const offset = r.top - box.getBoundingClientRect().top + box.scrollTop
  const top =
    block === 'start' ? offset : block === 'center' ? offset - (box.clientHeight - r.height) / 2 : offset - box.clientHeight + r.height
  const clamped = Math.max(0, top)
  if (typeof box.scrollTo === 'function') box.scrollTo({ top: clamped, behavior })
  else box.scrollTop = clamped
}
