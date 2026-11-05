import { useEffect, useRef, useState } from 'react'
import { api, type Health, type Level, type PaperSummary } from '../api'

const STATUS_LABEL: Record<string, string> = {
  queued: '待機中',
  processing_step1: '解析中 (1/3)',
  processing_step2: '解析中 (2/3)',
  processing_step3: '解析中 (3/3)',
  done: '完了',
  failed: '失敗',
}

const LEVEL_LABEL: Record<Level, string> = { undergrad: '学部生向け', grad: '大学院生向け' }

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
    if (file.type && file.type !== 'application/pdf') return setError('PDF ファイルを選んでください')
    if (health && file.size > health.max_upload_mb * 1024 * 1024) return setError(`ファイルサイズの上限は ${health.max_upload_mb}MB です`)
    busyRef.current = true
    setBusy(true)
    try {
      const res = await api.upload(file, level)
      onOpen(res.id)
    } catch (e) {
      setError((e as Error).message)
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
      <div className="hero">
        <h1>英語論文を、3つのステップで自分のものに。</h1>
        <p className="muted">
          前提知識マップで<strong>知る</strong> → 図表と連動したウォークスルーで<strong>追う</strong> → 批判的思考チェックで
          <strong>疑う</strong>。
          <br />
          すべての解説に根拠ページが付き、クリックで原文に戻れます。
        </p>
      </div>

      {health?.demo_mode && (
        <p className="demo-note" role="note">
          デモモードのため、表示される解説はサンプルです。
        </p>
      )}

      <div className="level" role="radiogroup" aria-label="説明のレベル">
        <span className="muted small">説明のレベル</span>
        <label>
          <input type="radio" name="level" checked={level === 'undergrad'} onChange={() => setLevel('undergrad')} disabled={busy} />{' '}
          学部生向け
        </label>
        <label>
          <input type="radio" name="level" checked={level === 'grad'} onChange={() => setLevel('grad')} disabled={busy} /> 大学院生向け
        </label>
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
        <div className="drop-icon">📄</div>
        <strong>{busy ? 'アップロード中…' : '論文の PDF をドロップ、またはクリックして選択'}</strong>
        <span className="muted small">テキストを含む PDF（arXiv など）・{health?.max_upload_mb ?? 20}MB まで</span>
      </div>

      {error && <div className="error">{error}</div>}

      {papers.length > 0 && (
        <section className="history">
          <h3>これまでの論文</h3>
          <ul>
            {papers.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p.id)}>
                  <span className="history-title">{p.title || p.filename}</span>
                  <span className="history-meta">
                    {p.level && <span className="badge">{LEVEL_LABEL[p.level]}</span>}
                    {formatDate(p.created_at) && <span className="muted small">{formatDate(p.created_at)}</span>}
                    <span className={`status ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
