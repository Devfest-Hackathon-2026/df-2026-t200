import { useEffect, useRef, useState } from 'react'
import { api, type Message } from '../api'
import { EvidenceList } from '../jump'

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
  const [open, setOpen] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy, open])

  async function send(q: string) {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setError(null)
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: question, created_at: new Date().toISOString() }])
    try {
      const res = await api.ask(paperId, question, currentStep)
      setMessages(res.messages)
    } catch (e) {
      setError((e as Error).message)
      setMessages((m) => m.slice(0, -1))
      setInput(question)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`qa ${open ? 'open' : ''}`}>
      <button type="button" className="qa-head" onClick={() => setOpen(!open)}>
        <strong>根拠付きQ&amp;A</strong>
        <span className="muted small">どのStepからでも質問できます</span>
        <span className="qa-toggle">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <>
          <div className="qa-body">
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
                {m.role === 'assistant' && m.source && (
                  <div className="row gap small">
                    <span className={`badge ${SOURCE_LABEL[m.source].cls}`}>{SOURCE_LABEL[m.source].text}</span>
                    {m.confidence && <span className="muted">確信度: {{ high: '高', medium: '中', low: '低' }[m.confidence]}</span>}
                  </div>
                )}
                <div className="msg-text">{m.text}</div>
                {m.evidence && <EvidenceList items={m.evidence} />}
              </div>
            ))}
            {busy && <div className="msg assistant muted">論文を確認しています…</div>}
            {error && <div className="error small">{error}</div>}
            <div ref={endRef} />
          </div>
          <form
            className="qa-input"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="論文について質問する" disabled={busy} />
            <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
              送信
            </button>
          </form>
        </>
      )}
    </div>
  )
}
