import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'

/** LaTeX を KaTeX で描画する。描画できない式は元の文字列をそのまま出し、該当ページの確認を促す。 */
export function Tex({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: block, throwOnError: true, strict: 'ignore', output: 'html' })
    } catch {
      return null
    }
  }, [tex, block])
  if (html == null) {
    return (
      <code className="tex-fallback" title="数式を描画できませんでした。PDFの該当ページで確認してください">
        {tex}
      </code>
    )
  }
  return <span className={block ? 'tex-block' : 'tex-inline'} dangerouslySetInnerHTML={{ __html: html }} />
}
