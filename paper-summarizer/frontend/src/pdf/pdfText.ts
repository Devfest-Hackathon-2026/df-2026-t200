/** PDF のテキストレイヤー上で引用を探して強調する処理（DOM だけを扱うので pdf.js なしでテストできる）。 */

const HL = 'hl'

/** 空白・記号を除いて比較する（改行やハイフネーションで分割された引用でも一致させるため） */
export const squash = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/­/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** root の下（全ページ）の強調を消す */
export function clearHighlights(root: ParentNode) {
  root.querySelectorAll(`.${HL}`).forEach((el) => el.classList.remove(HL))
}

/** テキストレイヤー内の引用箇所を強調し、最初の要素を返す。見つからなければ null。 */
export function highlightQuote(layer: HTMLElement, quote: string): HTMLElement | null {
  clearHighlights(layer)
  const spans = Array.from(layer.querySelectorAll('span')).filter((s) => s.childElementCount === 0) as HTMLElement[]
  let full = ''
  const ranges: { start: number; end: number; el: HTMLElement }[] = []
  for (const el of spans) {
    const t = squash(el.textContent ?? '')
    if (!t) continue
    ranges.push({ start: full.length, end: full.length + t.length, el })
    full += t
  }
  const q = squash(quote)
  if (q.length < 4) return null
  // 完全一致 → 前半 → 後半 の順に探す（Gemini の引用がわずかに崩れていても強調できるように）
  const candidates = [q, q.slice(0, Math.ceil(q.length / 2)), q.slice(Math.floor(q.length / 2))]
  for (const c of candidates) {
    if (c.length < 12 && c !== q) continue
    const at = full.indexOf(c)
    if (at < 0) continue
    const end = at + c.length
    const hit = ranges.filter((r) => r.end > at && r.start < end)
    hit.forEach((r) => r.el.classList.add(HL))
    return hit[0]?.el ?? null
  }
  return null
}

/** pdf.js が描画を中断したときの例外（再描画・アンマウントで起きる。エラーとして表示しない） */
export function isCancellation(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name
  return name === 'RenderingCancelledException' || name === 'AbortException'
}
