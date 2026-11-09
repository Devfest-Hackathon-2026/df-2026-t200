import { useEffect, useState } from 'react'
import type { Progress, StepProgress } from '../api'
import { stepLabel, stepLine } from './progressText'

const KEYS = ['step1', 'step2', 'step3'] as const

/** 経過時間を進める対象か（そのサーバーで走っていて、まだ終わっていない Step） */
const ticking = (s: StepProgress) => s.elapsed !== undefined && s.phase !== 'done'

/**
 * 解析中の進み具合。何をしているか、書いた文字数、経過時間を Step ごとに出す（Step 2・3 は同時に走るので両方）。
 * 経過時間は、知らせが届いた時点の値から画面側で毎秒進める。
 * 読み上げ（role=status）には数字を入れず、段階が変わったときだけ変わる文にする。数字つきの行は読み上げ対象から外す。
 */
export function AnalysisProgress({ progress }: { progress: Progress | null | undefined }) {
  // 最後の知らせから何秒たったか。progress が新しくなったら 0 に戻し、経過時間の起点をそろえ直す
  const [seen, setSeen] = useState(progress)
  const [sinceReceived, setSinceReceived] = useState(0)
  if (seen !== progress) {
    setSeen(progress)
    setSinceReceived(0)
  }
  const anyTicking = !!progress && KEYS.some((k) => progress[k] && ticking(progress[k]))
  useEffect(() => {
    if (!anyTicking) return
    const timer = window.setInterval(() => setSinceReceived((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [anyTicking])

  const steps = KEYS.flatMap((k, i) => (progress?.[k] ? [{ n: i + 1, step: progress[k] as StepProgress }] : []))
  if (steps.length === 0) return null
  return (
    <div className="analysis-progress">
      <span className="sr-only" role="status">
        {steps.map(({ n, step }) => stepLabel(n, step.phase)).join('、')}
      </span>
      <ul className="progress-steps" aria-hidden="true">
        {steps.map(({ n, step }) => (
          <li key={n} className={`progress-step phase-${step.phase}`}>
            {stepLine(n, step, step.elapsed === undefined ? undefined : step.elapsed + (ticking(step) ? sinceReceived : 0))}
          </li>
        ))}
      </ul>
    </div>
  )
}
