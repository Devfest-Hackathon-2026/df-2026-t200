import { useEffect, useMemo, useState } from 'react'
import type { Concept, Step1 } from '../api'
import { PageChip } from '../jump'

type Knowledge = Record<string, 'known' | 'unknown'>

const NODE_W = 168
const NODE_H = 48
const COL_GAP = 44
const ROW_GAP = 14
const PAD = 12

/** 依存関係から列（深さ）を決める。基礎的な概念が左、論文の中心に近い概念が右に並ぶ。 */
function layout(concepts: Concept[]) {
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const depth = new Map<string, number>()
  const visit = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (stack.has(id)) return 0 // 循環は打ち切る
    stack.add(id)
    const c = byId.get(id)
    const d = c ? Math.max(0, ...c.depends_on.filter((x) => byId.has(x)).map((x) => visit(x, stack) + 1)) : 0
    stack.delete(id)
    depth.set(id, d)
    return d
  }
  concepts.forEach((c) => visit(c.id, new Set()))
  const cols: Concept[][] = []
  concepts.forEach((c) => {
    const d = depth.get(c.id) ?? 0
    ;(cols[d] ??= []).push(c)
  })
  const pos = new Map<string, { x: number; y: number }>()
  cols.forEach((col, ci) => col.forEach((c, ri) => pos.set(c.id, { x: PAD + ci * (NODE_W + COL_GAP), y: PAD + ri * (NODE_H + ROW_GAP) })))
  const rows = Math.max(1, ...cols.map((c) => c?.length ?? 0))
  return {
    pos,
    width: PAD * 2 + cols.length * NODE_W + (cols.length - 1) * COL_GAP,
    height: PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP,
  }
}

export function Step1Map({ data, paperId }: { data: Step1; paperId: string }) {
  const storageKey = `knowledge:${paperId}`
  const [knowledge, setKnowledge] = useState<Knowledge>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    } catch {
      return {}
    }
  })
  const [selected, setSelected] = useState<string | null>(data.concepts[0]?.id ?? null)
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(knowledge))
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, [knowledge, storageKey])

  const { pos, width, height } = useMemo(() => layout(data.concepts), [data.concepts])
  const sel = data.concepts.find((c) => c.id === selected)
  const unknown = data.concepts.filter((c) => knowledge[c.id] === 'unknown')
  const unchecked = data.concepts.filter((c) => !knowledge[c.id]).length
  const set = (id: string, v: 'known' | 'unknown') => setKnowledge((k) => ({ ...k, [id]: v }))

  return (
    <div className="step">
      <section className="card">
        <div className="row between">
          <h3>3行でつかむ</h3>
          <span className="badge">難易度: {data.difficulty}</span>
        </div>
        <ol className="summary3">
          {data.summary.map((s, i) => (
            <li key={i}>
              <span className="muted">{['何の問題？', 'どう解いた？', '何が分かった？'][i] ?? ''}</span> {s}
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h3>前提知識マップ</h3>
        <p className="muted small">
          左ほど基礎的な概念です。それぞれ「知っている／知らない」を選ぶと、知らない概念だけ補足を表示します。
          {unchecked > 0 && `（未チェック ${unchecked} 個）`}
        </p>
        <div className="graph-scroll">
          <svg width={width} height={height} role="img" aria-label="前提知識の依存関係">
            <defs>
              <marker id="pm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 0L10 5L0 10z" className="graph-arrow" />
              </marker>
            </defs>
            {data.concepts.flatMap((c) =>
              c.depends_on
                .filter((d) => pos.has(d))
                .map((d) => {
                  const a = pos.get(d)!
                  const b = pos.get(c.id)!
                  const x1 = a.x + NODE_W
                  const y1 = a.y + NODE_H / 2
                  const x2 = b.x - 2
                  const y2 = b.y + NODE_H / 2
                  const mx = (x1 + x2) / 2
                  return (
                    <path
                      key={`${d}-${c.id}`}
                      d={`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                      className={`graph-edge ${selected === c.id || selected === d ? 'active' : ''}`}
                      markerEnd="url(#pm-arrow)"
                    />
                  )
                }),
            )}
            {data.concepts.map((c) => {
              const p = pos.get(c.id)!
              const k = knowledge[c.id]
              return (
                <g key={c.id} className={`graph-node ${k ?? ''} ${selected === c.id ? 'selected' : ''}`} onClick={() => setSelected(c.id)}>
                  <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={8} />
                  <foreignObject x={p.x} y={p.y} width={NODE_W} height={NODE_H}>
                    <div className="graph-label">
                      <span>{c.name}</span>
                      {k && <small>{k === 'known' ? '知っている' : '補足あり'}</small>}
                    </div>
                  </foreignObject>
                </g>
              )
            })}
          </svg>
        </div>

        {sel && (
          <div className="concept-detail">
            <div className="row between">
              <strong>{sel.name}</strong>
              <span className="row gap">
                <button
                  type="button"
                  className={`toggle ${knowledge[sel.id] === 'known' ? 'on' : ''}`}
                  onClick={() => set(sel.id, 'known')}
                >
                  知っている
                </button>
                <button
                  type="button"
                  className={`toggle warn ${knowledge[sel.id] === 'unknown' ? 'on' : ''}`}
                  onClick={() => set(sel.id, 'unknown')}
                >
                  知らない
                </button>
              </span>
            </div>
            <p className="small">
              <span className="muted">なぜ必要？</span> {sel.why_needed}{' '}
              <PageChip page={sel.first_page} label={sel.first_page ? `初出 p.${sel.first_page}` : undefined} />
            </p>
            {knowledge[sel.id] === 'unknown' && <p className="explain">{sel.description}</p>}
          </div>
        )}

        {unknown.length > 0 && (
          <div className="unknown-list">
            <h4>先に押さえておく概念（{unknown.length}）</h4>
            {unknown.map((c) => (
              <details key={c.id}>
                <summary>{c.name}</summary>
                <p className="small">{c.description}</p>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3>おすすめの読む順番</h3>
        <ol className="reading-order">
          {data.reading_order.map((r, i) => (
            <li key={i}>
              <div className="row gap">
                <strong>{r.section}</strong>
                <PageChip page={r.page} />
              </div>
              <span className="muted small">{r.reason}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
