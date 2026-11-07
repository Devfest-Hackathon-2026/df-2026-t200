import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, type Health } from './api'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PaneDivider } from './components/PaneDivider'
import { clampSplit, isSplit, SPLIT_DEFAULT, splitBounds } from './components/paneSplit'
import type { PdfViewerHandle } from './components/PdfViewer'
import { QaPanel } from './components/QaPanel'
import { QuizPanel } from './components/QuizPanel'
import { Step1Map } from './components/Step1Map'
import { Step2Walkthrough } from './components/Step2Walkthrough'
import { Step3Critical } from './components/Step3Critical'
import { TabList } from './components/TabList'
import { Upload } from './components/Upload'
import { useElementWidth } from './hooks/useElementWidth'
import { useLocalStorageState } from './hooks/useLocalStorageState'
import { usePaper } from './hooks/usePaper'
import { JumpContext, type JumpFn } from './jumpContext'

// pdf.js は大きいので、論文を開くまで読み込まない（アップロード画面を軽くする）
const PdfViewer = lazy(() => loadPdfViewer().then((m) => ({ default: m.PdfViewer })))

const loadPdfViewer = () => import('./components/PdfViewer')

const VIEWS = [
  { value: 'explain', label: '解説' },
  { value: 'pdf', label: 'PDF' },
] as const

const STEPS = [
  { n: 1, key: 'step1', title: '前提知識マップ', verb: '知る' },
  { n: 2, key: 'step2', title: '手法の流れと図表', verb: '追う' },
  { n: 3, key: 'step3', title: '批判的思考チェック', verb: '疑う' },
  // Step 1〜3 とは別のモード。わざと誤りを混ぜた文が出るので、解説とは別のタブに分ける
  { n: 4, key: 'quiz', title: '誤り探しモード', verb: '試す' },
] as const

/** これ以下の幅では PDF と解説を並べず、タブで切り替える（index.css の @media と同じ値） */
const NARROW_QUERY = '(max-width: 900px)'
const isNarrow = () => window.matchMedia?.(NARROW_QUERY).matches ?? false

const paperIdFromHash = () => window.location.hash.match(/^#\/paper\/([0-9a-f]{16})$/)?.[1] ?? null

function PaperView({ id, health }: { id: string; health: Health | null }) {
  const { paper, error, notFound, refresh } = usePaper(id)
  // 論文のデータを待っている間に PDF の部品も読み込み始める
  useEffect(() => {
    void loadPdfViewer()
  }, [])
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [step, setStep] = useState(1)
  const [view, setView] = useState<'pdf' | 'explain'>('explain')
  const viewer = useRef<PdfViewerHandle | null>(null)
  // PdfViewer は遅延読み込みなので、マウント前に頼まれた移動は最新の 1 件だけ覚え、マウント時に渡す
  const pendingJump = useRef<[number, string | undefined] | null>(null)
  const attachViewer = useCallback((handle: PdfViewerHandle | null) => {
    viewer.current = handle
    if (handle && pendingJump.current) {
      const [page, quote] = pendingJump.current
      pendingJump.current = null
      handle.jumpTo(page, quote)
    }
  }, [])
  const requestJump = useCallback((page: number, quote?: string) => {
    if (viewer.current) viewer.current.jumpTo(page, quote)
    else pendingJump.current = [page, quote]
  }, [])
  const { ref: setWorkspace, element: workspaceBox, width: workspaceWidth } = useElementWidth<HTMLDivElement>()
  // 広い画面で PDF が占める幅（%）。どの論文でも同じ幅で開けるよう、論文ごとではなく 1 つだけ覚える
  const [split, setSplit] = useLocalStorageState('pane-split', SPLIT_DEFAULT, isSplit)
  // 画面の幅によっては PDF や解説の最小幅を守るために動かせる範囲が狭まる。保存した値はそのままにし、表示だけ範囲に収める
  const bounds = splitBounds(workspaceWidth ?? 0)
  const shownSplit = clampSplit(split, bounds)
  const jump = useCallback<JumpFn>(
    (page, quote, options) => {
      // 広い画面、または画面を切り替えたくない移動（Step 2 を開いたときの強調など）はそのまま頼む。
      // PDF が隠れている間の移動は PdfViewer が保留し、表示されたときに行う
      if (!isNarrow() || options?.switchView === false) return requestJump(page, quote)
      // 狭い画面では先に PDF を表示し、ページの大きさが決まってから移動する
      setView('pdf')
      requestAnimationFrame(() => requestJump(page, quote))
    },
    [requestJump],
  )
  // Step を切り替えたら、前の Step で付けた PDF の強調を消す
  const selectStep = (n: number) => {
    if (n !== step) viewer.current?.clearHighlight()
    setStep(n)
  }

  const retry = async () => {
    setRetrying(true)
    setRetryError(null)
    try {
      await api.retry(id)
      refresh()
    } catch (e) {
      setRetryError((e as Error).message)
    } finally {
      setRetrying(false)
    }
  }

  if (notFound) return <NotFound />
  if (!paper) {
    return error ? (
      <div className="center">
        <p className="error" role="alert">
          論文を読み込めませんでした（{error}）。少し待つと自動で読み込み直します。
        </p>
      </div>
    ) : (
      <div className="center muted">論文を読み込んでいます…</div>
    )
  }

  const r = paper.results
  const ready = { 1: !!r.step1, 2: !!r.step2, 3: !!r.step3, 4: true } as Record<number, boolean>
  const working = paper.status !== 'done' && paper.status !== 'failed'

  return (
    <JumpContext.Provider value={jump}>
      <TabList
        className="view-switch"
        label="表示の切り替え"
        idPrefix="view"
        panelId={(v) => `view-panel-${v}`}
        items={VIEWS}
        selected={view}
        onSelect={setView}
      />
      <div ref={setWorkspace} className={`workspace show-${view}`} style={{ '--split': `${shownSplit}%` } as CSSProperties}>
        <div className="pane-left" id="view-panel-pdf" role="tabpanel" aria-labelledby="view-tab-pdf">
          <Suspense fallback={<div className="center muted">PDFを読み込んでいます…</div>}>
            <PdfViewer ref={attachViewer} url={api.pdfUrl(id)} />
          </Suspense>
        </div>
        <PaneDivider value={shownSplit} bounds={bounds} onChange={setSplit} container={workspaceBox} />
        <div className="pane-right" id="view-panel-explain" role="tabpanel" aria-labelledby="view-tab-explain">
          <div className="paper-title">
            <h1>{r.step1?.title ?? paper.filename}</h1>
            <span className="paper-meta">
              <span className="muted small">全{paper.page_count}ページ</span>
            </span>
          </div>
          <TabList
            className="tabs"
            label="学習のステップ"
            idPrefix="step"
            panelId="step-panel"
            selected={step}
            onSelect={selectStep}
            items={STEPS.map((s) => ({
              value: s.n,
              className: s.n === 4 ? 'tab quiz-tab' : 'tab',
              label: (
                <>
                  <span className="tab-step">
                    <span className="tab-num">{s.n}</span>
                    <span className="tab-verb">{s.verb}</span>
                    {!ready[s.n] && working && <span className="spinner" role="img" aria-label="作成中" />}
                  </span>
                  <span className="tab-title">{s.title}</span>
                </>
              ),
            }))}
          />
          {error && (
            <div className="error banner" role="alert">
              サーバーとの通信に失敗しました（{error}）。少し待つと自動でつなぎ直します。
            </div>
          )}
          {paper.status === 'failed' && (
            <div className="error banner" role="alert">
              <span>
                解析に失敗しました（<span>{paper.error}</span>）。
                {retryError && <span className="small"> やり直しも失敗しました（{retryError}）。時間をおいてもう一度押してください。</span>}
              </span>
              <button type="button" className="btn" onClick={retry} disabled={retrying}>
                解析をやり直す
              </button>
            </div>
          )}
          <div className="step-scroll" id="step-panel" role="tabpanel" aria-labelledby={`step-tab-${step}`} tabIndex={0}>
            <ErrorBoundary key={step} title="このStepを表示できませんでした">
              {step === 1 && (r.step1 ? <Step1Map data={r.step1} paperId={id} /> : <Pending working={working} label="前提知識マップ" />)}
              {step === 2 &&
                (r.step2 ? <Step2Walkthrough data={r.step2} paperId={id} /> : <Pending working={working} label="手法の流れの解説" />)}
              {step === 3 &&
                (r.step3 ? <Step3Critical data={r.step3} paperId={id} /> : <Pending working={working} label="批判的思考チェック" />)}
              {step === 4 &&
                (paper.status === 'done' && r.step2 && r.step3 ? (
                  <QuizPanel paperId={id} pageCount={paper.page_count} />
                ) : (
                  <Pending working={working} label="誤り探しの元になる解説" />
                ))}
            </ErrorBoundary>
          </div>
          {health && <QaPanel paperId={id} initial={paper.messages} currentStep={step} />}
        </div>
      </div>
    </JumpContext.Provider>
  )
}

function NotFound() {
  return (
    <div className="center">
      <div className="not-found">
        <p>論文が見つかりません</p>
        <p className="muted small">URLを確かめるか、PDFをもう一度アップロードしてください。</p>
        <button type="button" className="btn primary" onClick={() => (window.location.hash = '#/')}>
          アップロード画面へ戻る
        </button>
      </div>
    </div>
  )
}

function Pending({ working, label }: { working: boolean; label: string }) {
  return (
    <div className="pending">
      {working ? (
        <>
          <span className="spinner big" />
          <p>{label}を作成しています…</p>
        </>
      ) : (
        <p className="muted">{label}を作成できませんでした。</p>
      )}
    </div>
  )
}

export default function App() {
  const [id, setId] = useState<string | null>(paperIdFromHash)
  const [health, setHealth] = useState<Health | null | undefined>(undefined) // undefined = 確認中

  useEffect(() => {
    const onHash = () => setId(paperIdFromHash())
    window.addEventListener('hashchange', onHash)
    api.health().then(setHealth, () => setHealth(null))
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="brand-name">PaperSummarizer</span> <span className="muted brand-sub">for Students</span>
        </a>
        {health?.demo_mode && (
          <span className="tag demo" title="Gemini の認証情報が設定されていないので、サンプルの解析結果を表示しています">
            <span className="wide-only">デモモード（サンプルデータ）</span>
            <span className="narrow-only">デモ</span>
          </span>
        )}
        {health && !health.demo_mode && <span className="muted small wide-only">Gemini: {health.analysis_model}</span>}
        <span className="spacer" />
        {id && (
          <a href="#/" className="btn">
            別の論文を開く
          </a>
        )}
      </header>
      {health === null && (
        <div className="error banner">
          バックエンド（http://localhost:8000）に接続できません。バックエンドを起動してから、このページを再読み込みしてください。
        </div>
      )}
      <ErrorBoundary key={id ?? 'upload'} title="画面を表示できませんでした">
        {id ? (
          <PaperView key={id} id={id} health={health ?? null} />
        ) : (
          <Upload health={health ?? null} onOpen={(pid) => (window.location.hash = `#/paper/${pid}`)} />
        )}
      </ErrorBoundary>
    </div>
  )
}
