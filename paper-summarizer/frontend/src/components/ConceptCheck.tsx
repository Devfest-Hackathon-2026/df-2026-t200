import { useEffect, useId, useRef, useState } from 'react'
import { api, type Check, type Concept, type Verdict } from '../api'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import { EvidenceList } from '../jump'
import { EMPTY_CHECK_DRAFT, isCheckDraft, type CheckDraft } from './conceptCheck'

const isAbort = (e: unknown, signal: AbortSignal) => signal.aborted || (e instanceof DOMException && e.name === 'AbortError')
const VERDICT_LABEL = { known: '知っている', unknown: '知らない' } as const

type Props = {
  paperId: string
  /** 名前を引くための、この論文の全概念 */
  concepts: Concept[]
  /** 問題にする概念（表示範囲のうち未仕分けのもの、最大6）。親が決める */
  targets: Concept[]
  /** 答え合わせのあと、概念ごとの判定を親に渡す。親が手で押したときと同じ経路で印を付ける */
  onJudge: (verdicts: Record<string, Verdict>) => void
}

export function ConceptCheck({ paperId, concepts, targets, onJudge }: Props) {
  const [check, setCheck] = useState<Check | null | undefined>(undefined) // undefined = 読み込み中
  const [draft, setDraft] = useLocalStorageState<CheckDraft>(`checkDraft:${paperId}`, EMPTY_CHECK_DRAFT, isCheckDraft)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const uid = useId()
  const nameOf = (id: string) => concepts.find((c) => c.id === id)?.name ?? id

  useEffect(() => {
    const ctl = new AbortController()
    api.getCheck(paperId, ctl.signal).then(
      (r) => !ctl.signal.aborted && setCheck(r.check),
      (e: Error) => {
        if (isAbort(e, ctl.signal)) return
        setError(e.message)
        setCheck(null)
      },
    )
    return () => ctl.abort()
  }, [paperId])
  useEffect(() => () => request.current?.abort(), [])

  const run = async (label: string, job: (signal: AbortSignal) => Promise<Check>, onDone?: (next: Check) => void) => {
    request.current?.abort()
    const ctl = new AbortController()
    request.current = ctl
    setBusy(label)
    setError(null)
    try {
      const next = await job(ctl.signal)
      if (ctl.signal.aborted) return
      setCheck(next)
      onDone?.(next)
    } catch (e) {
      if (isAbort(e, ctl.signal)) return
      setError((e as Error).message)
    } finally {
      if (!ctl.signal.aborted) setBusy(null)
    }
  }

  const create = (force: boolean) =>
    run('問題を作っています…', (signal) =>
      api
        .createCheck(
          paperId,
          targets.map((t) => t.id),
          force,
          signal,
        )
        .then((r) => r.check),
    )

  const choices = check && draft.checkId === check.id ? draft.choices : {}
  const complete = check !== null && check !== undefined && check.items.every((it) => choices[it.id] !== undefined)
  const submit = () => {
    if (!check || !complete) return
    const answers = check.items.map((it) => ({ id: it.id, choice: choices[it.id] }))
    return run(
      '答え合わせをしています…',
      (signal) => api.answerCheck(paperId, check.id, answers, signal).then((r) => r.check),
      (next) => {
        if (next.result) onJudge(next.result.verdicts)
        setDraft(EMPTY_CHECK_DRAFT)
      },
    )
  }

  const empty = targets.length === 0
  const startButton = (label: string, force: boolean) => (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={() => create(force)}
        disabled={empty || busy !== null}
        aria-describedby={empty ? `${uid}-empty` : undefined}
      >
        {label}
      </button>
      {empty && (
        <p id={`${uid}-empty`} className="muted small">
          仕分けていない概念がありません。表示範囲を広げると、対象が増えることがあります。
        </p>
      )}
      {!empty && <p className="muted small">対象は{targets.length}概念です（必須から順に最大6つ）。</p>}
    </>
  )

  const notice = (
    <p className="muted small check-notice">
      AIが作った確認問題です。内容がおかしいと思ったら、答え合わせのあとに出る根拠で原文を確かめてください。選択肢の「分からない」は「知らない」になります。
    </p>
  )
  const errorBox = error && (
    <p className="error" role="alert">
      {error}
    </p>
  )
  const status = busy && (
    <p className="muted small" role="status">
      {busy}
    </p>
  )

  let body
  if (check === undefined) {
    body = (
      <p className="muted small" role="status">
        読み込んでいます…
      </p>
    )
  } else if (check === null) {
    body = startButton('問題に答えて仕分ける', false)
  } else if (check.submitted && check.result) {
    body = (
      <>
        <p className="small">
          <strong>
            {check.result.items.length}問中 {check.result.correct}問 正解
          </strong>
        </p>
        <ol className="check-rows">
          {check.result.items.map((it) => {
            const verdict = check.result!.verdicts[it.concept_id]
            return (
              <li key={it.id} className={`check-row ${it.is_correct ? 'ok' : 'ng'}`}>
                <p className="check-concept">
                  <strong>{nameOf(it.concept_id)}</strong>
                  {it.general_knowledge && <span className="inference-tag">一般知識による問題</span>}
                </p>
                <p className="check-question">{it.question}</p>
                <ul className="check-options">
                  {it.options.map((o, i) => (
                    <li key={i} className={`${i === it.correct_index ? 'correct' : ''} ${i === it.chosen ? 'chosen' : ''}`.trim()}>
                      {o}
                      {i === it.correct_index && <span className="badge">正解</span>}
                      {i === it.chosen && <span className="badge">あなたの答え</span>}
                    </li>
                  ))}
                </ul>
                <p className="small">{it.explanation}</p>
                {it.evidence && <EvidenceList items={[it.evidence]} />}
                <p className="small">
                  {it.dont_know ? '「分からない」を選びました。' : it.is_correct ? '正解です。' : '不正解です。'}{' '}
                  <span>判定は「{VERDICT_LABEL[verdict ?? 'unknown']}」</span>
                </p>
              </li>
            )
          })}
        </ol>
        <div className="quiz-actions">{startButton('残りの概念で問題を作る', true)}</div>
      </>
    )
  } else {
    body = (
      <>
        <ol className="check-rows">
          {check.items.map((it) => {
            const set = (n: number) => setDraft({ checkId: check.id, choices: { ...choices, [it.id]: n } })
            return (
              <li key={it.id} className="check-row">
                <fieldset className="check-fieldset" role="group" aria-labelledby={`${uid}-${it.id}`}>
                  <legend id={`${uid}-${it.id}`} className="check-question">
                    <strong>{nameOf(it.concept_id)}</strong>
                    {it.general_knowledge && <span className="inference-tag">一般知識による問題</span>}
                    <span className="check-q-text">{it.question}</span>
                  </legend>
                  {it.options.map((o, i) => (
                    <label key={i} className="check-option">
                      <input type="radio" name={`${uid}-${it.id}`} checked={choices[it.id] === i} onChange={() => set(i)} />
                      <span>{o}</span>
                    </label>
                  ))}
                </fieldset>
              </li>
            )
          })}
        </ol>
        <div className="quiz-actions">
          <button type="button" className="btn primary" onClick={submit} disabled={!complete || busy !== null}>
            答え合わせ
          </button>
        </div>
      </>
    )
  }

  return (
    <section className="concept-check sheet" aria-label="確認モード">
      <h3>確認モード</h3>
      {notice}
      {body}
      {errorBox}
      {status}
    </section>
  )
}
