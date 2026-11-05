import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Health, type Paper } from './api'
import { PdfViewer, type PdfViewerHandle } from './components/PdfViewer'
import { QaPanel } from './components/QaPanel'
import { Step1Map } from './components/Step1Map'
import { Step2Walkthrough } from './components/Step2Walkthrough'
import { Step3Critical } from './components/Step3Critical'
import { Upload } from './components/Upload'
import { JumpContext } from './jump'

const STEPS = [
  { n: 1, key: 'step1', title: '前提知識マップ', verb: '知る' },
  { n: 2, key: 'step2', title: 'コアロジック＆図表連動', verb: '追う' },
  { n: 3, key: 'step3', title: '批判的思考チェック', verb: '疑う' },
] as const

const paperIdFromHash = () => window.location.hash.match(/^#\/paper\/([0-9a-f]{16})$/)?.[1] ?? null

function PaperView({ id, health }: { id: string; health: Health | null }) {
  const [paper, setPaper] = useState<Paper | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const viewer = useRef<PdfViewerHandle>(null)
  const jump = useCallback((page: number, quote?: string) => viewer.current?.jumpTo(page, quote), [])

  // ローカルではポーリング（本番は Firestore のリアルタイムリスナーで置き換える）
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const tick = async () => {
      try {
        const p = await api.get(id)
        if (!alive) return
        setPaper(p)
        setError(null)
        if (p.status !== 'done' && p.status !== 'failed') timer = window.setTimeout(tick, 1500)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [id])

  if (error) return <div className="center error">{error}</div>
  if (!paper) return <div className="center muted">読み込み中…</div>

  const r = paper.results
  const ready = { 1: !!r.step1, 2: !!r.step2, 3: !!r.step3 } as Record<number, boolean>
  const working = paper.status !== 'done' && paper.status !== 'failed'

  return (
    <JumpContext.Provider value={jump}>
      <div className="workspace">
        <div className="pane-left">
          <PdfViewer ref={viewer} url={api.pdfUrl(id)} />
        </div>
        <div className="pane-right">
          <div className="paper-title">
            <strong>{r.step1?.title ?? paper.filename}</strong>
            <span className="muted small">
              {paper.page_count}ページ・{paper.level === 'grad' ? '大学院生向け' : '学部生向け'}
            </span>
          </div>
          <nav className="tabs" role="tablist">
            {STEPS.map((s) => (
              <button
                key={s.n}
                type="button"
                role="tab"
                aria-selected={step === s.n}
                className={`tab ${step === s.n ? 'active' : ''}`}
                onClick={() => setStep(s.n)}
              >
                <span className="tab-step">
                  Step {s.n}・{s.verb}
                  {!ready[s.n] && working && <span className="spinner" aria-label="生成中" />}
                </span>
                <span className="tab-title">{s.title}</span>
              </button>
            ))}
          </nav>
          {paper.status === 'failed' && (
            <div className="error banner">
              {paper.error}
              <button type="button" className="btn" onClick={() => api.retry(id).then(() => window.location.reload())}>
                再実行
              </button>
            </div>
          )}
          <div className="step-scroll">
            {step === 1 && (r.step1 ? <Step1Map data={r.step1} paperId={id} /> : <Pending working={working} label="前提知識マップ" />)}
            {step === 2 && (r.step2 ? <Step2Walkthrough data={r.step2} /> : <Pending working={working} label="ウォークスルー" />)}
            {step === 3 &&
              (r.step3 ? <Step3Critical data={r.step3} paperId={id} /> : <Pending working={working} label="批判的思考チェック" />)}
          </div>
          {health && <QaPanel paperId={id} initial={paper.messages} currentStep={step} />}
        </div>
      </div>
    </JumpContext.Provider>
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
          PaperSummarizer <span className="muted">for Students</span>
        </a>
        {health?.demo_mode && (
          <span className="badge demo" title="Gemini の認証情報が未設定のため、サンプルの解析結果を表示しています">
            デモモード（サンプルデータ）
          </span>
        )}
        {health && !health.demo_mode && <span className="muted small">Gemini: {health.analysis_model}</span>}
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
      {id ? (
        <PaperView key={id} id={id} health={health ?? null} />
      ) : (
        <Upload health={health ?? null} onOpen={(pid) => (window.location.hash = `#/paper/${pid}`)} />
      )}
    </div>
  )
}
