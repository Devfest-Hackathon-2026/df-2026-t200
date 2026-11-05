import { useEffect, useState } from 'react'
import type { Step2 } from '../api'
import { EvidenceList, PageChip, useJump } from '../jump'
import { Tex } from './Tex'

export function Step2Walkthrough({ data }: { data: Step2 }) {
  const [i, setI] = useState(0)
  const jump = useJump()
  const stage = data.stages[i]

  // 段階を進めるたびに、左の PDF を説明の根拠箇所へ移動して強調する
  useEffect(() => {
    const ev = stage?.evidence?.[0]
    if (ev) jump(ev.page, ev.quote)
    else if (stage?.figures?.[0]) jump(stage.figures[0].page)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!stage) return <p className="muted">ウォークスルーを生成できませんでした。</p>
  return (
    <div className="step">
      <section className="card">
        <h3>手法の流れ</h3>
        <p>{data.overview}</p>
        <ol className="stepper">
          {data.stages.map((s, k) => (
            <li key={k}>
              <button type="button" className={k === i ? 'current' : k < i ? 'done' : ''} onClick={() => setI(k)}>
                <span className="num">{k + 1}</span>
                <span>{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="card stage">
        <div className="row between">
          <h3>
            {i + 1}. {stage.title}
          </h3>
          <EvidenceList items={stage.evidence} />
        </div>
        <p className="explain">{stage.explanation}</p>

        {stage.figures.map((f, k) => (
          <div key={k} className="sub-card">
            <div className="row between">
              <strong>📊 {f.label}</strong>
              <PageChip page={f.page} label={`${f.label} を見る (p.${f.page})`} />
            </div>
            <dl className="defs">
              <dt>何を示す図表か</dt>
              <dd>{f.what_it_shows}</dd>
              <dt>読み方</dt>
              <dd>{f.how_to_read}</dd>
              <dt>支えている主張</dt>
              <dd>{f.supports_claim}</dd>
            </dl>
            {f.referenced_at.length > 0 && (
              <div className="small muted">
                本文での言及: <EvidenceList items={f.referenced_at} />
              </div>
            )}
          </div>
        ))}

        {stage.equations.map((eq, k) => (
          <div key={k} className="sub-card">
            <div className="row between">
              <strong>式 {eq.label}</strong>
              <PageChip page={eq.page} />
            </div>
            <Tex tex={eq.latex} block />
            <p className="small">
              <span className="muted">一言でいうと:</span> {eq.plain_meaning}
            </p>
            {eq.symbols.length > 0 && (
              <table className="symbols">
                <tbody>
                  {eq.symbols.map((s, j) => (
                    <tr key={j}>
                      <td>
                        <Tex tex={s.symbol_latex} />
                      </td>
                      <td>{s.meaning}</td>
                      <td>{s.defined_page && <PageChip page={s.defined_page} label={`定義 p.${s.defined_page}`} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        <div className="row between nav">
          <button type="button" className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
            ← 前の段階
          </button>
          <span className="muted small">
            {i + 1} / {data.stages.length}
          </span>
          <button type="button" className="btn primary" disabled={i === data.stages.length - 1} onClick={() => setI(i + 1)}>
            次の段階 →
          </button>
        </div>
      </section>
    </div>
  )
}
