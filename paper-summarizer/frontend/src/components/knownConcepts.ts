import type { Concept } from '../api'

/** 論文をまたいで覚える「知っている」概念の localStorage キー */
export const KNOWN_CONCEPTS_KEY = 'knownConcepts'

/** 覚える記録の上限。超えたら古いものから捨てる */
export const MEMORY_LIMIT = 500

/** 覚える 1 件分。名前を正規化し、全体・括弧の外・括弧の中に分けたもの */
export type NameRecord = { full: string; outer: string; inner: string[] }

/** 保存値の形の確認。古い形(文字列の配列)や壊れた値は合わないので、読み込み側で空として扱われる */
export const isMemory = (v: unknown): v is NameRecord[] =>
  Array.isArray(v) &&
  v.every(
    (r) =>
      typeof r === 'object' &&
      r !== null &&
      typeof r.full === 'string' &&
      typeof r.outer === 'string' &&
      Array.isArray(r.inner) &&
      r.inner.every((x: unknown) => typeof x === 'string'),
  )

/** 小文字化と、記号・空白の除去だけ。全角英数を半角にそろえるため NFKC にしてから文字と数字以外を落とす */
export const normalizeName = (name: string): string =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

const BRACKETS = /[(（]([^()（）]*)[)）]/g
/** 1 文字の名前は偶然の一致が多いので使わない */
const MIN_LEN = 2

/** 名前を {全体, 括弧の外, 括弧の中} に分ける。使えない名前は null。括弧が無ければ 括弧の外 = 全体 */
export function nameRecord(name: string): NameRecord | null {
  const full = normalizeName(name)
  if (full.length < MIN_LEN) return null
  const outer = normalizeName(name.replace(BRACKETS, ' '))
  const inner = [...new Set([...name.matchAll(BRACKETS)].map((m) => normalizeName(m[1])).filter((s) => s.length >= MIN_LEN))]
  return { full, outer: outer.length >= MIN_LEN ? outer : '', inner }
}

const innerHits = (a: NameRecord, b: NameRecord) => a.inner.some((i) => i === b.full || (b.outer !== '' && i === b.outer))

/**
 * 同じ概念とみなす規則。「自己注意機構 (Self-Attention)」のように日本語の後ろに括弧で英語名が付く形が多い。
 * (a) 名前全体が一致
 * (b) 両方に括弧の外があり、括弧の外どうしが一致
 * (c) 片方の括弧の中が、もう片方の名前全体か括弧の外と一致(日本語名+英語名と、英語名だけの論文をつなぐ)
 * 括弧の中どうしだけの一致は使わない。「Attention (Self-Attention)」と「Multi-Head Attention (Self-Attention)」のような
 * 別の概念を取り違えるため。
 */
const same = (a: NameRecord, b: NameRecord): boolean =>
  a.full === b.full || (a.outer !== '' && a.outer === b.outer) || innerHits(a, b) || innerHits(b, a)

/** 「知っている」にした名前を覚える。同じ名前全体の記録は新しいものに置き換え、上限を超えたら古いものから捨てる。元の配列は変えない */
export function rememberKnown(memory: NameRecord[], name: string): NameRecord[] {
  const rec = nameRecord(name)
  if (!rec) return memory
  return [...memory.filter((r) => r.full !== rec.full), rec].slice(-MEMORY_LIMIT)
}

/**
 * 「知らない」にした名前を覚えから外す(次の論文へ古い印を持ち越さないため)。
 * 外すのは名前全体が同じ記録だけ。括弧の外や中が共通なだけの別の概念は、そのまま残す。
 */
export function forget(memory: NameRecord[], name: string): NameRecord[] {
  const rec = nameRecord(name)
  if (!rec) return memory
  return memory.filter((r) => r.full !== rec.full)
}

/** 覚えている名前と一致する概念の id */
export function rememberedIds(concepts: Concept[], memory: NameRecord[]): string[] {
  return concepts
    .filter((c) => {
      const rec = nameRecord(c.name)
      return rec !== null && memory.some((r) => same(rec, r))
    })
    .map((c) => c.id)
}
