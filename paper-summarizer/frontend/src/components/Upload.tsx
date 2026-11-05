import { useEffect, useRef, useState } from 'react'
import { api, type Health, type Level, type PaperSummary } from '../api'

const STATUS_LABEL: Record<string, string> = {
  queued: '解析待ち',
  processing_step1: '解析中（1/3）',
  processing_step2: '解析中（2/3）',
  processing_step3: '解析中（3/3）',
  done: '完了',
  failed: '解析に失敗',
}

const LEVEL_LABEL: Record<Level, string> = { undergrad: '学部生向け', grad: '大学院生向け' }

/** 履歴のマグネットの色分け（文字の状態表示と併せて使う） */
const magnetFor = (status: string) => (status === 'done' ? 'blue' : status === 'failed' ? 'black' : 'yellow')

/** 一覧に出す日時（ブラウザの時刻で YYYY/MM/DD HH:mm）。読めない値は出さない */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Upload({ health, onOpen }: { health: Health | null; onOpen: (id: string) => void }) {
  const [level, setLevel] = useState<'undergrad' | 'grad'>('undergrad')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  // state の更新を待たずに二重のアップロードを防ぐ
  const busyRef = useRef(false)

  useEffect(() => {
    api.list().then(setPapers, () => setPapers([]))
  }, [])

  async function handle(file: File | undefined) {
    // 同じファイルを選び直しても change が起きるよう、選択欄は毎回空に戻す
    if (inputRef.current) inputRef.current.value = ''
    if (!file || busyRef.current) return
    setError(null)
    if (file.type && file.type !== 'application/pdf') return setError('選んだファイルはPDFではありません。PDFファイルを選んでください。')
    if (health && file.size > health.max_upload_mb * 1024 * 1024)
      return setError(`ファイルが大きすぎます。${health.max_upload_mb}MB以下のPDFを選んでください。`)
    busyRef.current = true
    setBusy(true)
    try {
      const res = await api.upload(file, level)
      onOpen(res.id)
    } catch (e) {
      setError(`アップロードできませんでした。${(e as Error).message}`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const openPicker = () => {
    if (!busyRef.current) inputRef.current?.click()
  }

  return (
    <div className="upload-page">
      <div className="upload-main">
        <h1 className="sr-only">論文のアップロード</h1>

        <div className="level" role="radiogroup" aria-labelledby="level-label">
          <span className="level-label" id="level-label">
            説明のレベル
          </span>
          <div className="level-options">
            <label className={level === 'undergrad' ? 'checked' : ''}>
              <input type="radio" name="level" checked={level === 'undergrad'} onChange={() => setLevel('undergrad')} disabled={busy} />
              学部生向け
            </label>
            <label className={level === 'grad' ? 'checked' : ''}>
              <input type="radio" name="level" checked={level === 'grad'} onChange={() => setLevel('grad')} disabled={busy} />
              大学院生向け
            </label>
          </div>
        </div>

        <div
          className={`dropzone ${drag ? 'drag' : ''} ${busy ? 'busy' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            handle(e.dataTransfer.files?.[0])
          }}
          onClick={openPicker}
          role="button"
          tabIndex={0}
          aria-disabled={busy}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault() // Space でページがスクロールしないように
            openPicker()
          }}
        >
          <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(e) => handle(e.target.files?.[0])} />
          <svg className="drop-icon" aria-hidden="true" width="44" height="52" viewBox="0 0 52 60">
            <path
              d="M6,4 L34,3 L47,16 L46,56 L7,57 Z M34,3 L33,17 L47,16 M15,30 L38,30 M15,38 L38,38 M15,46 L30,46"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <strong>{busy ? 'アップロードしています…' : '論文のPDFを選ぶ'}</strong>
          <span className="muted small">ドロップでも選べます。テキストを含むPDFで、{health?.max_upload_mb ?? 20}MBまで</span>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>

      {papers.length > 0 && (
        <section className="history">
          <h2>これまでの論文</h2>
          <ul>
            {papers.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p.id)}>
                  <span className={`magnet ${magnetFor(p.status)}`} aria-hidden="true" />
                  <span className="history-title">{p.title || p.filename}</span>
                  <span className="history-meta">
                    {formatDate(p.created_at) && <span>{formatDate(p.created_at)}</span>}
                    {p.level && <span>{LEVEL_LABEL[p.level]}</span>}
                  </span>
                  <span className={`status ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
