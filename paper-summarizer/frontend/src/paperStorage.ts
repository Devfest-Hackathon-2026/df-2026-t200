/**
 * その論文だけに紐づく localStorage の値（知っている／知らない、確認モードと感想の下書き、表示範囲など）を消す。
 * キーは `種類:論文ID` の形なので、末尾が `:論文ID` のものを消す。
 * 論文をまたぐ値（knownConcepts・client-id・pane-split）は、この形ではないので残る。
 */
export function forgetPaperStorage(paperId: string): void {
  const suffix = `:${paperId}`
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
      (k): k is string => k !== null && k.endsWith(suffix),
    )
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* 保存領域が使えなくても、削除そのものは成功として扱う */
  }
}
