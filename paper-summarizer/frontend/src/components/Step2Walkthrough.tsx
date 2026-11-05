import { useEffect, useRef, useState } from 'react'
import type { Stage, Step2 } from '../api'
import { EvidenceList, PageChip, useJump, type JumpFn, type JumpOptions } from '../jump'
import { Tex } from './Tex'

/** 段階の根拠（なければ最初の図表のページ）へ PDF を移動して強調する。どちらもなければ何もしない */
function jumpToStage(jump: JumpFn, stage: Stage | undefined, options?: JumpOptions) {
  const ev = stage?.evidence?.[0]
  const page = ev?.page ?? stage?.figures?.[0]?.page
  if (page == null) return
  if (options) jump(page, ev?.quote, options)
  else if (ev) jump(page, ev.quote)
  else jump(page)
}

export function Step2Walkthrough({ data }: { data: Step2 }) {
  const [i, setI] = useState(0)
  const jump = useJump()
  const stage = data.stages[i]

  // Step 2 を開いたときに1回だけ、最初の段階の根拠を強調する。
  // 解析中の定期取得で data が新しくなっても繰り返さない。狭い画面では「解説」の表示のまま、PDF 側だけ準備する
  const openedRef = useRef(false)
  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true
    jumpToStage(jump, data.stages[0], { switchView: false })
  }, [jump, data.stages])

  // 学生が段階を移動したときは、その段階の根拠へ移動する（狭い画面では PDF を表示する）
  const goTo = (k: number) => {
    setI(k)
    jumpToStage(jump, data.stages[k])
  }

  if (!stage) return <p className="muted">手法の段階を取り出せませんでした。</p>
  return (
    <div className="step">
      <section className="block">
        <h2>手法の流れ</h2>
        <p className="lead">{data.overview}</p>
        <ol className="stepper">
          {data.stages.map((s, k) => (
            <li key={k}>
              <button
                type="button"
                className={k === i ? 'current' : k < i ? 'done' : ''}
                aria-current={k === i ? 'step' : undefined}
                onClick={() => goTo(k)}
              >
                {k === i && (
                  <svg className="stage-circle" aria-hidden="true" viewBox="0 0 244 96" preserveAspectRatio="none">
                    <path d="M3,45 C1,20 55,1 124,3 C189,2.5 246,25 244,49 C243,76 183,95.5 120,94 C55,93 -1,69 1,43 L9,19" />
                  </svg>
                )}
                <span className="num">{k + 1}</span>
                <span className="stage-name">{s.title}</span>
              </button>
              {k < data.stages.length - 1 && (
                <svg className="stage-arrow" aria-hidden="true" width="30" height="14" viewBox="0 0 30 14">
                  <path d="M2,8 Q14,5 26,7 M26,7 l-7,-5 M26,7 l-6,6" />
                </svg>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="block stage">
        <h2 className="stage-title">
          {i + 1}. {stage.title}
        </h2>
        <p className="explain">{stage.explanation}</p>
        <EvidenceList items={stage.evidence} />

        {stage.figures.map((f, k) => (
          <div key={k} className="sub-block">
            <div className="row between">
              <h3>{f.label}の読み方</h3>
              <PageChip page={f.page} label={`${f.label}をPDFで開く（p.${f.page}）`} />
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
              <div className="mentions small">
                <span className="muted">本文での言及</span> <EvidenceList items={f.referenced_at} />
              </div>
            )}
          </div>
        ))}

        {stage.equations.map((eq, k) => (
          <div key={k} className="sub-block">
            <div className="row between">
              <h3>式 {eq.label}</h3>
              <PageChip page={eq.page} />
            </div>
            <Tex tex={eq.latex} block />
            <p className="why">
              <span className="label">式の意味</span>
              <span>{eq.plain_meaning}</span>
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
                      <td>{s.defined_page && <PageChip page={s.defined_page} label={`定義のp.${s.defined_page}を開く`} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        <div className="row between nav">
          <button type="button" className="btn" disabled={i === 0} onClick={() => goTo(i - 1)}>
            前の段階へ
          </button>
          <span className="muted small">
            {i + 1} / {data.stages.length}
          </span>
          <button type="button" className="btn primary" disabled={i === data.stages.length - 1} onClick={() => goTo(i + 1)}>
            次の段階へ
          </button>
        </div>
      </section>
    </div>
  )
}
