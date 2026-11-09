import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Flow, FlowKind, FlowNode } from '../api'
import { FLOW_EDGE_LABEL_MAX, FLOW_NODE_H, FLOW_NODE_W, edgeKey, flowEdgePath, layoutFlow } from './flowLayout'

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'
const KIND_LABEL: Record<FlowKind, string> = { input: '入力', process: '処理', output: '出力' }

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
  total,
  onGo,
  onNode,
}: {
  flow: Flow
  index: number
  total: number
  onGo: (index: number) => void
  onNode: (node: FlowNode) => void
}) {
  const reduced = useReducedMotion()
  const nodes = useMemo(() => flow.nodes ?? [], [flow.nodes])
  const edges = useMemo(() => flow.edges ?? [], [flow.edges])
  const layout = useMemo(() => layoutFlow(nodes, edges), [nodes, edges])
  const frame = (flow.frames ?? []).find((f) => f.stage_index === index)
  const activeNodes = new Set(frame?.active_nodes ?? [])
  const activeEdges = new Set(frame?.active_edges ?? [])

  // ノードが多くて図が横にはみ出すとき、そのコマで強調するノードが見えるよう横にスクロールする
  const scroller = useRef<HTMLDivElement>(null)
  const activeKey = (frame?.active_nodes ?? []).join('\n')
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const center = () => {
      if (el.scrollWidth <= el.clientWidth) return
      const xs = (activeKey ? activeKey.split('\n') : []).flatMap((id) => {
        const p = layout.pos.get(id)
        return p ? [p.x] : []
      })
      if (xs.length === 0) return
      const mid = (Math.min(...xs) + Math.max(...xs) + FLOW_NODE_W) / 2
      const left = Math.max(0, Math.min(mid - el.clientWidth / 2, el.scrollWidth - el.clientWidth))
      el.scrollTo?.({ left, behavior: reduced ? 'auto' : 'smooth' })
    }
    center()
    // 狭い画面で PDF タブを見ている間は図が非表示で寸法が 0 になる。表示に戻ったときにやり直す
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) center()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [activeKey, layout, reduced])

  const box = useRef<HTMLDivElement>(null)
  // ボタンで端のコマに着いて押したボタンが無効になるとき、フォーカスが body に落ちないよう図へ戻す
  const step = (k: number) => {
    onGo(k)
    if (k <= 0 || k >= total - 1) box.current?.focus()
  }

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
    <div
      ref={box}
      className="flow"
      role="group"
      aria-label="手法の流れ図（← → キーで1コマずつ進めます）"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <p className="flow-note small muted">AIが論文から作った図解です。根拠ページで確かめてください</p>
      <div className="flow-scroll" ref={scroller}>
        <div className="flow-canvas" style={{ width: layout.width, height: layout.height }}>
          {layout.bands.length > 0 && (
            <div className="flow-bands" aria-hidden="true">
              {layout.bands.map((b, k) => (
                <div key={b.group} className={`flow-band flow-band-${k % 4}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
                  <span className="flow-band-label" title={b.group}>
                    {b.group}
                  </span>
                </div>
              ))}
            </div>
          )}
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
            {edges.map((e) => {
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
                      {clip(e.label, FLOW_EDGE_LABEL_MAX)}
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
            {nodes.map((n) => {
              const p = layout.pos.get(n.id)
              if (!p) return null
              const active = activeNodes.has(n.id)
              return (
                <li key={n.id} style={{ left: p.x, top: p.y, width: FLOW_NODE_W, height: FLOW_NODE_H }}>
                  <button
                    type="button"
                    className={`flow-node ${n.kind} ${active ? 'active' : ''}`}
                    aria-current={active ? 'step' : undefined}
                    aria-label={`${n.label}（${KIND_LABEL[n.kind]}）${n.shape ? ` 形 ${n.shape}` : ''}${n.group?.trim() ? ` 段階 ${n.group.trim()}` : ''}`}
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
        <button type="button" className="btn" disabled={index === 0} onClick={() => step(index - 1)}>
          前へ
        </button>
        <span className="muted small">
          {index + 1} / {total}
        </span>
        <button type="button" className="btn primary" disabled={index >= total - 1} onClick={() => step(index + 1)}>
          次へ
        </button>
      </div>
    </div>
  )
}
