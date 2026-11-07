import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Flow } from '../api'
import { JumpContext } from '../jumpContext'
import { step2, step2WithFlow } from '../test/fixtures'
import { FlowDiagram } from './FlowDiagram'
import { Step2Walkthrough } from './Step2Walkthrough'

const flow = step2WithFlow.flow!

function mockReducedMotion(reduce: boolean) {
  const mq = (query: string) =>
    ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList
  vi.spyOn(window, 'matchMedia').mockImplementation(mq)
}

const renderStep2 = (data = step2WithFlow) => {
  const jump = vi.fn()
  render(
    <JumpContext.Provider value={jump}>
      <Step2Walkthrough data={data} />
    </JumpContext.Provider>,
  )
  jump.mockClear()
  return jump
}

describe('FlowDiagram', () => {
  it('shows the note, the caption of the current frame and one labelled button per node', () => {
    render(<FlowDiagram flow={flow} total={2} index={0} onGo={() => {}} onNode={() => {}} />)
    expect(screen.getByText('AIが論文から作った図解です。根拠ページで確かめてください')).toBeInTheDocument()
    expect(screen.getByText('単語をベクトルにする')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /入力の単語.*入力.*形 n×d/ })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: /確率.*出力/ })).not.toHaveAttribute('aria-current')
  })

  it('keeps the full text of long labels in the title', () => {
    render(<FlowDiagram flow={flow} total={2} index={0} onGo={() => {}} onNode={() => {}} />)
    const long = '特徴量ベース手法とファインチューニング手法の確率'
    expect(screen.getByTitle(long)).toBeInTheDocument()
  })

  it('does not show the shape when the paper does not give one', () => {
    render(<FlowDiagram flow={flow} total={2} index={0} onGo={() => {}} onNode={() => {}} />)
    expect(screen.queryByText('null')).not.toBeInTheDocument()
    expect(screen.getAllByText(/n×d/)).toHaveLength(1)
  })

  it('draws a moving dot on active edges only, and none with reduced motion', () => {
    const { container, unmount } = render(<FlowDiagram flow={flow} total={2} index={1} onGo={() => {}} onNode={() => {}} />)
    expect(container.querySelectorAll('.flow-dot')).toHaveLength(1)
    expect(container.querySelector('.flow-edge.active')).not.toBeNull()
    unmount()
    const first = render(<FlowDiagram flow={flow} total={2} index={0} onGo={() => {}} onNode={() => {}} />)
    expect(first.container.querySelectorAll('.flow-dot')).toHaveLength(0)
    first.unmount()
    mockReducedMotion(true)
    const reduced = render(<FlowDiagram flow={flow} total={2} index={1} onGo={() => {}} onNode={() => {}} />)
    expect(reduced.container.querySelectorAll('.flow-dot')).toHaveLength(0)
    expect(reduced.container.querySelector('.flow-edge.active')).not.toBeNull() // 強調は残す
  })

  it('steps with the buttons and disables them at both ends', async () => {
    const onGo = vi.fn()
    const { rerender } = render(<FlowDiagram flow={flow} total={2} index={0} onGo={onGo} onNode={() => {}} />)
    expect(screen.getByRole('button', { name: '前へ' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(onGo).toHaveBeenCalledWith(1)
    rerender(<FlowDiagram flow={flow} total={2} index={1} onGo={onGo} onNode={() => {}} />)
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '前へ' }))
    expect(onGo).toHaveBeenLastCalledWith(0)
  })

  it('steps with the arrow keys while the diagram is focused, and not beyond the ends', async () => {
    const onGo = vi.fn()
    render(<FlowDiagram flow={flow} total={2} index={0} onGo={onGo} onNode={() => {}} />)
    const group = screen.getByRole('group', { name: /手法の流れ図/ })
    group.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onGo).not.toHaveBeenCalled()
    await userEvent.keyboard('{ArrowRight}')
    expect(onGo).toHaveBeenCalledWith(1)
  })

  it('reports the node that is clicked', async () => {
    const onNode = vi.fn()
    render(<FlowDiagram flow={flow} total={2} index={0} onGo={() => {}} onNode={onNode} />)
    await userEvent.click(screen.getByRole('button', { name: /入力の単語/ }))
    expect(onNode).toHaveBeenCalledWith(flow.nodes[0])
  })

  it('does not highlight anything for a stage without a frame', () => {
    const partial = { ...flow, frames: [flow.frames[0]] }
    const { container } = render(<FlowDiagram flow={partial} total={2} index={1} onGo={() => {}} onNode={() => {}} />)
    expect(container.querySelector('.flow-node.active')).toBeNull()
    expect(container.querySelectorAll('.flow-dot')).toHaveLength(0)
  })
})

describe('FlowDiagram robustness and details', () => {
  it('counts stages, not frames, so next works when only some stages have a frame', async () => {
    const onGo = vi.fn()
    const partial = { ...flow, frames: [flow.frames[0]] }
    render(<FlowDiagram flow={partial} total={3} index={1} onGo={onGo} onNode={() => {}} />)
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(onGo).toHaveBeenCalledWith(2)
  })

  it('shortens long edge labels (full text in the title) so they fit between columns', () => {
    const long = { ...flow, edges: [{ ...flow.edges[0], label: 'とても長い矢印のラベルです' }] }
    const { container } = render(<FlowDiagram flow={long} total={2} index={0} onGo={() => {}} onNode={() => {}} />)
    const text = container.querySelector('.flow-edge-label')!
    expect(text.querySelector('title')!.textContent).toBe('とても長い矢印のラベルです')
    const shown = [...text.childNodes].at(-1)!.textContent!
    expect(shown.length).toBeLessThanOrEqual(8)
    expect(shown.endsWith('…')).toBe(true)
  })

  it('moves focus back to the diagram when the clicked button becomes disabled', async () => {
    const { rerender } = render(<FlowDiagram flow={flow} total={2} index={0} onGo={() => {}} onNode={() => {}} />)
    const next = screen.getByRole('button', { name: '次へ' })
    await userEvent.click(next)
    expect(screen.getByRole('group', { name: /手法の流れ図/ })).toHaveFocus()
    rerender(<FlowDiagram flow={flow} total={2} index={1} onGo={() => {}} onNode={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '前へ' }))
    expect(screen.getByRole('group', { name: /手法の流れ図/ })).toHaveFocus()
  })

  it('does not crash on an old or partial flow', async () => {
    const onNode = vi.fn()
    const broken = { nodes: [{ id: 'a', label: 'A', kind: 'input', shape: null }], edges: undefined, frames: undefined } as never
    render(<FlowDiagram flow={broken} total={1} index={0} onGo={() => {}} onNode={onNode} />)
    await userEvent.click(screen.getByRole('button', { name: /A/ }))
    expect(onNode).toHaveBeenCalled()
  })
})

describe('Step2Walkthrough with a flow', () => {
  it('does not crash when a node has no evidence field', async () => {
    const jump = renderStep2({
      ...step2WithFlow,
      flow: {
        ...flow,
        nodes: [{ id: 'in', label: '入力', kind: 'input', shape: null } as never, flow.nodes[1]],
        frames: undefined as never,
      },
    })
    await userEvent.click(screen.getByRole('button', { name: '入力（入力）' }))
    expect(jump).not.toHaveBeenCalled()
  })

  it('looks as before when flow is absent', () => {
    renderStep2(step2)
    expect(screen.queryByRole('group', { name: /手法の流れ図/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/AIが論文から作った図解/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '次へ' })).not.toBeInTheDocument()
  })

  it('treats a null flow like an absent one', () => {
    renderStep2({ ...step2, flow: null })
    expect(screen.queryByRole('group', { name: /手法の流れ図/ })).not.toBeInTheDocument()
  })

  it('moves the stage and the PDF to the frame evidence when stepping the diagram', async () => {
    const jump = renderStep2()
    await userEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(screen.getByRole('heading', { name: '2. 出力' })).toBeInTheDocument()
    expect(screen.getAllByText('2 / 2')).toHaveLength(2) // 流れ図と段階の両方
    expect(jump).toHaveBeenCalledWith(6, 'softmax over vocabulary')
    await userEvent.click(screen.getByRole('button', { name: '前へ' }))
    expect(screen.getByRole('heading', { name: '1. 入力の埋め込み' })).toBeInTheDocument()
    expect(jump).toHaveBeenLastCalledWith(2, 'we embed tokens')
  })

  it('moves the diagram when the stage is changed with the existing buttons', async () => {
    renderStep2()
    await userEvent.click(screen.getByRole('button', { name: '次の段階へ' }))
    expect(screen.getByText('語彙の確率を計算する')).toBeInTheDocument()
  })

  it('jumps to the node evidence when a node is clicked', async () => {
    const jump = renderStep2()
    await userEvent.click(screen.getByRole('button', { name: /確率.*出力/ }))
    expect(jump).toHaveBeenCalledWith(5, 'we output a distribution')
  })

  it('opens on the first frame evidence', () => {
    const jump = vi.fn()
    render(
      <JumpContext.Provider value={jump}>
        <Step2Walkthrough data={step2WithFlow} />
      </JumpContext.Provider>,
    )
    expect(jump).toHaveBeenCalledTimes(1)
    expect(jump).toHaveBeenCalledWith(2, 'we embed tokens', { switchView: false })
  })
})

describe('FlowDiagram scrolling', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const wide: Flow = {
    nodes: ids.map((id, i) => ({ id, label: id, kind: i === 0 ? 'input' : i === 6 ? 'output' : 'process', shape: null, evidence: [] })),
    edges: ids.slice(1).map((id, i) => ({ from: ids[i], to: id, label: '' })),
    frames: [
      { stage_index: 0, active_nodes: ['a', 'b'], active_edges: [], caption: 'first', evidence: [] },
      { stage_index: 1, active_nodes: ['f', 'g'], active_edges: [], caption: 'last', evidence: [] },
    ],
  }

  function fakeScroller(clientWidth: number) {
    const scrollTo = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('flow-scroll') ? clientWidth : 0
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('flow-scroll') ? 1400 : 0
    })
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo
    return scrollTo
  }

  it('scrolls sideways so the nodes of the current frame are visible', () => {
    const scrollTo = fakeScroller(400)
    const { rerender } = render(<FlowDiagram flow={wide} total={2} index={0} onGo={() => {}} onNode={() => {}} />)
    expect((scrollTo.mock.lastCall![0] as { left: number }).left).toBeLessThan(100)
    rerender(<FlowDiagram flow={wide} total={2} index={1} onGo={() => {}} onNode={() => {}} />)
    const { left } = scrollTo.mock.lastCall![0] as { left: number }
    expect(left).toBeGreaterThan(800)
    expect(left).toBeLessThanOrEqual(1000)
    vi.restoreAllMocks()
  })

  it('does not scroll when the whole diagram fits', () => {
    const scrollTo = fakeScroller(2000)
    render(<FlowDiagram flow={wide} total={2} index={1} onGo={() => {}} onNode={() => {}} />)
    expect(scrollTo).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
