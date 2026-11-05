import { useEffect, useRef, useState } from 'react'
import type { CriticalPoint, Origin, Step3 } from '../api'
import { EvidenceList } from '../jump'

function OriginBadge({ origin }: { origin: Origin }) {
  return origin === 'paper' ? (
    <span className="badge paper" title="論文自身が述べている内容です">
      論文の記述
    </span>
  ) : (
    <span className="badge ai" title="AIによる推論です。論文の主張ではありません。自分で確かめてください">
      AIの指摘・要検証
    </span>
  )
}

function Points({ title, items }: { title: string; items: CriticalPoint[] }) {
  if (!items.length) return null
  return (
    <section className="card">
      <h3>{title}</h3>
      <ul className="points">
        {items.map((p, i) => (
          <li key={i} className={p.origin}>
            <OriginBadge origin={p.origin} />
            <span>{p.text}</span>
            <EvidenceList items={p.evidence} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Step3Critical({ data, paperId }: { data: Step3; paperId: string }) {
  const key = `thoughts:${paperId}`
  const [thoughts, setThoughts] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const [revealed, setRevealed] = useState(false)
  const resultsRef = useRef<HTMLParagraphElement>(null)
  // 解説を開いたら最初の項目までスクロールし、何が出てきたかを見せる
  useEffect(() => {
    if (revealed) resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [revealed])
  useEffect(() => {
    try {
      localStorage.setItem(key, thoughts)
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, [thoughts, key])

  return (
    <div className="step">
      <section className="card think">
        <h3>まず自分で考える</h3>
        <ul>
          {data.prompts.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <textarea
          value={thoughts}
          onChange={(e) => setThoughts(e.target.value)}
          placeholder="あなたの考えをメモしてください（このブラウザにだけ保存されます）"
          rows={4}
        />
        {!revealed && (
          <div className="row gap">
            <button type="button" className="btn primary" disabled={!thoughts.trim()} onClick={() => setRevealed(true)}>
              考えを書いたので解説を見る
            </button>
            <button type="button" className="btn link" onClick={() => setRevealed(true)}>
              書かずに見る
            </button>
          </div>
        )}
      </section>

      {revealed && (
        <>
          <p className="legend small reveal-start" ref={resultsRef}>
            <span className="badge paper">論文の記述</span> 論文自身が述べていること（根拠ページ付き）
            <span className="badge ai">AIの指摘・要検証</span> AIの推論。論文の主張ではないので、自分で確かめる
          </p>
          <Points title="Pros（長所）" items={data.pros} />
          <Points title="Cons（短所）" items={data.cons} />
          <Points title="限界" items={data.limitations} />
          {data.alternatives.length > 0 && (
            <section className="card">
              <h3>代替アプローチ</h3>
              {data.alternatives.map((a, i) => (
                <div key={i} className="sub-card">
                  <div className="row between">
                    <strong>{a.name}</strong>
                    <OriginBadge origin={a.origin} />
                  </div>
                  <p className="small">{a.description}</p>
                  <p className="small">
                    <span className="muted">提案手法との比較:</span> {a.comparison}
                  </p>
                  <EvidenceList items={a.evidence} />
                </div>
              ))}
            </section>
          )}
          <section className="card">
            <h3>輪講で聞かれそうな質問</h3>
            {data.likely_questions.map((q, i) => (
              <details key={i} className="qa-hint">
                <summary>{q.question}</summary>
                <p className="small">ヒント: {q.hint}</p>
              </details>
            ))}
          </section>
        </>
      )}
    </div>
  )
}
