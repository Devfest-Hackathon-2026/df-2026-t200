import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { step1 } from '../test/fixtures'
import { NARROW_NODE_W } from './conceptLayout'
import { Step1Map } from './Step1Map'

describe('Step1Map', () => {
  it('shows the 3-line summary and reading order', () => {
    render(<Step1Map data={step1} paperId="p1" />)
    expect(screen.getByText('問題A')).toBeInTheDocument()
    expect(screen.getByText('全体像をつかむ')).toBeInTheDocument()
  })

  it('keeps the full name of a long concept in the title and shrinks the label to fit the oval', () => {
    const name = '特徴量ベース手法とファインチューニング手法'
    const data = { ...step1, concepts: [{ ...step1.concepts[0], name }] }
    render(<Step1Map data={data} paperId="p1" />)
    const btn = screen.getByTitle(name)
    expect(btn).toHaveClass('xlong')
    expect(btn).toHaveTextContent(name)
  })

  it('reveals description only for unknown concepts and persists the choice', async () => {
    render(<Step1Map data={step1} paperId="p1" />)
    expect(screen.queryByText('ベクトルの積')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    expect(screen.getAllByText('ベクトルの積').length).toBeGreaterThan(0)
    expect(screen.getByText('先に押さえておく概念（1）')).toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('knowledge:p1')!)).toEqual({ dot: 'unknown' }))
  })

  it('switches the selected concept when a node is clicked', async () => {
    render(<Step1Map data={step1} paperId="p1" />)
    await userEvent.click(screen.getByText('Attention'))
    expect(screen.getByText('本論文の中心')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '知っている' }))
    expect(screen.getByText('知っている', { selector: 'small' })).toBeInTheDocument()
  })

  it('renders concepts as keyboard-operable buttons and keeps the SVG for edges only', async () => {
    const { container } = render(<Step1Map data={step1} paperId="p1" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('svg [role=img], svg foreignObject')).toBeNull()
    const list = screen.getByRole('list', { name: '前提知識の概念' })
    expect(within(list).getAllByRole('button')).toHaveLength(4)
    const attention = screen.getByRole('button', { name: /Attention/ })
    attention.focus()
    await userEvent.keyboard('{Enter}')
    expect(attention).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('本論文の中心')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    expect(screen.getByRole('button', { name: /Attention.*知らない/ })).toBeInTheDocument()
  })

  it('does not crash when "null" is stored', () => {
    localStorage.setItem('knowledge:p3', 'null')
    render(<Step1Map data={step1} paperId="p3" />)
  })

  it('renders an empty map without a negative size', () => {
    const { container } = render(<Step1Map data={{ ...step1, concepts: [] }} paperId="p4" />)
    expect(Number(container.querySelector('svg')!.getAttribute('width'))).toBeGreaterThanOrEqual(0)
  })

  it('restores saved knowledge and tolerates broken storage', () => {
    localStorage.setItem('knowledge:p2', '{broken')
    render(<Step1Map data={step1} paperId="p2" />)
  })

  it('stacks the map vertically when the explanation pane is too narrow for the wide map', () => {
    // 広い画面でも、境目を動かして解説側を狭めると横並びの図が入らなくなる
    let onResize = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          onResize = cb
        }
        observe() {}
        disconnect() {}
      },
    )
    const { container } = render(<Step1Map data={step1} paperId="p1" />)
    const box = container.querySelector<HTMLElement>('.graph-scroll')!
    const items = () => [...container.querySelectorAll<HTMLElement>('.graph-nodes li')]
    let width = 2000
    Object.defineProperty(box, 'clientWidth', { get: () => width, configurable: true })
    act(() => onResize())
    expect(items()[0].style.width).not.toBe(`${NARROW_NODE_W}px`)
    width = 340
    act(() => onResize())
    expect(items()[0].style.width).toBe(`${NARROW_NODE_W}px`)
    // 非表示（幅 0）のときは判定を変えない
    width = 0
    act(() => onResize())
    expect(items()[0].style.width).toBe(`${NARROW_NODE_W}px`)
    vi.unstubAllGlobals()
  })

  it('stacks the map vertically on narrow screens and follows width changes', () => {
    let listener = () => {}
    const mq = { matches: true, addEventListener: (_: string, l: () => void) => (listener = l), removeEventListener: vi.fn() }
    vi.spyOn(window, 'matchMedia').mockReturnValue(mq as unknown as MediaQueryList)
    const { container } = render(<Step1Map data={step1} paperId="p1" />)
    const items = () => [...container.querySelectorAll<HTMLElement>('.graph-nodes li')]
    expect(items()[0].style.width).toBe(`${NARROW_NODE_W}px`)
    const tops = items().map((li) => parseFloat(li.style.top))
    expect(tops[tops.length - 1]).toBeGreaterThan(tops[0])
    mq.matches = false
    act(() => listener())
    expect(items()[0].style.width).not.toBe(`${NARROW_NODE_W}px`)
  })
})
