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

  if (!stage) return <p className="muted">ウォークスルーを生成できませんでした。</p>
  return (
    <div className="step">
      <section className="card">
        <h2>手法の流れ</h2>
        <p>{data.overview}</p>
        <ol className="stepper">
          {data.stages.map((s, k) => (
            <li key={k}>
              <button type="button" className={k === i ? 'current' : k < i ? 'done' : ''} onClick={() => goTo(k)}>
                <span className="num">{k + 1}</span>
                <span>{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="card stage">
        <div className="row between">
          <h2>
            {i + 1}. {stage.title}
          </h2>
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
          <button type="button" className="btn" disabled={i === 0} onClick={() => goTo(i - 1)}>
            ← 前の段階
          </button>
          <span className="muted small">
            {i + 1} / {data.stages.length}
          </span>
          <button type="button" className="btn primary" disabled={i === data.stages.length - 1} onClick={() => goTo(i + 1)}>
            次の段階 →
          </button>
        </div>
      </section>
    </div>
  )
}
