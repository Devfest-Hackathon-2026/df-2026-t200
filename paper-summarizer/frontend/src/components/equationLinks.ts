import type { Concept, Equation, Step2 } from '../api'

/** Step 2 の式を指す位置。stage は段階の番号、index はその段階の中での式の番号（どちらも 0 始まり） */
export type EquationRef = { stage: number; index: number; label: string; page: number }

/** 指定した前提知識を使う式を、Step 2 に出てくる順に返す。Step 2 が無い、古い結果で concepts が無い場合は空 */
export function equationsUsing(step2: Step2 | null | undefined, conceptId: string): EquationRef[] {
  const out: EquationRef[] = []
  const stages = Array.isArray(step2?.stages) ? step2.stages : []
  stages.forEach((st, stage) => {
    const eqs = Array.isArray(st?.equations) ? st.equations : []
    eqs.forEach((eq, index) => {
      if (Array.isArray(eq?.concepts) && eq.concepts.includes(conceptId)) out.push({ stage, index, label: eq.label, page: eq.page })
    })
  })
  return out
}

/** 式の concepts を Step 1 の概念に引き当てる。Step 1 に無い id は捨てる */
export function conceptsOfEquation<C extends Pick<Concept, 'id'>>(eq: Equation, concepts: C[] | undefined): C[] {
  const ids = Array.isArray(eq.concepts) ? eq.concepts : []
  return ids.flatMap((id) => concepts?.find((c) => c.id === id) ?? [])
}
