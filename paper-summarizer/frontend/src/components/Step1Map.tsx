import { useEffect, useMemo, useState } from 'react'
import type { Step1 } from '../api'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { PageChip } from '../jump'
import { edgePaths, layoutConcepts, ovalPath } from './conceptLayout'

/** App.tsx の NARROW_QUERY と同じ幅。狭い画面では概念を上から下へ並べ、横にはみ出さないようにする */
const NARROW_QUERY = '(max-width: 900px)'

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY)
    if (!mq?.addEventListener) return
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

type Knowledge = Record<string, 'known' | 'unknown'>

const isKnowledge = (v: unknown): v is Knowledge =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => x === 'known' || x === 'unknown')

export function Step1Map({ data, paperId }: { data: Step1; paperId: string }) {
  const [knowledge, setKnowledge] = useLocalStorageState<Knowledge>(`knowledge:${paperId}`, {}, isKnowledge)
  const [selected, setSelected] = useState<string | null>(data.concepts[0]?.id ?? null)
  const narrow = useNarrow()
  const layout = useMemo(() => layoutConcepts(data.concepts, narrow), [data.concepts, narrow])
  const edges = useMemo(() => edgePaths(data.concepts, layout), [data.concepts, layout])
  const { pos, width, height, nodeW, nodeH } = layout
  // 選んだ概念につながる矢印は濃く、最後に描いて上に出す。矢印は楕円の後に描き、矢じりが楕円に隠れないようにする
  const isActive = (e: { from: string; to: string }) => selected === e.from || selected === e.to
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
                {['', '-active'].map((suffix) => (
                  <marker
                    key={suffix}
                    id={`pm-arrow${suffix}`}
                    viewBox="0 0 10 10"
                    refX="9.5"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M0.5 0.5L9.5 5L0.5 9.5z" className={`graph-arrow${suffix}`} />
                  </marker>
                ))}
              </defs>
              {data.concepts.map((c) => {
                const p = pos.get(c.id)!
                const k = knowledge[c.id]
                return (
                  <path
                    key={c.id}
                    d={ovalPath(p.x + nodeW / 2, p.y + nodeH / 2, nodeW / 2 - 3, nodeH / 2 - 3)}
                    className={`graph-oval ${k ?? ''} ${selected === c.id ? 'selected' : ''}`}
                  />
                )
              })}
              {[...edges.filter((e) => !isActive(e)), ...edges.filter(isActive)].map((e) => (
                <path
                  key={`${e.from}-${e.to}`}
                  d={e.d}
                  className={`graph-edge ${isActive(e) ? 'active' : ''}`}
                  markerEnd={`url(#pm-arrow${isActive(e) ? '-active' : ''})`}
                />
              ))}
            </svg>
            <ul className="graph-nodes" aria-label="前提知識の概念">
              {data.concepts.map((c) => {
                const p = pos.get(c.id)!
                const k = knowledge[c.id]
                return (
                  <li key={c.id} style={{ left: p.x, top: p.y, width: nodeW, height: nodeH }}>
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
