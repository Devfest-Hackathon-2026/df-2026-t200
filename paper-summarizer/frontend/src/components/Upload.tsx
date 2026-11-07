import { useEffect, useRef, useState } from 'react'
import { api, type Health, type Lang, type PaperSummary } from '../api'

const STATUS_LABEL: Record<string, string> = {
  queued: '解析待ち',
  processing_step1: '解析中（1/3）',
  processing_step2: '解析中（2/3）',
  processing_step3: '解析中（3/3）',
  done: '完了',
  failed: '解析に失敗',
}

/** 一覧に出す日付と時刻（ブラウザの時刻で「11月5日 18:30」、今年でなければ年も付ける）。同じ日に何度も開いても見分けられるよう時刻も出す。読めない値は出さない */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}年`
  return `${year}${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 解析中の Step（1〜3）。解析中でなければ null */
const processingStep = (status: string) => {
  const m = status.match(/^processing_step([1-3])$/)
  return m ? Number(m[1]) : status === 'queued' ? 0 : null
}

/** 状態を示すマグネットの色。完了は青、解析中は黄、失敗は黒（赤と緑は解説の中の意味に取っておく） */
const magnetColor = (status: string) => (status === 'done' ? 'blue' : status === 'failed' ? 'black' : 'yellow')

function PaperCard({ paper, onOpen }: { paper: PaperSummary; onOpen: (id: string) => void }) {
  const step = processingStep(paper.status)
  const date = formatDate(paper.created_at)
  return (
    <button type="button" className="paper-card sheet" onClick={() => onOpen(paper.id)}>
      <span className={`magnet ${magnetColor(paper.status)}`} aria-hidden="true" />
      <span className="paper-card-title">{paper.title || paper.filename}</span>
      <span className="paper-card-meta">{date && <span>{date}</span>}</span>
      <span className="paper-card-foot">
        <span className={`status ${paper.status}`}>{STATUS_LABEL[paper.status] ?? paper.status}</span>
        {step != null && (
          <span className="progress" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= step ? 'filled' : ''} />
            ))}
          </span>
        )}
        {paper.status === 'done' && <span className="paper-card-open">続きから読む</span>}
      </span>
    </button>
  )
}

export function Upload({ health, onOpen }: { health: Health | null; onOpen: (id: string) => void }) {
  const [lang, setLang] = useState<Lang>('ja')
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
      const res = await api.upload(file, lang)
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
        <div className="hero">
          {/* 折り返すときは「、」の後で改行する */}
          <h1>
            <span>英語の論文を1本、</span>
            <span>PDFで読み込んでください</span>
          </h1>
          <p>
            前提知識の整理、手法の流れ、批判的に読むための問いを、論文のページを添えて作ります。AIの解説は間違えることがあるので、ページを開いて原文で確かめながら読んでください。
          </p>
        </div>

        <div className="level" role="radiogroup" aria-labelledby="lang-label">
          <span className="level-label" id="lang-label">
            解説の言語
          </span>
          <div className="level-options">
            <label className={lang === 'ja' ? 'checked' : ''}>
              <input type="radio" name="lang" checked={lang === 'ja'} onChange={() => setLang('ja')} disabled={busy} />
              日本語
            </label>
            <label className={lang === 'en' ? 'checked' : ''}>
              <input type="radio" name="lang" checked={lang === 'en'} onChange={() => setLang('en')} disabled={busy} />
              English
            </label>
          </div>
        </div>

        {/* 受け口の外に置く（input.click() のクリックが受け口に伝わって二重に開かないように） */}
        <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(e) => handle(e.target.files?.[0])} />
        {/* 受け口のどこを押してもファイルを選べる。キーボードでは中の「PDFを選択」ボタンを使う */}
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
        >
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
          <strong className="drop-title">
            {busy ? (
              'アップロードしています…'
            ) : (
              // 狭い画面でも語の途中で折り返さず、「、」の後で改行する
              <>
                <span>論文のPDFをドロップ、</span>
                <span>またはクリックして選択</span>
              </>
            )}
          </strong>
          <span className="muted small">テキストを含むPDF・{health?.max_upload_mb ?? 20}MBまで</span>
          {/* クリックは受け口の onClick に伝わってファイル選択を開く */}
          {/* 処理中も disabled にはしない（無効なボタンはドロップを受けず、PDF がタブで開いてしまうため）。二重の選択は openPicker が防ぐ */}
          <button type="button" className="drop-cta" aria-disabled={busy}>
            PDFを選択
          </button>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>

      {papers.length > 0 && (
        <section className="history" aria-labelledby="history-title">
          <h2 id="history-title">これまでの論文</h2>
          <ul>
            {papers.map((p) => (
              <li key={p.id}>
                <PaperCard paper={p} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
