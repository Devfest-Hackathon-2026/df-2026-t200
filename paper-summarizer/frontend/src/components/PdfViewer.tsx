import 'pdfjs-dist/web/pdf_viewer.css'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { clearHighlights } from '../pdf/pdfText'
import { usePdfDocument } from '../pdf/usePdfDocument'
import { PageView, type Target } from './PageView'

export type PdfViewerHandle = { jumpTo: (page: number, quote?: string) => void }

export const PdfViewer = forwardRef<PdfViewerHandle, { url: string }>(function PdfViewer({ url }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nonce = useRef(0)
  const { doc, error } = usePdfDocument(url)
  const [width, setWidth] = useState(600)
  const [target, setTarget] = useState<Target | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const debounce = { timer: undefined as number | undefined }
    const ro = new ResizeObserver(() => {
      window.clearTimeout(debounce.timer)
      debounce.timer = window.setTimeout(() => setWidth(Math.max(280, Math.floor(el.clientWidth - 32))), 150)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(debounce.timer)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    jumpTo(page, quote) {
      const root = scrollRef.current
      if (root) clearHighlights(root) // 前の根拠の強調は、どのページにあっても消す
      root?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      nonce.current += 1
      setTarget({ page, quote, nonce: nonce.current })
    },
  }))

  if (error) return <div className="pdf-error">PDF を表示できませんでした: {error}</div>
  return (
    <div className="pdf-scroll" ref={scrollRef}>
      {!doc && <div className="muted pad">PDF を読み込み中…</div>}
      {doc && Array.from({ length: doc.numPages }, (_, i) => <PageView key={i + 1} doc={doc} num={i + 1} width={width} target={target} />)}
    </div>
  )
})
