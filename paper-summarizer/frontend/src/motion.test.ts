import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollBehavior, scrollContainer, scrollWithin } from './motion'

const rect = (top: number, height: number) => ({
  top,
  height,
  bottom: top + height,
  left: 0,
  right: 0,
  width: 0,
  x: 0,
  y: top,
  toJSON: () => {},
})

function setup() {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  const inner = document.createElement('div')
  const el = document.createElement('p')
  inner.appendChild(el)
  box.appendChild(inner)
  document.body.appendChild(box)
  Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true })
  box.scrollTop = 50
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(rect(100, 200) as DOMRect)
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(400, 40) as DOMRect)
  return { box, el }
}

describe('scrollWithin', () => {
  afterEach(() => document.body.replaceChildren())

  it('finds the nearest scrolling ancestor', () => {
    const { box, el } = setup()
    expect(scrollContainer(el)).toBe(box)
    expect(scrollContainer(box)).toBeNull()
  })

  it('moves only the container to put the element at the start, center or end', () => {
    const { box, el } = setup()
    const scrollTo = vi.fn()
    box.scrollTo = scrollTo as unknown as typeof box.scrollTo
    // 要素は箱の上端から 300px 下、今のスクロール量は 50px
    scrollWithin(el, 'start', 'smooth')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 350, behavior: 'smooth' })
    scrollWithin(el, 'center')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 270, behavior: 'auto' })
    scrollWithin(el, 'end')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 190, behavior: 'auto' })
  })

  it('sets scrollTop when scrollTo is missing and never goes below 0', () => {
    const { box, el } = setup()
    Object.defineProperty(box, 'scrollTo', { value: undefined })
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(0, 10) as DOMRect)
    scrollWithin(el, 'start')
    expect(box.scrollTop).toBe(0)
  })

  it('leaves a hidden container alone instead of resetting it to the top', () => {
    const { box, el } = setup()
    Object.defineProperty(box, 'clientHeight', { value: 0 })
    const scrollTo = vi.fn()
    box.scrollTo = scrollTo as unknown as typeof box.scrollTo
    scrollWithin(el, 'end')
    expect(scrollTo).not.toHaveBeenCalled()
    expect(box.scrollTop).toBe(50)
  })

  it('does nothing without a scrolling ancestor', () => {
    const el = document.createElement('p')
    document.body.appendChild(el)
    expect(() => scrollWithin(el, 'start')).not.toThrow()
  })
})

describe('scrollBehavior', () => {
  it('avoids smooth scrolling when reduced motion is requested', () => {
    expect(scrollBehavior()).toBe('smooth')
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    expect(scrollBehavior()).toBe('auto')
  })
})
