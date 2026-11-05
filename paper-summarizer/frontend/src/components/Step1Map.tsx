import { useMemo, useState } from 'react'
import type { Step1 } from '../api'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { PageChip } from '../jump'
import { NODE_H, NODE_W, layoutConcepts, ovalPath } from './conceptLayout'

type Knowledge = Record<string, 'known' | 'unknown'>

const isKnowledge = (v: unknown): v is Knowledge =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => x === 'known' || x === 'unknown')

export function Step1Map({ data, paperId }: { data: Step1; paperId: string }) {
  const [knowledge, setKnowledge] = useLocalStorageState<Knowledge>(`knowledge:${paperId}`, {}, isKnowledge)
  const [selected, setSelected] = useState<string | null>(data.concepts[0]?.id ?? null)
  const { pos, width, height } = useMemo(() => layoutConcepts(data.concepts), [data.concepts])
  const sel = data.concepts.find((c) => c.id === selected)
  const unknown = data.concepts.filter((c) => knowledge[c.id] === 'unknown')
  const set = (id: string, v: 'known' | 'unknown') => setKnowledge((k) => ({ ...k, [id]: v }))

  return (
    <div className="step">
      <section className="block">
        <div className="row between">
          <h2>3行でつかむ</h2>
          <span className="tag">難易度 {data.difficulty}</span>
        </div>
        <ol className="summary3">
          {data.summary.map((s, i) => (
            <li key={i}>
              <span className="summary3-q">{['何の問題？', 'どう解いた？', '何が分かった？'][i] ?? ''}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="block">
        <h2>前提知識</h2>
        <div className="graph-scroll">
          {/* SVG は線だけを描き、概念はキーボードで操作できる本物のボタンとして重ねる */}
          <div className="graph-canvas" style={{ width, height }}>
            <svg width={width} height={height} aria-hidden="true" focusable="false">
              <defs>
                <marker
                  id="pm-arrow"
                  viewBox="0 0 12 12"
                  refX="10"
                  refY="6"
                  markerWidth="11"
                  markerHeight="11"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M1.5 1.5L10 6L1.5 10.5" className="graph-arrow" />
                </marker>
              </defs>
              {data.concepts.map((c) => {
                const p = pos.get(c.id)!
                const k = knowledge[c.id]
                return (
                  <path
                    key={c.id}
                    d={ovalPath(p.x + NODE_W / 2, p.y + NODE_H / 2, NODE_W / 2 - 3, NODE_H / 2 - 3)}
                    className={`graph-oval ${k ?? ''} ${selected === c.id ? 'selected' : ''}`}
                  />
                )
              })}
              {data.concepts.flatMap((c) =>
                c.depends_on
                  .filter((d) => pos.has(d))
                  .map((d) => {
                    const a = pos.get(d)!
                    const b = pos.get(c.id)!
                    const x1 = a.x + NODE_W + 2
                    const y1 = a.y + NODE_H / 2
                    const x2 = b.x - 2
                    const y2 = b.y + NODE_H / 2
                    // 手描きらしく、直線でも少しだけたわませる
                    const mx = (x1 + x2) / 2
                    const my = (y1 + y2) / 2 + (y1 === y2 ? 4 : 0)
                    return (
                      <path
                        key={`${d}-${c.id}`}
                        d={`M${x1} ${y1}Q${mx} ${y1} ${mx} ${my}T${x2} ${y2}`}
                        className={`graph-edge ${selected === c.id || selected === d ? 'active' : ''}`}
                        markerEnd="url(#pm-arrow)"
                      />
                    )
                  }),
              )}
            </svg>
            <ul className="graph-nodes" aria-label="前提知識の概念">
              {data.concepts.map((c) => {
                const p = pos.get(c.id)!
                const k = knowledge[c.id]
                return (
                  <li key={c.id} style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}>
                    <button
                      type="button"
                      className={`graph-node ${k ?? ''} ${selected === c.id ? 'selected' : ''}`}
                      aria-pressed={selected === c.id}
                      onClick={() => setSelected(c.id)}
                    >
                      <span>{c.name}</span>
                      {k && <small className={`node-tag ${k}`}>{k === 'known' ? '知っている' : '知らない'}</small>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {sel && (
          <div className="concept-detail sheet">
            <span className="magnet blue" aria-hidden="true" />
            <div className="row between">
              <h3 className="concept-name">{sel.name}</h3>
              <span className="toggle-group" role="group" aria-label={`${sel.name}を知っているか`}>
                <button
                  type="button"
                  className={`toggle ${knowledge[sel.id] === 'known' ? 'on' : ''}`}
                  aria-pressed={knowledge[sel.id] === 'known'}
                  onClick={() => set(sel.id, 'known')}
                >
                  知っている
                </button>
                <button
                  type="button"
                  className={`toggle ${knowledge[sel.id] === 'unknown' ? 'on' : ''}`}
                  aria-pressed={knowledge[sel.id] === 'unknown'}
                  onClick={() => set(sel.id, 'unknown')}
                >
                  知らない
                </button>
              </span>
            </div>
            <p className="why">
              <span className="label">なぜ必要か</span>
              <span>{sel.why_needed}</span>
            </p>
            <PageChip page={sel.first_page} label={sel.first_page ? `初出のp.${sel.first_page}を開く` : undefined} />
            {knowledge[sel.id] === 'unknown' && <p className="explain">{sel.description}</p>}
          </div>
        )}

        {unknown.length > 0 && (
          <div className="unknown-list">
            <h3>
              <span className="magnet yellow" aria-hidden="true" />
              先に押さえておく概念（{unknown.length}）
            </h3>
            {unknown.map((c) => (
              <details key={c.id}>
                <summary>{c.name}</summary>
                <p className="small">{c.description}</p>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="block">
        <h2>読む順番</h2>
        <ol className="reading-order">
          {data.reading_order.map((r, i) => (
            <li key={i}>
              <span className="order-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="order-body">
                <div className="row gap">
                  <strong>{r.section}</strong>
                  <PageChip page={r.page} />
                </div>
                <span className="muted small">{r.reason}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
