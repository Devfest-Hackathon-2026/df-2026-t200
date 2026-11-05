import type { KatexOptions } from 'katex'

/**
 * KaTeX の設定。モデルの出力（信頼できない文字列）を描画するので、安全に関わる値は既定値に頼らず明示する。
 * - trust: false … \href・\url・\htmlClass などリンクや任意属性を作るコマンドを無効にする
 * - maxSize / maxExpand … 巨大な図形やマクロの無限展開で画面が固まるのを防ぐ
 * - throwOnError: true … 描画できない式は例外にし、Tex 側で元の文字列を表示する
 */
export const KATEX_OPTIONS = {
  throwOnError: true,
  strict: 'ignore',
  output: 'htmlAndMathml',
  trust: false,
  maxSize: 10,
  maxExpand: 100,
} as const satisfies KatexOptions
