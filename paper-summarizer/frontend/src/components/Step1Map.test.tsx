import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { step1 } from '../test/fixtures'
import { Step1Map } from './Step1Map'

describe('Step1Map', () => {
  it('shows the 3-line summary and reading order', () => {
    render(<Step1Map data={step1} paperId="p1" />)
    expect(screen.getByText('問題A')).toBeInTheDocument()
    expect(screen.getByText('全体像をつかむ')).toBeInTheDocument()
    expect(screen.getByText(/未チェック 3 個/)).toBeInTheDocument()
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
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    const attention = screen.getByRole('button', { name: /Attention/ })
    attention.focus()
    await userEvent.keyboard('{Enter}')
    expect(attention).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('本論文の中心')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '知らない' }))
    expect(screen.getByRole('button', { name: /Attention.*補足あり/ })).toBeInTheDocument()
  })

  it('does not crash when "null" is stored', () => {
    localStorage.setItem('knowledge:p3', 'null')
    render(<Step1Map data={step1} paperId="p3" />)
    expect(screen.getByText(/未チェック 3 個/)).toBeInTheDocument()
  })

  it('renders an empty map without a negative size', () => {
    const { container } = render(<Step1Map data={{ ...step1, concepts: [] }} paperId="p4" />)
    expect(Number(container.querySelector('svg')!.getAttribute('width'))).toBeGreaterThanOrEqual(0)
  })

  it('restores saved knowledge and tolerates broken storage', () => {
    localStorage.setItem('knowledge:p2', '{broken')
    render(<Step1Map data={step1} paperId="p2" />)
    expect(screen.getByText(/未チェック 3 個/)).toBeInTheDocument()
  })
})
