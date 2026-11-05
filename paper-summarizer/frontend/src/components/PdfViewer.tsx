import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export type PdfViewerHandle = { jumpTo: (page: number, quote?: string) => void }
type Target = { page: number; quote?: string; nonce: number }

/** 空白・記号を除いて比較する（改行やハイフネーションで分割された引用でも一致させるため） */
const squash = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/­/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

function highlightQuote(layer: HTMLElement, quote: string): HTMLElement | null {
  layer.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'))
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
    hit.forEach((r) => r.el.classList.add('hl'))
    return hit[0]?.el ?? null
  }
  return null
}

function PageView({ doc, num, width, target }: { doc: PDFDocumentProxy; num: number; width: number; target: Target | null }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number; scale: number } | null>(null)
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState(0)

  useEffect(() => {
    let alive = true
    doc.getPage(num).then((page) => {
      if (!alive) return
      const vp = page.getViewport({ scale: 1 })
      const scale = width / vp.width
      setSize({ w: vp.width * scale, h: vp.height * scale, scale })
    })
    return () => {
      alive = false
    }
  }, [doc, num, width])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // ジャンプ先のページは画面外でもすぐ描画する
  useEffect(() => {
    if (target?.page === num) setVisible(true)
  }, [target, num])

  useEffect(() => {
    if (!visible || !size) return
    let cancelled = false
    let textLayer: TextLayer | null = null
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    ;(async () => {
      const page = await doc.getPage(num)
      if (cancelled) return
      const vp = page.getViewport({ scale: size.scale })
      const canvas = canvasRef.current!
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      task = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      try {
        await task.promise
      } catch {
        return // 再描画でキャンセルされた
      }
      if (cancelled) return
      const div = textRef.current!
      div.replaceChildren()
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport: vp })
      await textLayer.render()
      if (!cancelled) setRendered((n) => n + 1)
    })()
    return () => {
      cancelled = true
      task?.cancel()
      textLayer?.cancel()
    }
  }, [visible, size, doc, num])

  useEffect(() => {
    if (!target || target.page !== num || !rendered || !textRef.current) return
    textRef.current.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'))
    if (!target.quote) return
    const first = highlightQuote(textRef.current, target.quote)
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [target, num, rendered])

  const style = size
    ? ({ width: size.w, height: size.h, '--scale-factor': size.scale, '--total-scale-factor': size.scale } as CSSProperties)
    : { width, height: width * 1.3 }
  return (
    <div className="pdf-page" data-page={num} ref={wrapRef} style={style}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <div className="textLayer" ref={textRef} />
      <span className="pdf-page-num">{num}</span>
    </div>
  )
}

export const PdfViewer = forwardRef<PdfViewerHandle, { url: string }>(function PdfViewer({ url }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(600)
  const [target, setTarget] = useState<Target | null>(null)

  useEffect(() => {
    let alive = true
    const task = getDocument({ url })
    task.promise.then(
      (d) => alive && setDoc(d),
      (e: Error) => alive && setError(e.message), // 中断（アンマウント）時のエラーは無視する
    )
    return () => {
      alive = false
      task.destroy()
    }
  }, [url])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let t: number | undefined
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t)
      t = window.setTimeout(() => setWidth(Math.max(280, Math.floor(el.clientWidth - 32))), 150)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    jumpTo(page, quote) {
      const el = scrollRef.current?.querySelector(`[data-page="${page}"]`)
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setTarget({ page, quote, nonce: Date.now() })
    },
  }))

  if (error) return <div className="pdf-error">PDF を表示できませんでした: {error}</div>
  return (
    <div className="pdf-scroll" ref={scrollRef}>
      {!doc && <div className="muted pad">PDF を読み込み中…</div>}
      {doc &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PageView key={i + 1} doc={doc} num={i + 1} width={width} target={target} />
        ))}
    </div>
  )
})
