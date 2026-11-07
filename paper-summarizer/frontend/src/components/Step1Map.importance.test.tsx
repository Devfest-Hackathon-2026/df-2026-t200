import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { JumpContext } from '../jumpContext'
import { step1, step1Old } from '../test/fixtures'
import { Step1Map } from './Step1Map'

const names = () =>
  within(screen.getByRole('list', { name: '前提知識の概念' }))
    .queryAllByRole('button')
    .map((b) => b.getAttribute('title'))

describe('Step1Map importance filter', () => {
  it('shows everything by default and narrows to essential or recommended', async () => {
    render(<Step1Map data={step1} paperId="p1" />)
    expect(names()).toEqual(expect.arrayContaining(['内積', '期待値', 'softmax', 'Attention']))
    expect(names()).toHaveLength(4)
    await userEvent.click(screen.getByRole('button', { name: '推奨まで' }))
    expect(names()).toHaveLength(3)
    expect(names()).not.toContain('期待値')
    await userEvent.click(screen.getByRole('button', { name: '必須だけ' }))
    expect(names().sort()).toEqual(['Attention', '内積'].sort())
    expect(screen.getByRole('button', { name: '必須だけ' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'すべて' }))
    expect(names()).toHaveLength(4)
  })

  it('remembers the chosen level for the paper', async () => {
    render(<Step1Map data={step1} paperId="pl" />)
    await userEvent.click(screen.getByRole('button', { name: '必須だけ' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('conceptLevel:pl')!)).toBe('essential'))
  })

  it('does not crash when an arrow depends only on a hidden concept', async () => {
    // softmax（推奨）は dot と expectation（発展）に依存。必須だけにすると attention→softmax の矢印の先が消える
    const { container } = render(<Step1Map data={step1} paperId="p1" />)
    const arrows = () => container.querySelectorAll('path.graph-edge').length
    expect(arrows()).toBe(3)
    await userEvent.click(screen.getByRole('button', { name: '必須だけ' }))
    expect(arrows()).toBe(0)
  })

  it('falls back to a visible concept when the selected one gets hidden', async () => {
    render(<Step1Map data={step1} paperId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /期待値/ }))
    expect(screen.getByRole('heading', { name: '期待値' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '必須だけ' }))
    expect(screen.queryByRole('heading', { name: '期待値' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /内積|Attention/ })).toBeInTheDocument()
  })

  it('marks an AI inference concept and shows no evidence chips for it', async () => {
    render(<Step1Map data={step1} paperId="p1" />)
    const node = screen.getByTitle('期待値')
    expect(node).toHaveClass('inference')
    expect(node).toHaveTextContent('AIの推定')
    await userEvent.click(node)
    const detail = screen.getByRole('heading', { name: '期待値' }).closest('.concept-detail') as HTMLElement
    expect(detail).toHaveTextContent('AIの推定')
    expect(detail).toHaveTextContent('論文には出てこない')
    expect(within(detail).queryByRole('button', { name: /p\./ })).not.toBeInTheDocument()
    expect(within(detail).queryByText('照合済み')).not.toBeInTheDocument()
  })

  it('lets a paper concept jump to the PDF from its verified evidence', async () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Step1Map data={step1} paperId="p1" />
      </JumpContext.Provider>,
    )
    await userEvent.click(screen.getByTitle('Attention'))
    const detail = screen.getByRole('heading', { name: 'Attention' }).closest('.concept-detail') as HTMLElement
    const chip = within(detail).getByRole('button', { name: /p\.4/ })
    expect(chip).toHaveTextContent('照合済み')
    await userEvent.click(chip)
    expect(jump).toHaveBeenCalledWith(4, 'attention is a weighted sum of the values')
  })

  it('flags an unverified quote on a paper concept', async () => {
    render(<Step1Map data={step1} paperId="p1" />)
    await userEvent.click(screen.getByTitle('softmax'))
    const detail = screen.getByRole('heading', { name: 'softmax' }).closest('.concept-detail') as HTMLElement
    expect(within(detail).getByRole('button', { name: /p\.3/ })).toHaveTextContent('未確認')
  })

  it('shows the importance of the selected concept', async () => {
    render(<Step1Map data={step1} paperId="p1" />)
    await userEvent.click(screen.getByTitle('Attention'))
    expect(screen.getByText('必須', { selector: '.importance-tag' })).toBeInTheDocument()
  })

  it('renders old results without importance, origin or evidence as before', async () => {
    render(<Step1Map data={step1Old} paperId="p1" />)
    expect(names()).toEqual(['内積', 'softmax'])
    expect(screen.queryByText('AIの推定')).not.toBeInTheDocument()
    // 古い結果は初出ページのチップを今までどおり出す
    expect(screen.getByRole('button', { name: '初出のp.2を開く' })).toBeInTheDocument()
    // 重要度が無い概念は「推奨」として扱い、必須だけでは隠す
    await userEvent.click(screen.getByRole('button', { name: '必須だけ' }))
    expect(names()).toEqual([])
    expect(screen.getByText(/必須の概念がありません/)).toBeInTheDocument()
  })

  it('ignores a stored level that is not valid', () => {
    localStorage.setItem('conceptLevel:pb', '"bogus"')
    render(<Step1Map data={step1} paperId="pb" />)
    expect(names()).toHaveLength(4)
  })
})
