import { useEffect, useId, useState } from 'react'
import { api, type Quiz, type QuizResultItem } from '../api'
import { EvidenceChip } from '../jump'

/** 文ごとの回答の下書き。checked なら誤りだと思っている。page は入力欄の文字列（空なら未入力） */
type Draft = Record<string, { checked: boolean; page: string }>

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
      {item.altered && item.evidence && (
        <p className="quiz-evidence">
          <EvidenceChip ev={item.evidence} label={`根拠 p.${item.evidence.page} をPDFで開く`} />
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

export function QuizPanel({ paperId, pageCount }: { paperId: string; pageCount: number }) {
  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined) // undefined = 読み込み中
  const [draft, setDraft] = useState<Draft>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uid = useId()

  useEffect(() => {
    let alive = true
    api.getQuiz(paperId).then(
      (r) => alive && setQuiz(r.quiz),
      (e: Error) => {
        if (!alive) return
        setError(e.message)
        setQuiz(null)
      },
    )
    return () => {
      alive = false
    }
  }, [paperId])

  const run = async (job: () => Promise<Quiz>, reset: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const next = await job()
      setQuiz(next)
      if (reset) setDraft({})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const create = (force: boolean) => run(() => api.createQuiz(paperId, force).then((r) => r.quiz), true)

  const picks = quiz
    ? quiz.items.filter((it) => draft[it.id]?.checked).map((it) => ({ id: it.id, page: pageOf(draft[it.id].page, pageCount) }))
    : []
  const canSubmit = picks.length > 0 && picks.every((p) => p.page !== null)
  const submit = () => {
    if (!quiz || !canSubmit) return
    return run(() => api.answerQuiz(paperId, quiz.id, picks as { id: string; page: number }[]).then((r) => r.quiz), false)
  }

  const errorBox = error && (
    <p className="error" role="alert">
      {error}
    </p>
  )
  const newButton = (
    <button type="button" className="btn" onClick={() => create(true)} disabled={busy}>
      新しい問題
    </button>
  )

  if (quiz === undefined) {
    return (
      <div className="quiz">
        <ModeNotice />
        <p className="muted">読み込んでいます…</p>
      </div>
    )
  }
  if (quiz === null) {
    return (
      <div className="quiz">
        <ModeNotice />
        {errorBox}
        <button type="button" className="btn primary" onClick={() => create(false)} disabled={busy}>
          問題を作る
        </button>
        {busy && <p className="muted small">問題を作っています…</p>}
      </div>
    )
  }

  if (quiz.submitted && quiz.result) {
    const r = quiz.result
    return (
      <div className="quiz">
        <ModeNotice />
        <section aria-label="答え合わせ" className="quiz-result">
          <h3>答え合わせ</h3>
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
        {newButton}
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
          const d = draft[it.id] ?? { checked: false, page: '' }
          const set = (patch: Partial<Draft[string]>) => setDraft((cur) => ({ ...cur, [it.id]: { ...d, ...patch } }))
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
                <label className="quiz-page small">
                  根拠のページ
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={d.page}
                    onChange={(e) => set({ page: e.target.value })}
                    aria-label={`文${i + 1}の根拠ページ`}
                  />
                </label>
              )}
            </li>
          )
        })}
      </ol>
      {errorBox}
      <div className="quiz-actions">
        <button type="button" className="btn primary" onClick={submit} disabled={!canSubmit || busy}>
          答え合わせ
        </button>
        {newButton}
      </div>
    </div>
  )
}
