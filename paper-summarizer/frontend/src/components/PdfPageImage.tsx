import { useEffect, useRef, useState } from 'react'
import { usePdfDocument } from '../pdf/usePdfDocument'

const WIDTH = 480

/** PDF の1ページ全体を小さめの画像として描く。数式を描画できなかったときの代わりに使う。 */
export default function PdfPageImage({ url, page, label }: { url: string; page: number; label: string }) {
  const { doc, error } = usePdfDocument(url)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!doc || !canvas) return
    const run = { alive: true }
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    doc.getPage(page).then(
      (p) => {
        if (!run.alive) return
        const base = p.getViewport({ scale: 1 })
        // 画面の解像度に合わせて細かく描き、表示の大きさは CSS の px で決める
        const dpr = window.devicePixelRatio || 1
        const vp = p.getViewport({ scale: (WIDTH / base.width) * dpr })
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        canvas.style.width = `${WIDTH}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return setFailed(true)
        task = p.render({ canvasContext: ctx, canvas, viewport: vp })
        task.promise.catch((e: Error) => run.alive && e.name !== 'RenderingCancelledException' && setFailed(true))
      },
      () => run.alive && setFailed(true),
    )
    return () => {
      run.alive = false
      task?.cancel()
    }
  }, [doc, page])

  if (error || failed) return <span className="muted small">ページの画像を表示できませんでした。</span>
  return <canvas ref={canvasRef} className="tex-page-image" role="img" aria-label={label} />
}
