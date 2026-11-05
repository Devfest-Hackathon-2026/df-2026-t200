import { TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { highlightQuote, isCancellation } from '../pdf/pdfText'
import { scrollBehavior } from '../motion'

/** ジャンプ先。nonce は根拠チップが押されるたびに変わり、スクロールはこの値が変わったときだけ行う。 */
export type Target = { page: number; quote?: string; nonce: number }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** PDF の1ページ。画面の近くにある間だけ描画し、離れたら canvas とページの資源を解放する。 */
export function PageView({
  doc,
  num,
  width,
  target,
  settled,
  onSized,
  onQuoteScrolled,
}: {
  doc: PDFDocumentProxy
  num: number
  width: number
  target: Target | null
  /** 表示幅が決まり、全ページの大きさがその幅でそろったか（そろう前にスクロールすると位置がずれる） */
  settled: boolean
  onSized: (num: number, width: number) => void
  onQuoteScrolled: (nonce: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<{ page: PDFPageProxy; run: { done: Promise<void> } } | null>(null)
  const scrolledNonce = useRef<number | null>(null)
  const [size, setSize] = useState<{ w: number; h: number; scale: number } | null>(null)
  const [onScreen, setOnScreen] = useState(false)
  const [rendered, setRendered] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // ジャンプ先のページは画面外でもすぐ描画する
  const shouldRender = onScreen || target?.page === num

  useEffect(() => {
    let alive = true
    doc.getPage(num).then(
      (page) => {
        if (!alive) return
        const vp = page.getViewport({ scale: 1 })
        const scale = width / vp.width
        setSize({ w: vp.width * scale, h: vp.height * scale, scale })
        onSized(num, width)
      },
      (e) => alive && setError(`このページを読み込めませんでした（${message(e)}）。ページを再読み込みしてください。`),
    )
    return () => {
      alive = false
    }
  }, [doc, num, width, onSized])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldRender || !size) return
    const run = {
      cancelled: false,
      task: null as { cancel: () => void; promise: Promise<void> } | null,
      textLayer: null as TextLayer | null,
      done: Promise.resolve(),
    }
    run.done = (async () => {
      try {
        const page = await doc.getPage(num)
        if (run.cancelled) return
        pageRef.current = { page, run }
        const vp = page.getViewport({ scale: size.scale })
        const canvas = canvasRef.current!
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(vp.width * dpr)
        canvas.height = Math.floor(vp.height * dpr)
        run.task = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
        await run.task.promise
        if (run.cancelled) return
        const div = textRef.current!
        div.replaceChildren()
        run.textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport: vp })
        await run.textLayer.render()
        if (run.cancelled) return
        setError(null)
        setRendered((n) => n + 1)
      } catch (e) {
        if (!run.cancelled && !isCancellation(e))
          setError(`このページを表示できませんでした（${message(e)}）。ページを再読み込みしてください。`)
      }
    })()
    return () => {
      run.cancelled = true
      run.task?.cancel()
      run.textLayer?.cancel()
    }
  }, [shouldRender, size, doc, num])

  // 画面から離れたページは canvas を空にし、pdf.js のページ資源（画像・フォントなど）を解放する
  useEffect(() => {
    if (shouldRender) return
    const held = pageRef.current
    if (!held) return
    pageRef.current = null
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    textRef.current?.replaceChildren()
    // 描画の中断が終わってから解放する（描画中は cleanup が何もしないため）。その間に描画し直していたら解放しない
    held.run.done.finally(() => {
      if (!pageRef.current) held.page.cleanup()
    })
  }, [shouldRender])

  // 強調は描き直すたびに付け直す。スクロールは新しいジャンプ（nonce）のときだけ、配置がそろってから行う
  useEffect(() => {
    if (!target || target.page !== num || !target.quote || !rendered || !textRef.current) return
    const first = highlightQuote(textRef.current, target.quote)
    if (first && settled && scrolledNonce.current !== target.nonce) {
      scrolledNonce.current = target.nonce
      first.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
      onQuoteScrolled(target.nonce)
    }
  }, [target, num, rendered, settled, onQuoteScrolled])

  const style = size
    ? ({ width: size.w, height: size.h, '--scale-factor': size.scale, '--total-scale-factor': size.scale } as CSSProperties)
    : { width, height: width * 1.3 }
  return (
    <div className="pdf-page" data-page={num} ref={wrapRef} style={style}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <div className="textLayer" ref={textRef} />
      <span className="pdf-page-num">{num}</span>
      {error && (
        <div className="pdf-page-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
