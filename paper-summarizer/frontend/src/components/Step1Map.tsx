import { useEffect, useMemo, useState } from 'react'
import type { Step1, Step2, Verdict } from '../api'
import { useElementWidth } from '../hooks/useElementWidth'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { EvidenceList, PageChip } from '../jump'
import {
  edgePaths,
  filterConcepts,
  importanceOf,
  isConceptLevel,
  isInference,
  layoutConcepts,
  nodeLabelSize,
  ovalPath,
  type ConceptLevel,
} from './conceptLayout'
import { ConceptCheck } from './ConceptCheck'
import { pickCheckTargets } from './conceptCheck'
import { equationsUsing } from './equationLinks'
import { forget, isMemory, KNOWN_CONCEPTS_KEY, rememberedIds, rememberKnown, type NameRecord } from './knownConcepts'
import { learningPath } from './learningPath'

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

const LEVEL_LABELS: { level: ConceptLevel; label: string }[] = [
  { level: 'essential', label: '必須だけ' },
  { level: 'recommended', label: '推奨まで' },
  { level: 'all', label: 'すべて' },
]
const IMPORTANCE_LABELS = { essential: '必須', recommended: '推奨', advanced: '発展' } as const
const EMPTY_LABELS: Record<ConceptLevel, string> = { essential: '必須', recommended: '必須・推奨', all: '' }

type Knowledge = Record<string, 'known' | 'unknown'>

const isKnowledge = (v: unknown): v is Knowledge =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => x === 'known' || x === 'unknown')

/** Step 2 の式から開かれたとき、最初に選んでおく概念。object ごとに 1 回の移動として扱う */
export type ConceptFocus = { id: string }

type Step1MapProps = {
  data: Step1
  paperId: string
  /** 「この概念を使う式」を調べるための Step 2。無ければ（作成中など）その欄を出さない */
  step2?: Step2 | null
  /** 式を押したとき（段階の番号, その段階の中での式の番号） */
  onOpenEquation?: (stage: number, index: number) => void
  focus?: ConceptFocus | null
}

export function Step1Map({ data, paperId, step2, onOpenEquation, focus }: Step1MapProps) {
  const [knowledge, setKnowledge] = useLocalStorageState<Knowledge>(`knowledge:${paperId}`, {}, isKnowledge)
  // 論文をまたいで覚える「知っている」概念の名前（照合キー）。論文ごとの knowledge とは別に持つ
  const [memory, setMemory] = useLocalStorageState<NameRecord[]>(KNOWN_CONCEPTS_KEY, [], isMemory)
  const [autoCount, setAutoCount] = useState(0)
  const [savedLevel, setLevel] = useLocalStorageState<ConceptLevel>(`conceptLevel:${paperId}`, 'all', isConceptLevel)
  // 式から隠れた概念へ移ったときの一時的な「すべて」。保存せず、学生が自分で切り替えたら外す
  const [override, setOverride] = useState<ConceptLevel | null>(null)
  const level = override ?? savedLevel
  const [selected, setSelected] = useState<string | null>(data.concepts[0]?.id ?? null)
  // 式から移ってきたときは、その概念を選ぶ。表示範囲で隠れている概念なら「すべて」に切り替えて選べるようにする
  useEffect(() => {
    if (!focus || !data.concepts.some((c) => c.id === focus.id)) return
    setSelected(focus.id)
    setOverride(filterConcepts(data.concepts, level).some((c) => c.id === focus.id) ? null : 'all')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 移動の指示（focus）が変わったときだけ動かす
  }, [focus])
  // 覚えている名前と同じ概念で、この論文でまだ仕分けていないものを「知っている」にする。
  // この論文で明示的に付けた印（knowledge にある id）は上書きしない。論文を開いたときの 1 回だけ行う
  useEffect(() => {
    const ids = rememberedIds(data.concepts, memory).filter((id) => !knowledge[id])
    if (ids.length === 0) return
    setKnowledge((k) => ({ ...Object.fromEntries(ids.filter((id) => !k[id]).map((id) => [id, 'known' as const])), ...k }))
    setAutoCount(ids.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 論文（概念の一覧）が変わったときだけ動かす。仕分けのたびには動かさない
  }, [paperId, data.concepts])
  // 表示範囲に入る概念だけを図にする。隠した概念への依存は、レイアウトと矢印が無視する
  const concepts = useMemo(() => filterConcepts(data.concepts, level), [data.concepts, level])
  const narrow = useNarrow()
  const { ref: graphBox, width: available } = useElementWidth<HTMLDivElement>()
  const wide = useMemo(() => layoutConcepts(concepts, false), [concepts])
  // 狭い画面に加え、境目を動かして解説側が狭くなり横並びの図が入らないときも、上から下へ並べる
  const stacked = narrow || (available != null && available < wide.width)
  const layout = useMemo(() => (stacked ? layoutConcepts(concepts, true) : wide), [concepts, stacked, wide])
  const edges = useMemo(() => edgePaths(concepts, layout), [concepts, layout])
  const { pos, width, height, nodeW, nodeH } = layout
  // 選んだ概念につながる矢印は濃く、最後に描いて上に出す。矢印は楕円の後に描き、矢じりが楕円に隠れないようにする
  // 選んだ概念が隠れたときは、見えている先頭の概念に切り替える
  const sel = concepts.find((c) => c.id === selected) ?? concepts[0]
  const selId = sel?.id ?? null
  const usedBy = useMemo(() => (selId && onOpenEquation ? equationsUsing(step2, selId) : []), [step2, selId, onOpenEquation])
  const isActive = (e: { from: string; to: string }) => selId === e.from || selId === e.to
  const unknown = concepts.filter((c) => knowledge[c.id] === 'unknown')
  // 学ぶ順番は表示範囲内の「知らない」だけを載せる（地図で選べる概念と、下の一覧に合わせる）。
  // 順序そのものは全概念の依存で決めるので、表示範囲を変えても前後関係は変わらない
  const path = useMemo(() => learningPath(data.concepts, new Set(unknown.map((c) => c.id))), [data.concepts, unknown])
  const byId = useMemo(() => new Map(data.concepts.map((c) => [c.id, c])), [data.concepts])
  // 印を付ける唯一の経路。手で押したときも、確認モードの答え合わせのあとも、ここを通る
  const setMany = (verdicts: Record<string, Verdict>) => {
    const entries = Object.entries(verdicts).filter(([id]) => byId.has(id))
    setKnowledge((k) => ({ ...k, ...Object.fromEntries(entries) }))
    // 「知らない」にしたら覚えから外す（前の論文での「知っている」を持ち越さない）
    setMemory((m) =>
      entries.reduce((acc, [id, v]) => {
        const name = byId.get(id)!.name
        return v === 'known' ? rememberKnown(acc, name) : forget(acc, name)
      }, m),
    )
  }
  const set = (id: string, v: Verdict) => setMany({ [id]: v })
  const checkTargets = useMemo(() => pickCheckTargets(concepts, knowledge), [concepts, knowledge])
  const clearMemory = () => {
    if (window.confirm('覚えている「知っている」概念をすべて消します。この論文で付けた印はそのままです。よろしいですか？')) setMemory([])
  }

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
        <div className="row between">
          <h2>前提知識</h2>
          <span className="toggle-group" role="group" aria-label="表示する前提知識の範囲">
            {LEVEL_LABELS.map(({ level: l, label }) => (
              <button
                key={l}
                type="button"
                className={`toggle ${level === l ? 'on' : ''}`}
                aria-pressed={level === l}
                onClick={() => {
                  setOverride(null)
                  setLevel(l)
                }}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        {concepts.length === 0 && data.concepts.length > 0 && (
          <p className="muted small">{EMPTY_LABELS[level]}の概念がありません。「すべて」に切り替えると全部の概念を見られます。</p>
        )}
        <div className="graph-scroll" ref={graphBox}>
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
              {concepts.map((c) => {
                const p = pos.get(c.id)!
                const k = knowledge[c.id]
                return (
                  <path
                    key={c.id}
                    d={ovalPath(p.x + nodeW / 2, p.y + nodeH / 2, nodeW / 2 - 3, nodeH / 2 - 3)}
                    className={`graph-oval ${k ?? ''} ${isInference(c) ? 'inference' : ''} ${selId === c.id ? 'selected' : ''}`
                      .replace(/ +/g, ' ')
                      .trim()}
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
              {concepts.map((c) => {
                const p = pos.get(c.id)!
                const k = knowledge[c.id]
                return (
                  <li key={c.id} style={{ left: p.x, top: p.y, width: nodeW, height: nodeH }}>
                    <button
                      type="button"
                      className={`graph-node ${k ?? ''} ${isInference(c) ? 'inference' : ''} ${selId === c.id ? 'selected' : ''} ${nodeLabelSize(c.name)}`
                        .replace(/ +/g, ' ')
                        .trim()}
                      title={c.name}
                      aria-pressed={selId === c.id}
                      onClick={() => setSelected(c.id)}
                    >
                      <span className="graph-node-name">{c.name}</span>
                      {k ? (
                        <small className={`node-tag ${k}`}>{k === 'known' ? '知っている' : '知らない'}</small>
                      ) : (
                        isInference(c) && <small className="node-tag inference">AIの推定</small>
                      )}
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
            <p className="concept-meta">
              <span className="importance-tag">{IMPORTANCE_LABELS[importanceOf(sel)]}</span>
              {isInference(sel) && <span className="inference-tag">AIの推定</span>}
            </p>
            <p className="why">
              <span className="label">なぜ必要か</span>
              <span>{sel.why_needed}</span>
            </p>
            {isInference(sel) ? (
              <p className="muted small">論文には出てこない前提知識です。読むのに必要だとAIが推定したもので、論文の記述ではありません。</p>
            ) : sel.evidence?.length ? (
              <EvidenceList items={sel.evidence} />
            ) : (
              <PageChip page={sel.first_page} label={sel.first_page ? `初出のp.${sel.first_page}を開く` : undefined} />
            )}
            {usedBy.length > 0 && (
              <div className="chips concept-uses" role="group" aria-label="この概念を使う式">
                <span className="chips-label">この概念を使う式</span>
                {usedBy.map((r) => (
                  <button
                    key={`${r.stage}-${r.index}`}
                    type="button"
                    className="chip page"
                    onClick={() => onOpenEquation?.(r.stage, r.index)}
                  >
                    式 {r.label}（p.{r.page}）
                  </button>
                ))}
              </div>
            )}
            {knowledge[sel.id] === 'unknown' && <p className="explain">{sel.description}</p>}
          </div>
        )}

        {/* 読み上げが拾えるよう、容器は常に置き、中身だけ差し替える */}
        <p className="muted small auto-known-note" role="status">
          {autoCount > 0 && `前の論文で知っているとした概念を仕分け済みにしました（${autoCount}件）`}
        </p>
        {memory.length > 0 && (
          <p className="small">
            <button type="button" className="btn small" onClick={clearMemory}>
              覚えた「知っている」を消す
            </button>
          </p>
        )}

        <ConceptCheck paperId={paperId} concepts={data.concepts} targets={checkTargets} onJudge={setMany} />

        {unknown.length > 0 && (
          <div className="unknown-list">
            <h3>
              <span className="magnet yellow" aria-hidden="true" />
              先に押さえておく概念（{unknown.length}）
            </h3>
            {path.cyclic ? (
              <p className="muted small">概念の依存関係に循環があるため、学ぶ順番は出せません。下の一覧を順に見てください。</p>
            ) : (
              <ol className="learning-path" aria-label="学ぶ順番">
                {path.order.map((id) => (
                  <li key={id}>
                    <button type="button" className="chip page" onClick={() => setSelected(id)}>
                      {byId.get(id)?.name}
                    </button>
                  </li>
                ))}
              </ol>
            )}
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
