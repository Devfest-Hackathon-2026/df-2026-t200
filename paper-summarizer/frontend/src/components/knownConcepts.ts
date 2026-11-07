import type { Concept } from '../api'

/** 論文をまたいで覚える「知っている」概念の localStorage キー。値は名前の照合キーの配列 */
export const KNOWN_CONCEPTS_KEY = 'knownConcepts'

export const isKeyList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** 小文字化と、記号・空白の除去だけ。全角英数を半角にそろえるため NFKC にしてから文字と数字以外を落とす */
export const normalizeName = (name: string): string =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

const BRACKETS = /[(（]([^()（）]*)[)）]/g

/**
 * 名前の照合キー。「自己注意機構 (Self-Attention)」のように日本語の後ろに括弧で英語名が付く形が多いので、
 * 名前全体・括弧の外・括弧の中の 3 通りを作り、どれか 1 つでも一致すれば同じ概念として扱う。
 * 1 文字のキーは偶然の一致が多いので使わない。
 */
export function nameKeys(name: string): string[] {
  const inner = [...name.matchAll(BRACKETS)].map((m) => m[1])
  const outer = name.replace(BRACKETS, ' ')
  return [...new Set([name, outer, ...inner].map(normalizeName).filter((k) => k.length >= 2))]
}

/** 「知っている」にした名前を覚える。元の配列は変えない */
export const rememberKnown = (memory: string[], name: string): string[] => [...new Set([...memory, ...nameKeys(name)])]

/** 「知らない」にした名前を覚えから外す（後から考えを変えたときに、次の論文へ古い印を持ち越さないため） */
export const forget = (memory: string[], name: string): string[] => {
  const drop = new Set(nameKeys(name))
  return memory.filter((k) => !drop.has(k))
}

/** 覚えている名前と一致する概念の id */
export function rememberedIds(concepts: Concept[], memory: string[]): string[] {
  const set = new Set(memory)
  return concepts.filter((c) => nameKeys(c.name).some((k) => set.has(k))).map((c) => c.id)
}
