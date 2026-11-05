import 'pdfjs-dist/web/pdf_viewer.css'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { clearHighlights } from '../pdf/pdfText'
import { usePdfDocument } from '../pdf/usePdfDocument'
import { scrollBehavior, scrollWithin } from '../motion'
import { PageView, type Target } from './PageView'

export type PdfViewerHandle = { jumpTo: (page: number, quote?: string) => void; clearHighlight: () => void }

/** ページの表示幅（.pdf-scroll の幅から左右の余白 8px ずつを引く。狭い画面の 6px より大きく取ってはみ出さないようにする） */
const pageWidth = (paneWidth: number) => Math.max(240, Math.floor(paneWidth - 16))

export const PdfViewer = forwardRef<PdfViewerHandle, { url: string }>(function PdfViewer({ url }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nonce = useRef(0)
  // 配置がそろう前に頼まれた移動（PDF の読み込み前・狭い画面で PDF が隠れている間・幅が変わった直後）
  const pending = useRef<{ page: number; nonce: number } | null>(null)
  const quoteScrolled = useRef<number | null>(null)
  const { doc, error } = usePdfDocument(url)
  const [paneWidth, setPaneWidth] = useState(0) // 0 = 非表示
  const [width, setWidth] = useState(600)
  const [sizedFor, setSizedFor] = useState<Record<number, number>>({})
  const [target, setTarget] = useState<Target | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const debounce = { timer: undefined as number | undefined }
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setPaneWidth(w)
      window.clearTimeout(debounce.timer)
      if (w === 0) return // 隠れている間（狭い画面の「解説」表示中）は幅を測らない
      debounce.timer = window.setTimeout(() => setWidth(pageWidth(w)), 150)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(debounce.timer)
    }
  }, [doc])

  const onSized = useCallback((num: number, w: number) => setSizedFor((m) => (m[num] === w ? m : { ...m, [num]: w })), [])
  const onQuoteScrolled = useCallback((n: number) => {
    quoteScrolled.current = n
  }, [])

  const settled =
    !!doc &&
    paneWidth > 0 &&
    width === pageWidth(paneWidth) &&
    Array.from({ length: doc.numPages }, (_, i) => sizedFor[i + 1]).every((w) => w === width)
  const settledRef = useRef(settled)
  settledRef.current = settled

  const scrollToPage = (page: number, behavior: ScrollBehavior) => {
    const el = scrollRef.current?.querySelector(`[data-page="${page}"]`)
    if (el) scrollWithin(el, 'start', behavior)
  }

  // 配置がそろったら、保留中の移動を行う（引用の位置へは PageView がスクロール済みならそれを優先する）
  useEffect(() => {
    const p = pending.current
    if (!settled || !p) return
    pending.current = null
    if (quoteScrolled.current !== p.nonce) scrollToPage(p.page, 'auto')
  }, [settled, sizedFor])

  useImperativeHandle(
    ref,
    () => ({
      jumpTo(page, quote) {
        const root = scrollRef.current
        if (root) clearHighlights(root) // 前の根拠の強調は、どのページにあっても消す
        nonce.current += 1
        if (settledRef.current) {
          pending.current = null
          scrollToPage(page, scrollBehavior())
        } else {
          pending.current = { page, nonce: nonce.current }
        }
        setTarget({ page, quote, nonce: nonce.current })
      },
      clearHighlight() {
        if (scrollRef.current) clearHighlights(scrollRef.current)
        pending.current = null
        setTarget(null)
      },
    }),
    [],
  )

  if (error)
    return (
      <div className="pdf-error" role="alert">
        PDFを表示できませんでした（{error}）。ページを再読み込みしてください。
      </div>
    )
  return (
    <div className="pdf-scroll" ref={scrollRef}>
      {!doc && <div className="muted pad">PDFを読み込んでいます…</div>}
      {doc &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PageView
            key={i + 1}
            doc={doc}
            num={i + 1}
            width={width}
            target={target}
            settled={settled}
            onSized={onSized}
            onQuoteScrolled={onQuoteScrolled}
          />
        ))}
    </div>
  )
})
