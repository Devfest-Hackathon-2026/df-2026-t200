import type { Concept } from '../api'
import { importanceOf } from './conceptLayout'

/** 1回の確認で問題にする概念の上限（サーバーの上限と同じ） */
export const MAX_CHECK_CONCEPTS = 6

const ORDER = { essential: 0, recommended: 1, advanced: 2 } as const

/**
 * 確認モードの対象。表示範囲の概念のうち、まだ仕分けていないものを、必須・推奨・発展の順（同じ重要度の中では元の並び）に最大6つ。
 * 元の配列は変えない。
 */
export function pickCheckTargets(concepts: Concept[], knowledge: Record<string, 'known' | 'unknown'>): Concept[] {
  return concepts
    .filter((c) => !knowledge[c.id])
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ORDER[importanceOf(a.c)] - ORDER[importanceOf(b.c)] || a.i - b.i)
    .slice(0, MAX_CHECK_CONCEPTS)
    .map(({ c }) => c)
}

/** 回答の下書き。どの問題の下書きか（問題が新しくなったら使わない）と、問題 id → 選んだ選択肢の番号 */
export type CheckDraft = { checkId: string | null; choices: Record<string, number> }
export const EMPTY_CHECK_DRAFT: CheckDraft = { checkId: null, choices: {} }

export const isCheckDraft = (v: unknown): v is CheckDraft =>
  typeof v === 'object' &&
  v !== null &&
  (typeof (v as CheckDraft).checkId === 'string' || (v as CheckDraft).checkId === null) &&
  typeof (v as CheckDraft).choices === 'object' &&
  (v as CheckDraft).choices !== null &&
  Object.values((v as CheckDraft).choices).every((n) => Number.isInteger(n))
