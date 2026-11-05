import { useEffect, useRef, useState } from 'react'
import type { CriticalPoint, Evidence, Origin, Step3 } from '../api'

type Alternative = Step3['alternatives'][number]
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { EvidenceList } from '../jump'
import { scrollBehavior } from '../motion'

const isString = (v: unknown): v is string => typeof v === 'string'

function OriginBadge({ origin }: { origin: Origin }) {
  return origin === 'paper' ? (
    <span className="badge paper" title="論文に書いてある内容です">
      <span className="magnet green" aria-hidden="true" />
      論文の記述
    </span>
  ) : (
    <span className="badge ai" title="AIが考えた内容で、論文には書いてありません。自分で確かめてください">
      <span className="magnet red" aria-hidden="true" />
      AIの指摘（要検証）
    </span>
  )
}

/** 1つの列に並べる項目。長所・短所・限界・代替アプローチを同じ形にそろえる */
type Item = { kind: string; title?: string; text: string; comparison?: string; origin: Origin; evidence: Evidence[] }

const fromPoints = (kind: string, points: CriticalPoint[]): Item[] =>
  points.map((p) => ({ kind, text: p.text, origin: p.origin, evidence: p.evidence }))
const fromAlternatives = (alts: Alternative[]): Item[] =>
  alts.map((a) => ({
    kind: '代替アプローチ',
    title: a.name,
    text: a.description,
    comparison: a.comparison,
    origin: a.origin,
    evidence: a.evidence,
  }))

function Column({ origin, heading, items }: { origin: Origin; heading: string; items: Item[] }) {
  const id = `col-${origin}`
  return (
    <section className={`column ${origin}`} aria-labelledby={id}>
      <h3 id={id} className="column-head">
        {heading}
      </h3>
      <svg className="column-underline" aria-hidden="true" viewBox="0 0 240 8" preserveAspectRatio="none">
        <path d="M2,5 Q80,2 160,4 T238,3" />
      </svg>
      {items.length === 0 ? (
        <p className="muted small">なし</p>
      ) : (
        <ul className="points">
          {items.map((p, i) => (
            <li key={i} className={p.origin}>
              <span className="point-kind">{p.kind}</span>
              {p.title && <strong className="point-title">{p.title}</strong>}
              <span className="point-text">{p.text}</span>
              {p.comparison && (
                <span className="point-text small">
                  <span className="label">提案手法との違い</span> {p.comparison}
                </span>
              )}
              <span className="point-foot">
                <OriginBadge origin={p.origin} />
                <EvidenceList items={p.evidence} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Step3Critical({ data, paperId }: { data: Step3; paperId: string }) {
  // 1文字ごとに保存しないよう、書き込みは間引く
  const [thoughts, setThoughts] = useLocalStorageState(`thoughts:${paperId}`, '', isString)
  const [revealed, setRevealed] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  // 解説を開いたら最初の項目までスクロールし、何が出てきたかを見せる
  useEffect(() => {
    if (revealed) resultsRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
  }, [revealed])

  const items = [
    ...fromPoints('長所', data.pros),
    ...fromPoints('短所', data.cons),
    ...fromPoints('限界', data.limitations),
    ...fromAlternatives(data.alternatives),
  ]

  return (
    <div className="step">
      <section className="block think">
        <div className="think-questions">
          <h2>先に考える問い</h2>
          <ol className="prompts">
            {data.prompts.map((p, i) => (
              <li key={i}>
                <span className="order-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
          <p className="think-note">解説を見る前に、自分の考えを書いてください。</p>
        </div>
        <div className="sticky">
          <label htmlFor={`thoughts-${paperId}`} className="sticky-label">
            あなたの考え
          </label>
          <textarea
            id={`thoughts-${paperId}`}
            value={thoughts}
            onChange={(e) => setThoughts(e.target.value)}
            placeholder="このブラウザにだけ保存します"
            rows={4}
          />
        </div>
        {!revealed && (
          <div className="row gap reveal-actions">
            <button type="button" className="btn primary" disabled={!thoughts.trim()} onClick={() => setRevealed(true)}>
              解説を見る
            </button>
            <button type="button" className="btn link" onClick={() => setRevealed(true)}>
              書かずに解説を見る
            </button>
          </div>
        )}
      </section>

      {revealed && (
        <>
          <div className="columns reveal-start" ref={resultsRef}>
            <Column origin="paper" heading="論文の記述" items={items.filter((p) => p.origin === 'paper')} />
            <svg className="column-divider" aria-hidden="true" viewBox="0 0 24 300" preserveAspectRatio="none">
              <path d="M12,4 Q10,90 13,160 T11,296" />
            </svg>
            <Column origin="ai_inference" heading="AIの指摘（要検証）" items={items.filter((p) => p.origin !== 'paper')} />
          </div>
          {data.likely_questions.length > 0 && (
            <section className="block">
              <h2>輪講で聞かれそうな質問</h2>
              {data.likely_questions.map((q, i) => (
                <details key={i} className="qa-hint">
                  <summary>{q.question}</summary>
                  <p className="small">ヒント: {q.hint}</p>
                </details>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
