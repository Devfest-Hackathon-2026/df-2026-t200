import { useEffect, useId, useRef, useState } from 'react'
import { api, type Message } from '../api'
import { EvidenceList } from '../jump'
import { scrollWithin } from '../motion'

const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  paper: { text: '論文に記載', cls: 'paper' },
  general_knowledge: { text: '論文外の一般知識', cls: 'general' },
  not_in_paper: { text: '論文に記載なし', cls: 'none' },
}
const SUGGESTIONS = ['この手法の弱点は？', '先行研究との一番の違いは？', 'この実験設定で主張は十分に支えられている？']

export function QaPanel({ paperId, initial, currentStep }: { paperId: string; initial: Message[]; currentStep: number }) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 最初は閉じて1行の入力欄だけを出し、Step の解説に高さを譲る。質問したら開く
  const [open, setOpen] = useState(false)
  // 読み上げ用の状態（パネルを閉じていても伝わるよう、常に置いておく）
  const [status, setStatus] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const bodyId = `${uid}-body`
  const inputId = `${uid}-input`

  useEffect(() => {
    if (endRef.current) scrollWithin(endRef.current, 'end')
  }, [messages, busy, open])

  async function send(q: string) {
    const question = q.trim()
    if (!question || busy) return
    setOpen(true)
    setBusy(true)
    setError(null)
    setStatus('論文を確認しています…')
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: question, created_at: new Date().toISOString() }])
    try {
      const res = await api.ask(paperId, question, currentStep)
      setMessages(res.messages)
      setStatus('回答が届きました')
    } catch (e) {
      setError(`質問を送れませんでした（${(e as Error).message}）。もう一度「送信」を押してください。`)
      setStatus('')
      setMessages((m) => m.slice(0, -1))
      setInput(question)
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form
      className="qa-input"
      onSubmit={(e) => {
        e.preventDefault()
        send(input)
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        論文への質問
      </label>
      <input id={inputId} value={input} onChange={(e) => setInput(e.target.value)} placeholder="質問を入力" disabled={busy} />
      <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
        送信
      </button>
    </form>
  )

  return (
    <div className={`qa ${open ? 'open' : ''}`}>
      <div className="sr-only" role="status">
        {status}
      </div>
      <div className="qa-bar">
        <button type="button" className="qa-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <strong className="qa-title">質問と回答</strong>
          {messages.length > 0 && <span className="muted small">（{messages.length}件）</span>}
          <span className="qa-toggle" aria-hidden="true">
            {open ? '閉じる' : '開く'}
          </span>
        </button>
        {!open && form}
      </div>
      {open && (
        <>
          <div className="qa-body" id={bodyId} role="log" aria-label="Q&Aの履歴">
            {messages.length === 0 && (
              <div className="suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === 'user' && <span className="msg-who">あなた</span>}
                {m.role === 'assistant' && m.source && (
                  <div className="row gap small">
                    <span className={`badge ${SOURCE_LABEL[m.source].cls}`}>{SOURCE_LABEL[m.source].text}</span>
                    {m.confidence && <span className="tag">確信度 {{ high: '高', medium: '中', low: '低' }[m.confidence]}</span>}
                  </div>
                )}
                <div className="msg-text">{m.text}</div>
                {m.evidence && <EvidenceList items={m.evidence} />}
              </div>
            ))}
            {busy && <div className="msg assistant muted">論文を確認しています…</div>}
            {error && (
              <div className="error small" role="alert">
                {error}
              </div>
            )}
            <div ref={endRef} />
          </div>
          {form}
        </>
      )}
    </div>
  )
}
