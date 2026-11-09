import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type Health, type Lang, type PaperSummary } from '../api'
import { forgetPaperStorage } from '../paperStorage'

/**
 * 一覧に最初から出す件数。
 * PC 幅: 一覧の枠の高さと、いま出しているカードの高さ（いちばん高いもの）から、スクロールせずに収まる件数を測る
 * （最低 MIN_VISIBLE 件。画面の大きさが変わったら測り直す）。測れない環境（レイアウトが無いテストなど）では VISIBLE_FALLBACK 件。
 * スマホ幅: 一覧は縦に積まれてページごとスクロールするので、測らず VISIBLE_NARROW 件の固定にした。
 * 超えた分は「すべて表示」で出す。
 */
const MIN_VISIBLE = 3
const VISIBLE_FALLBACK = 6
const VISIBLE_NARROW = 4
const NARROW_QUERY = '(max-width: 900px)'
/** 「すべて表示」ボタンと余白が使う高さ（px） */
const MORE_BUTTON_SPACE = 56

/** 画面の幅が狭いか。画面の大きさが変わったら更新する */
function useNarrow(): boolean {
  // matchMedia が無い環境でも落とさない（広い画面として扱う）
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY)?.matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY)
    if (!mq) return
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return narrow
}

/** 一覧の枠にスクロールなしで収まるカードの件数。測れなければ null */
function measureFit(section: HTMLElement): number | null {
  const ul = section.querySelector('ul')
  const heading = section.querySelector('h2')
  const heights = Array.from(ul?.querySelectorAll('li') ?? [], (li) => li.offsetHeight)
  if (!ul || !heading || section.clientHeight === 0 || heights.length === 0 || Math.max(...heights) === 0) return null
  const style = getComputedStyle(ul)
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  const gap = parseFloat(style.rowGap) || 0
  const room = section.clientHeight - heading.offsetHeight - 6 - padding - MORE_BUTTON_SPACE
  return Math.max(MIN_VISIBLE, Math.floor((room + gap) / (Math.max(...heights) + gap)))
}

const STATUS_LABEL: Record<string, string> = {
  queued: '解析待ち',
  processing_step1: '解析中（1/3）',
  processing_step2: '解析中（2/3）',
  processing_step3: '解析中（3/3）',
  done: '完了',
  failed: '解析に失敗',
  cancelled: '解析を中止',
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
  const [showAll, setShowAll] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // 削除の読み上げと、削除のあとにフォーカスを移す先（論文 id。null は見出し／一覧が空なら PDF を選ぶボタン）
  const [notice, setNotice] = useState('')
  const focusAfter = useRef<{ id: string | null } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrow()
  const [fit, setFit] = useState<number | null>(null)
  const historyRef = useRef<HTMLElement>(null)
  const limit = narrow ? VISIBLE_NARROW : (fit ?? VISIBLE_FALLBACK)

  // PC 幅では、一覧が空いている高さに収まる件数を測る。枠の大きさが変わったら測り直す
  useLayoutEffect(() => {
    const section = historyRef.current
    if (narrow || showAll || !section) return
    const update = () => setFit(measureFit(section))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(section)
    return () => observer.disconnect()
  }, [narrow, showAll, papers.length])
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

  // 削除で押したボタンが消えるので、フォーカスが body に落ちないよう次の操作先へ移す
  useEffect(() => {
    const request = focusAfter.current
    if (!request) return
    focusAfter.current = null
    const next = request.id
      ? Array.from(pageRef.current?.querySelectorAll<HTMLElement>('.paper-item') ?? []).find((li) => li.dataset.paperId === request.id)
      : null
    const target =
      next?.querySelector<HTMLElement>('.paper-delete') ?? headingRef.current ?? pageRef.current?.querySelector<HTMLElement>('.drop-cta')
    target?.focus()
  }, [papers])

  async function remove(paper: PaperSummary) {
    const name = paper.title || paper.filename
    if (deleting || !window.confirm(`「${name}」を削除しますか。解析結果と質問の記録も消え、元に戻せません`)) return
    setListError(null)
    setDeleting(paper.id)
    try {
      await api.delete(paper.id)
      forgetPaperStorage(paper.id)
      const shown = showAll ? papers : papers.slice(0, limit)
      const next = shown[shown.findIndex((p) => p.id === paper.id) + 1]
      focusAfter.current = { id: next?.id ?? null }
      setPapers((prev) => prev.filter((p) => p.id !== paper.id))
      setNotice(`「${name}」を削除しました`)
    } catch (e) {
      setListError(`削除できませんでした。${(e as Error).message}`)
    } finally {
      setDeleting(null)
    }
  }

  const openPicker = () => {
    if (!busyRef.current) inputRef.current?.click()
  }

  return (
    <div className="upload-page" ref={pageRef}>
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

      {/* 削除の結果を読み上げる（一覧が空になっても残るよう、一覧の外に置く） */}
      <div className="sr-only" role="status">
        {notice}
      </div>

      {papers.length > 0 && (
        <section className="history" ref={historyRef} aria-labelledby="history-title">
          <h2 id="history-title" ref={headingRef} tabIndex={-1}>
            これまでの論文
          </h2>
          <ul>
            {(showAll ? papers : papers.slice(0, limit)).map((p) => (
              <li key={p.id} className="paper-item" data-paper-id={p.id}>
                <PaperCard paper={p} onOpen={onOpen} />
                <button
                  type="button"
                  className="paper-delete"
                  aria-label={`${p.title || p.filename}を削除`}
                  disabled={deleting === p.id}
                  onClick={() => remove(p)}
                >
                  {deleting === p.id ? '削除中…' : '削除'}
                </button>
              </li>
            ))}
          </ul>
          {papers.length > limit && (
            <button type="button" className="btn history-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '閉じる' : `すべて表示（${papers.length}件）`}
            </button>
          )}
          {listError && (
            <div className="error" role="alert">
              {listError}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
