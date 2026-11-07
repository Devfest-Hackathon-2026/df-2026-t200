import type { ReactNode } from 'react'

// `code` を先に拾うので、コードの中の ** は記号のまま出る。閉じていない記号や空（**** や ``）は一致せず文字のまま残る
const TOKEN = /`([^`\n]+)`|\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g

/** 回答の太字（**x**）とインラインコード（`x`）だけを React の要素にする。HTML は使わない */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[1] !== undefined ? <code key={m.index}>{m[1]}</code> : <strong key={m.index}>{m[2]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
