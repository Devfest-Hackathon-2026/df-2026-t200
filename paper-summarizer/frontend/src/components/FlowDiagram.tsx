import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Flow, FlowKind, FlowNode } from '../api'
import { FLOW_NODE_H, FLOW_NODE_W, edgeKey, flowEdgePath, layoutFlow } from './flowLayout'

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'
const KIND_LABEL: Record<FlowKind, string> = { input: '入力', process: '処理', output: '出力' }
const EDGE_LABEL_MAX = 14

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(REDUCED_QUERY).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED_QUERY)
    if (!mq?.addEventListener) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * 手法の流れ図。型（配置・描画）はここで持ち、AI が出すのは中身の JSON だけ。
 * コマ（frame）は stages と1対1なので、index は Step 2 の段階の番号そのもの。
 */
export function FlowDiagram({
  flow,
  index,
  onGo,
  onNode,
}: {
  flow: Flow
  index: number
  onGo: (index: number) => void
  onNode: (node: FlowNode) => void
}) {
  const reduced = useReducedMotion()
  const layout = useMemo(() => layoutFlow(flow.nodes, flow.edges), [flow.nodes, flow.edges])
  const frame = flow.frames.find((f) => f.stage_index === index)
  const total = Math.max(index + 1, ...flow.frames.map((f) => f.stage_index + 1))
  const activeNodes = new Set(frame?.active_nodes)
  const activeEdges = new Set(frame?.active_edges)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' && index < total - 1) {
      e.preventDefault()
      onGo(index + 1)
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      onGo(index - 1)
    }
  }

  return (
    <div className="flow" role="group" aria-label="手法の流れ図（← → キーで1コマずつ進めます）" tabIndex={0} onKeyDown={onKeyDown}>
      <p className="flow-note small muted">AIが論文から作った図解です。根拠ページで確かめてください</p>
      <div className="flow-scroll">
        <div className="flow-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
            <defs>
              {['', '-active'].map((s) => (
                <marker
                  key={s}
                  id={`fl-arrow${s}`}
                  viewBox="0 0 10 10"
                  refX="9.5"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0.5 0.5L9.5 5L0.5 9.5z" className={`flow-arrow${s}`} />
                </marker>
              ))}
            </defs>
            {flow.edges.map((e) => {
              const d = flowEdgePath(e, layout)
              if (!d) return null
              const active = activeEdges.has(edgeKey(e))
              const a = layout.pos.get(e.from)!
              const b = layout.pos.get(e.to)!
              return (
                <g key={edgeKey(e)}>
                  <path d={d} className={`flow-edge ${active ? 'active' : ''}`} markerEnd={`url(#fl-arrow${active ? '-active' : ''})`} />
                  {e.label && (
                    <text
                      className="flow-edge-label"
                      x={(a.x + FLOW_NODE_W + b.x) / 2}
                      y={(a.y + b.y + FLOW_NODE_H) / 2 - 6}
                      textAnchor="middle"
                    >
                      <title>{e.label}</title>
                      {clip(e.label, EDGE_LABEL_MAX)}
                    </text>
                  )}
                  {active && !reduced && (
                    <circle className="flow-dot" r="5">
                      <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                </g>
              )
            })}
          </svg>
          <ul className="flow-nodes" aria-label="流れ図のノード">
            {flow.nodes.map((n) => {
              const p = layout.pos.get(n.id)
              if (!p) return null
              const active = activeNodes.has(n.id)
              return (
                <li key={n.id} style={{ left: p.x, top: p.y, width: FLOW_NODE_W, height: FLOW_NODE_H }}>
                  <button
                    type="button"
                    className={`flow-node ${n.kind} ${active ? 'active' : ''}`}
                    aria-current={active ? 'step' : undefined}
                    aria-label={`${n.label}（${KIND_LABEL[n.kind]}）${n.shape ? ` 形 ${n.shape}` : ''}`}
                    title={n.label}
                    onClick={() => onNode(n)}
                  >
                    <span className="flow-node-label">{n.label}</span>
                    {n.shape && <small className="flow-shape">{n.shape}</small>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      <p className="flow-caption" aria-live="polite">
        {frame?.caption}
      </p>
      <div className="row between flow-nav">
        <button type="button" className="btn" disabled={index === 0} onClick={() => onGo(index - 1)}>
          前へ
        </button>
        <span className="muted small">
          {index + 1} / {total}
        </span>
        <button type="button" className="btn primary" disabled={index >= total - 1} onClick={() => onGo(index + 1)}>
          次へ
        </button>
      </div>
    </div>
  )
}
