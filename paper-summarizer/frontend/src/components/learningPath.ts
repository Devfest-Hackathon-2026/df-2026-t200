import type { Concept } from '../api'

export type LearningPath = {
  /** 学ぶ順に並べた概念の id。循環があるときは空 */
  order: string[]
  cyclic: boolean
}

/**
 * 「知らない」概念の学ぶ順番を、依存関係のトポロジカル順で求める。
 *
 * - 順序は概念すべての依存グラフで決める。間にある「知っている」概念や表示範囲外の概念を飛ばしても、
 *   前提の前後関係は保たれる。一覧に載せるのは unknownIds の概念だけ（地図で選べる概念と一致させるため、
 *   呼び出し側は表示範囲内の「知らない」だけを渡す）
 * - 同じ段（前提がそろった概念）の並びは元の配列の順で安定させる
 * - 自分自身や存在しない概念への依存は無視する（conceptLayout と同じ扱い）
 * - 一覧に載せる概念が循環に含まれる（または循環の先にある）ときは順番を出さず cyclic にする。
 *   一覧に関係しない場所の循環は無視する
 */
export function learningPath(concepts: Concept[], unknownIds: ReadonlySet<string>): LearningPath {
  const ids = new Set(concepts.map((c) => c.id))
  const remaining = new Map(concepts.map((c) => [c.id, new Set(c.depends_on.filter((d) => d !== c.id && ids.has(d)))]))
  const sorted: string[] = []
  while (remaining.size > 0) {
    const ready = concepts.filter((c) => remaining.has(c.id) && remaining.get(c.id)!.size === 0).map((c) => c.id)
    if (ready.length === 0) break
    ready.forEach((id) => remaining.delete(id))
    remaining.forEach((deps) => ready.forEach((id) => deps.delete(id)))
    sorted.push(...ready)
  }
  if ([...remaining.keys()].some((id) => unknownIds.has(id))) return { order: [], cyclic: true }
  return { order: sorted.filter((id) => unknownIds.has(id)), cyclic: false }
}
