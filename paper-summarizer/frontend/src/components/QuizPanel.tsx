import { useEffect, useId, useRef, useState } from 'react'
import { api, type Quiz, type QuizResultItem } from '../api'
import { EvidenceChip } from '../jump'
import { EMPTY_DRAFT, type Draft, type QuizDraft } from './quizDraft'

const isAbort = (e: unknown, signal: AbortSignal) => signal.aborted || (e instanceof DOMException && e.name === 'AbortError')

const pageOf = (raw: string, pageCount: number): number | null => {
  const n = Number(raw)
  return raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= pageCount ? n : null
}

function ModeNotice() {
  return (
    <div className="quiz-notice">
      <h2>誤り探しモード</h2>
      <p>
        このタブには、AIの解説にわざと誤りを混ぜた文が含まれます。誤りだと思う文を選び、PDFのどのページを根拠にしたかを書いて答え合わせをします。Step
        1〜3と質問には誤りを混ぜていません。
      </p>
    </div>
  )
}

function ResultRow({ item, index }: { item: QuizResultItem; index: number }) {
  const state = item.altered ? (item.selected ? 'found' : 'missed') : item.selected ? 'false-alarm' : 'ok'
  const label = { found: '誤りを見つけました', missed: '見逃した誤り', 'false-alarm': '正しい文でした', ok: '正しい文' }[state]
  return (
    <li className={`quiz-row ${state}`}>
      <div className="quiz-row-head">
        <span className="quiz-no">文{index + 1}</span>
        <span className="badge">{label}</span>
      </div>
      {item.altered && item.original != null ? (
        <div className="quiz-compare">
          <div>
            <p className="quiz-caption">誤りの文</p>
            <p>{item.text}</p>
          </div>
          <div>
            <p className="quiz-caption">元の文</p>
            <p>{item.original}</p>
          </div>
        </div>
      ) : (
        <p>{item.text}</p>
      )}
      {item.altered && item.changed && <p className="muted small">{item.changed}</p>}
      {item.altered && item.changed_from && item.changed_to && (
        <p className="small">
          {item.changed_from} → {item.changed_to}
        </p>
      )}
      {item.altered && item.evidence?.quote_span && <p className="small">原文: “{item.evidence.quote_span}”</p>}
      {item.altered && item.evidence && (
        <p className="quiz-evidence">
          <EvidenceChip
            ev={{ ...item.evidence, quote: item.evidence.quote_span ?? item.evidence.quote }}
            label={`根拠 p.${item.evidence.page} をPDFで開く`}
          />
          {item.selected && (
            <span className="small">
              あなたの根拠ページ p.{item.user_page}（{item.page_ok ? '正解' : '違います'}）
            </span>
          )}
        </p>
      )}
      {!item.altered && item.selected && item.user_page != null && <p className="muted small">あなたの根拠ページ p.{item.user_page}</p>}
    </li>
  )
}

export function QuizPanel({
  paperId,
  pageCount,
  draft: draftProp,
  onDraftChange,
}: {
  paperId: string
  pageCount: number
  draft?: QuizDraft
  onDraftChange?: (draft: QuizDraft) => void
}) {
  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined) // undefined = 読み込み中
  const [localDraft, setLocalDraft] = useState<QuizDraft>(EMPTY_DRAFT)
  const draft = draftProp ?? localDraft
  const setDraft = onDraftChange ?? setLocalDraft
  const [busy, setBusy] = useState<string | null>(null) // 実行中の操作の説明（無ければ null）
  const [error, setError] = useState<string | null>(null)
  const uid = useId()
  const request = useRef<AbortController | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const answered = useRef(false) // 回答した直後だけ、結果の見出しへフォーカスを移す

  useEffect(() => {
    const ctl = new AbortController()
    api.getQuiz(paperId, ctl.signal).then(
      (r) => !ctl.signal.aborted && setQuiz(r.quiz),
      (e: Error) => {
        if (isAbort(e, ctl.signal)) return
        setError(e.message)
        setQuiz(null)
      },
    )
    return () => ctl.abort()
  }, [paperId])

  // 作成と送信の通信は、画面を離れたら中断する
  useEffect(() => () => request.current?.abort(), [])

  useEffect(() => {
    if (answered.current && quiz?.submitted && headingRef.current) {
      headingRef.current.focus()
      answered.current = false
    }
  }, [quiz])

  const run = async (label: string, job: (signal: AbortSignal) => Promise<Quiz>, onDone?: () => void) => {
    request.current?.abort()
    const ctl = new AbortController()
    request.current = ctl
    setBusy(label)
    setError(null)
    try {
      const next = await job(ctl.signal)
      if (ctl.signal.aborted) return
      onDone?.()
      setQuiz(next)
    } catch (e) {
      if (isAbort(e, ctl.signal)) return
      setError((e as Error).message)
    } finally {
      if (!ctl.signal.aborted) setBusy(null)
    }
  }

  const create = (force: boolean) =>
    run(
      '問題を作っています…',
      (signal) => api.createQuiz(paperId, force, signal).then((r) => r.quiz),
      () => setDraft(EMPTY_DRAFT),
    )

  const entries = quiz && draft.quizId === quiz.id ? draft.entries : {}
  const picks = quiz
    ? quiz.items.filter((it) => entries[it.id]?.checked).map((it) => ({ id: it.id, page: pageOf(entries[it.id].page, pageCount) }))
    : []
  const canSubmit = picks.length > 0 && picks.every((p) => p.page !== null)
  const submit = () => {
    if (!quiz || !canSubmit) return
    return run(
      '答え合わせをしています…',
      (signal) => api.answerQuiz(paperId, quiz.id, picks as { id: string; page: number }[], signal).then((r) => r.quiz),
      () => (answered.current = true),
    )
  }

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

  if (quiz === undefined) {
    return (
      <div className="quiz">
        <ModeNotice />
        <p className="muted" role="status">
          読み込んでいます…
        </p>
      </div>
    )
  }
  if (quiz === null) {
    return (
      <div className="quiz">
        <ModeNotice />
        {errorBox}
        <div className="quiz-actions">
          <button type="button" className="btn primary" onClick={() => create(false)} disabled={busy !== null}>
            問題を作る
          </button>
        </div>
        {status}
      </div>
    )
  }

  if (quiz.submitted && quiz.result) {
    const r = quiz.result
    return (
      <div className="quiz">
        <ModeNotice />
        <section aria-labelledby={`${uid}-result`} className="quiz-result">
          <h3 id={`${uid}-result`} ref={headingRef} tabIndex={-1}>
            答え合わせ
          </h3>
          <p className="quiz-score">
            <strong>
              見つけた誤り {r.found} / {r.total_errors} 件
            </strong>
          </p>
          <p>正しい文を誤りとした数 {r.false_alarms} 件</p>
          {r.missed > 0 && <p>見逃した誤り {r.missed} 件</p>}
          <ol className="quiz-rows">
            {r.items.map((it, i) => (
              <ResultRow key={it.id} item={it} index={i} />
            ))}
          </ol>
        </section>
        {errorBox}
        <div className="quiz-actions">
          <button type="button" className="btn" onClick={() => create(true)} disabled={busy !== null}>
            新しい問題
          </button>
        </div>
        {status}
      </div>
    )
  }

  return (
    <div className="quiz">
      <ModeNotice />
      <p className="small">
        誤りがあると思う文にチェックを入れ、根拠にしたPDFのページ（1〜{pageCount}）を書いてください。誤りは1〜2文です。
      </p>
      <ol className="quiz-rows">
        {quiz.items.map((it, i) => {
          const d = entries[it.id] ?? { checked: false, page: '' }
          const set = (patch: Partial<Draft[string]>) => setDraft({ quizId: quiz.id, entries: { ...entries, [it.id]: { ...d, ...patch } } })
          const invalid = d.checked && d.page.trim() !== '' && pageOf(d.page, pageCount) === null
          return (
            <li key={it.id} className={`quiz-row ${d.checked ? 'selected' : ''}`}>
              <label className="quiz-pick">
                <input
                  type="checkbox"
                  checked={d.checked}
                  onChange={(e) => set({ checked: e.target.checked })}
                  aria-label={`文${i + 1}は誤りだと思う`}
                  aria-describedby={`${uid}-${it.id}`}
                />
                <span id={`${uid}-${it.id}`}>
                  <span className="quiz-no">文{i + 1}</span> {it.text}
                </span>
              </label>
              {d.checked && (
                <div className="quiz-page small">
                  <label>
                    根拠のページ
                    <input
                      type="number"
                      min={1}
                      max={pageCount}
                      value={d.page}
                      onChange={(e) => set({ page: e.target.value })}
                      aria-label={`文${i + 1}の根拠ページ`}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? `${uid}-${it.id}-hint` : undefined}
                    />
                  </label>
                  {invalid && (
                    <span id={`${uid}-${it.id}-hint`} className="error">
                      ページは1〜{pageCount}の整数で入力してください
                    </span>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {errorBox}
      <div className="quiz-actions">
        <button type="button" className="btn primary" onClick={submit} disabled={!canSubmit || busy !== null}>
          答え合わせ
        </button>
      </div>
      {status}
    </div>
  )
}
