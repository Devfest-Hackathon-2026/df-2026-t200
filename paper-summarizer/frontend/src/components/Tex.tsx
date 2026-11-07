import { lazy, Suspense } from 'react'
import type { TexProps } from './TexRender'

// KaTeX とそのCSS・フォントは大きいので、数式を表示するときまで読み込まない
const TexRender = lazy(() => import('./TexRender'))

/** LaTeX を KaTeX で描画する。読み込み中は元の文字列を出し、描画できない式の扱いは TexRender に任せる。 */
export function Tex({ tex, block = false, page, pdfUrl }: TexProps) {
  return (
    <Suspense fallback={<code className="tex-loading">{tex}</code>}>
      <TexRender tex={tex} block={block} page={page} pdfUrl={pdfUrl} />
    </Suspense>
  )
}
