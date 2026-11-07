import katex from 'katex'
import 'katex/dist/katex.min.css'
import { lazy, Suspense, useMemo } from 'react'
import { useJump } from '../jumpContext'
import { KATEX_OPTIONS } from './texOptions'

/** LaTeX を KaTeX で描画する。描画できない式は元の文字列をそのまま出し、該当ページの確認を促す。 */
// 数式を描画できたときは pdf.js を読み込まない
const PdfPageImage = lazy(() => import('./PdfPageImage'))

export type TexProps = { tex: string; block?: boolean; page?: number; pdfUrl?: string }

export default function TexRender({ tex, block = false, page, pdfUrl }: TexProps) {
  const jump = useJump()
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: block })
    } catch {
      return null
    }
  }, [tex, block])
  if (html == null && page != null) {
    return (
      <span className="tex-fallback-page">
        {pdfUrl && (
          <Suspense fallback={<span className="muted small">ページを読み込んでいます…</span>}>
            <PdfPageImage url={pdfUrl} page={page} label={`数式が載っているPDFの${page}ページ`} />
          </Suspense>
        )}
        <span className="row">
          <button type="button" className="btn" onClick={() => jump(page)}>
            PDFで確認
          </button>
          <span className="muted small">数式を描画できませんでした（p.{page}）</span>
        </span>
        <code className="tex-fallback small" title="数式の元の文字列">
          {tex}
        </code>
      </span>
    )
  }
  if (html == null) {
    return (
      <code className="tex-fallback" title="数式を描画できませんでした。PDFの該当ページで確認してください">
        {tex}
      </code>
    )
  }
  return <span className={block ? 'tex-block' : 'tex-inline'} dangerouslySetInnerHTML={{ __html: html }} />
}
