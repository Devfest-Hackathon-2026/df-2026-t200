import { useLayoutEffect, useState } from 'react'

/**
 * 要素の内側の幅（clientWidth）を測る。返す ref コールバックを要素に付けると、要素が現れた時点から測り始める
 * （読み込み後に初めて描かれる要素でも測れる）。描画前に一度測るので、最初の表示から幅に合った組み方になる。
 * 表示されていない（幅 0）間は最後に測った値のままにする。まだ測れていなければ width は null
 */
export function useElementWidth<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(element)
    return () => ro.disconnect()
  }, [element])
  return { ref: setElement, element, width }
}
