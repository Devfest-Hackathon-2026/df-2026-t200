import type { Flow, FlowFrame } from '../api'
import { edgeKey } from './flowLayout'

export const FLOW_NOTES_MAX = 3

/**
 * コマごとの注記。そのコマで流れる矢印について「何が流れるか」と「形がどう変わるか」を
 * 既存のデータ（辺のラベル、ノードの shape）だけから作る。どちらも無い矢印は出さない。
 * 画面に出すのは先頭の FLOW_NOTES_MAX 件で、残りは件数だけ示す。
 */
export function frameNotes(flow: Flow, frame: FlowFrame | undefined): string[] {
  if (!frame) return []
  const active = new Set(frame.active_edges ?? [])
  const byId = new Map((flow.nodes ?? []).map((n) => [n.id, n]))
  const notes: string[] = []
  for (const e of flow.edges ?? []) {
    if (!active.has(edgeKey(e))) continue
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (!from || !to) continue
    const label = e.label?.trim() ?? ''
    const shapeChanged = !!from.shape && !!to.shape && from.shape !== to.shape
    if (!label && !shapeChanged) continue
    const what = label ? `：${label}` : ''
    const shape = shapeChanged ? `（形 ${from.shape} → ${to.shape}）` : ''
    notes.push(`${from.label} → ${to.label}${what}${shape}`)
  }
  return notes
}
