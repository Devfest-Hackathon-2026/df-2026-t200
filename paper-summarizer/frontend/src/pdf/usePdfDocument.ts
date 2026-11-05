import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { useEffect, useState } from 'react'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

/** PDF を読み込む。url が変わるかアンマウントすると読み込みを破棄する。 */
export function usePdfDocument(url: string): { doc: PDFDocumentProxy | null; error: string | null } {
  const [state, setState] = useState<{ url: string; doc: PDFDocumentProxy | null; error: string | null }>({
    url,
    doc: null,
    error: null,
  })

  useEffect(() => {
    let alive = true
    const task = getDocument({ url })
    task.promise.then(
      (doc) => alive && setState({ url, doc, error: null }),
      (e: Error) => alive && setState({ url, doc: null, error: e.message }), // 中断（アンマウント）時のエラーは無視する
    )
    return () => {
      alive = false
      task.destroy()
    }
  }, [url])

  // url が変わった直後は前の文書を見せない
  return state.url === url ? { doc: state.doc, error: state.error } : { doc: null, error: null }
}
