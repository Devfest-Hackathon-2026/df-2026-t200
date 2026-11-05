import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Health } from './api'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PdfViewer, type PdfViewerHandle } from './components/PdfViewer'
import { QaPanel } from './components/QaPanel'
import { Step1Map } from './components/Step1Map'
import { Step2Walkthrough } from './components/Step2Walkthrough'
import { Step3Critical } from './components/Step3Critical'
import { TabList } from './components/TabList'
import { Upload } from './components/Upload'
import { usePaper } from './hooks/usePaper'
import { JumpContext } from './jump'

const VIEWS = [
  { value: 'explain', label: '解説' },
  { value: 'pdf', label: 'PDF' },
] as const

const STEPS = [
  { n: 1, key: 'step1', title: '前提知識マップ', verb: '知る' },
  { n: 2, key: 'step2', title: 'コアロジック＆図表連動', verb: '追う' },
  { n: 3, key: 'step3', title: '批判的思考チェック', verb: '疑う' },
] as const

/** これ以下の幅では PDF と解説を並べず、タブで切り替える（index.css の @media と同じ値） */
const NARROW_QUERY = '(max-width: 900px)'
const isNarrow = () => window.matchMedia?.(NARROW_QUERY).matches ?? false

const paperIdFromHash = () => window.location.hash.match(/^#\/paper\/([0-9a-f]{16})$/)?.[1] ?? null

function PaperView({ id, health }: { id: string; health: Health | null }) {
  const { paper, error, notFound, refresh } = usePaper(id)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [step, setStep] = useState(1)
  const [view, setView] = useState<'pdf' | 'explain'>('explain')
  const viewer = useRef<PdfViewerHandle>(null)
  const jump = useCallback((page: number, quote?: string) => {
    if (!isNarrow()) return viewer.current?.jumpTo(page, quote)
    // 狭い画面では先に PDF を表示し、ページの大きさが決まってから移動する
    setView('pdf')
    requestAnimationFrame(() => viewer.current?.jumpTo(page, quote))
  }, [])
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
          論文を読み込めませんでした（{error}）。自動で再試行しています…
        </p>
      </div>
    ) : (
      <div className="center muted">読み込み中…</div>
    )
  }

  const r = paper.results
  const ready = { 1: !!r.step1, 2: !!r.step2, 3: !!r.step3 } as Record<number, boolean>
  const working = paper.status !== 'done' && paper.status !== 'failed'

  return (
    <JumpContext.Provider value={jump}>
      <TabList
        className="view-switch"
        label="表示の切り替え"
        idPrefix="view"
        panelId={`view-panel-${view}`}
        items={VIEWS}
        selected={view}
        onSelect={setView}
      />
      <div className={`workspace show-${view}`}>
        <div className="pane-left" id="view-panel-pdf" role="region" aria-label="論文のPDF">
          <PdfViewer ref={viewer} url={api.pdfUrl(id)} />
        </div>
        <div className="pane-right" id="view-panel-explain" role="region" aria-label="解説">
          <div className="paper-title">
            <h1>{r.step1?.title ?? paper.filename}</h1>
            <span className="muted small">
              {paper.page_count}ページ・{paper.level === 'grad' ? '大学院生向け' : '学部生向け'}
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
              className: 'tab',
              label: (
                <>
                  <span className="tab-step">
                    Step {s.n}・{s.verb}
                    {!ready[s.n] && working && <span className="spinner" role="img" aria-label="生成中" />}
                  </span>
                  <span className="tab-title">{s.title}</span>
                </>
              ),
            }))}
          />
          {error && (
            <div className="error banner" role="alert">
              通信に失敗しました（{error}）。自動で再試行しています…
            </div>
          )}
          {paper.status === 'failed' && (
            <div className="error banner" role="alert">
              <span>
                {paper.error}
                {retryError && <span className="small"> / 再実行に失敗しました: {retryError}</span>}
              </span>
              <button type="button" className="btn" onClick={retry} disabled={retrying}>
                再実行
              </button>
            </div>
          )}
          <div className="step-scroll" id="step-panel" role="tabpanel" aria-labelledby={`step-tab-${step}`} tabIndex={0}>
            <ErrorBoundary key={step} title="このStepを表示できませんでした">
              {step === 1 && (r.step1 ? <Step1Map data={r.step1} paperId={id} /> : <Pending working={working} label="前提知識マップ" />)}
              {step === 2 && (r.step2 ? <Step2Walkthrough data={r.step2} /> : <Pending working={working} label="ウォークスルー" />)}
              {step === 3 &&
                (r.step3 ? <Step3Critical data={r.step3} paperId={id} /> : <Pending working={working} label="批判的思考チェック" />)}
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
        <p className="muted small">URLが間違っているか、データが削除された可能性があります。</p>
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
          <p>Gemini が論文全体（図表・数式を含む）を読んで{label}を作成しています…</p>
          <p className="muted small">先にできたStepから表示されます。</p>
        </>
      ) : (
        <p className="muted">{label}は生成されていません。</p>
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
          PaperSummarizer <span className="muted brand-sub">for Students</span>
        </a>
        {health?.demo_mode && (
          <span className="badge demo" title="Gemini の認証情報が未設定のため、サンプルの解析結果を表示しています">
            <span className="wide-only">デモモード（サンプルデータ）</span>
            <span className="narrow-only">デモ</span>
          </span>
        )}
        {health && !health.demo_mode && <span className="muted small wide-only">Gemini: {health.analysis_model}</span>}
        <span className="spacer" />
        {id && (
          <a href="#/" className="btn">
            新しい論文
          </a>
        )}
      </header>
      {health === null && (
        <div className="error banner">バックエンド（http://localhost:8000）に接続できません。起動しているか確認してください。</div>
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
