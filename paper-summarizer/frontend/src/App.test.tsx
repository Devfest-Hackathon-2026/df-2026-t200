import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import App from './App'
import { paper } from './test/fixtures'

const viewer = vi.hoisted(() => ({ jumpTo: vi.fn(), clearHighlight: vi.fn() }))
// lazy な PdfViewer がまだ読み込み中（マウント前）の状態を作るための関門
const gate = vi.hoisted(() => ({ open: true, promise: Promise.resolve(), release: () => {} }))
vi.mock('./components/PdfViewer', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    PdfViewer: forwardRef((_props, ref) => {
      if (!gate.open) throw gate.promise
      useImperativeHandle(ref, () => viewer)
      return <div data-testid="pdf" />
    }),
  }
})

const health = { demo_mode: true, backend: 'demo', analysis_model: 'm', max_upload_mb: 20 }

describe('App', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('shows the upload page and demo badge', async () => {
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'list').mockResolvedValue([])
    render(<App />)
    expect(await screen.findByText('デモモード（サンプルデータ）')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '英語の論文を1本、PDFで読み込んでください' })).toBeInTheDocument()
  })

  it('shows a banner when the backend is unreachable', async () => {
    vi.spyOn(api, 'health').mockRejectedValue(new Error('down'))
    vi.spyOn(api, 'list').mockResolvedValue([])
    render(<App />)
    expect(await screen.findByText(/バックエンド.*に接続できません/)).toBeInTheDocument()
  })

  it('opens a paper from the URL hash and shows Step 1', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue({ ...health, demo_mode: false })
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    render(<App />)
    expect(await screen.findByText('Sample Paper')).toBeInTheDocument()
    expect(screen.getByText('Gemini: m')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /前提知識マップ/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('問題A')).toBeInTheDocument()
  })

  it('has a step tablist with a labelled tabpanel and arrow-key navigation', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    render(<App />)
    await screen.findByText('問題A')
    expect(screen.getByRole('heading', { level: 1, name: 'Sample Paper' })).toBeInTheDocument()
    const step1Tab = screen.getByRole('tab', { name: /前提知識マップ/ })
    const panel = screen.getByRole('tabpanel', { name: /前提知識マップ/ })
    expect(step1Tab).toHaveAttribute('aria-controls', panel.id)
    expect(step1Tab).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: /手法の流れと図表/ })).toHaveAttribute('tabindex', '-1')
    step1Tab.focus()
    await userEvent.keyboard('{ArrowRight}')
    const step2Tab = screen.getByRole('tab', { name: /手法の流れと図表/ })
    expect(step2Tab).toHaveAttribute('aria-selected', 'true')
    expect(step2Tab).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /批判的思考/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(step1Tab).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /批判的思考/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Home}')
    expect(step1Tab).toHaveFocus()
  })

  it('clears the previous highlight and then highlights the first Step 2 stage when Step 2 opens', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    render(<App />)
    await screen.findByText('問題A')
    viewer.clearHighlight.mockClear()
    viewer.jumpTo.mockClear()
    await userEvent.click(screen.getByRole('tab', { name: /手法の流れと図表/ }))
    expect(viewer.clearHighlight).toHaveBeenCalledTimes(1)
    expect(viewer.jumpTo).toHaveBeenCalledWith(2, 'we embed tokens')
    expect(viewer.clearHighlight.mock.invocationCallOrder[0]).toBeLessThan(viewer.jumpTo.mock.invocationCallOrder[0])
  })

  it('keeps the explanation in view on narrow screens when Step 2 highlights its first stage', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    const { container } = render(<App />)
    await screen.findByText('問題A')
    viewer.jumpTo.mockClear()
    await userEvent.click(screen.getByRole('tab', { name: /手法の流れと図表/ }))
    // PDF の移動は予約されるが、画面は解説のまま（学生が PDF タブを開いたときに強調が見える）
    expect(viewer.jumpTo).toHaveBeenCalledWith(2, 'we embed tokens')
    expect(container.querySelector('.workspace')).toHaveClass('show-explain')
  })

  it('switches between the PDF and the explanation on narrow screens', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    const { container } = render(<App />)
    await screen.findByText('問題A')
    const workspace = container.querySelector('.workspace')!
    expect(workspace).toHaveClass('show-explain')
    expect(screen.getByRole('tab', { name: '解説' })).toHaveAttribute('aria-selected', 'true')
    // 各タブは自分のパネルを指し、パネルはタブで名前が付く
    for (const [name, panelName] of [
      ['解説', '解説'],
      ['PDF', 'PDF'],
    ]) {
      const tab = screen.getByRole('tab', { name })
      const panel = document.getElementById(tab.getAttribute('aria-controls')!)!
      expect(panel).toHaveAttribute('role', 'tabpanel')
      expect(panel).toHaveAttribute('aria-labelledby', tab.id)
      expect(panel).toHaveAccessibleName(panelName)
    }
    // tablist は nav ではなく、nav の中の div に付ける
    for (const list of screen.getAllByRole('tablist')) {
      expect(list.tagName).toBe('DIV')
      expect(list.parentElement!.tagName).toBe('NAV')
    }
    await userEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(workspace).toHaveClass('show-pdf')
    expect(screen.getByRole('tab', { name: 'PDF' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the PDF before jumping to evidence on narrow screens', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    const { container } = render(<App />)
    await screen.findByText('問題A')
    viewer.jumpTo.mockClear()
    await userEvent.click(screen.getByRole('button', { name: '初出のp.2を開く' }))
    expect(container.querySelector('.workspace')).toHaveClass('show-pdf')
    await waitFor(() => expect(viewer.jumpTo).toHaveBeenCalledWith(2, undefined))
  })

  it('delivers a jump requested before the lazy PDF viewer mounted', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    gate.open = false
    gate.promise = new Promise<void>((resolve) => {
      gate.release = () => {
        gate.open = true
        resolve()
      }
    })
    render(<App />)
    await screen.findByText('問題A')
    viewer.jumpTo.mockClear()
    await userEvent.click(screen.getByRole('button', { name: '初出のp.2を開く' }))
    expect(viewer.jumpTo).not.toHaveBeenCalled()
    gate.release()
    await waitFor(() => expect(viewer.jumpTo).toHaveBeenCalledWith(2, undefined))
  })

  it('jumps right away on wide screens', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    const { container } = render(<App />)
    await screen.findByText('問題A')
    viewer.jumpTo.mockClear()
    await userEvent.click(screen.getByRole('button', { name: '初出のp.2を開く' }))
    expect(viewer.jumpTo).toHaveBeenCalledWith(2, undefined)
    expect(container.querySelector('.workspace')).toHaveClass('show-explain')
  })

  it('lets the student resize the panes and remembers the width', async () => {
    localStorage.setItem('pane-split', '40')
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    const { container, unmount } = render(<App />)
    await screen.findByText('問題A')
    const workspace = container.querySelector<HTMLElement>('.workspace')!
    const sep = screen.getByRole('separator', { name: 'PDFと解説の幅' })
    expect(sep).toHaveAttribute('aria-valuenow', '40')
    expect(workspace.style.getPropertyValue('--split')).toBe('40%')
    sep.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(workspace.style.getPropertyValue('--split')).toBe('42%')
    unmount()
    expect(JSON.parse(localStorage.getItem('pane-split')!)).toBe(42)
    localStorage.removeItem('pane-split')
  })

  it('keeps both panes readable on a narrow window without forgetting the saved width', async () => {
    localStorage.setItem('pane-split', '75')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('workspace') ? 901 : 0
    })
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    const { container } = render(<App />)
    await screen.findByText('問題A')
    const sep = screen.getByRole('separator', { name: 'PDFと解説の幅' })
    expect(sep).toHaveAttribute('aria-valuenow', '57.1')
    expect(sep).toHaveAttribute('aria-valuemax', '57.1')
    expect(container.querySelector<HTMLElement>('.workspace')!.style.getPropertyValue('--split')).toBe('57.1%')
    // 保存した値は変えない（広い画面に戻せば 75% で開く）
    expect(JSON.parse(localStorage.getItem('pane-split')!)).toBe(75)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.removeItem('pane-split')
  })

  it('falls back to an even split when the saved width is out of range', async () => {
    localStorage.setItem('pane-split', '5')
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    render(<App />)
    await screen.findByText('問題A')
    expect(screen.getByRole('separator', { name: 'PDFと解説の幅' })).toHaveAttribute('aria-valuenow', '50')
    localStorage.removeItem('pane-split')
  })

  it('keeps the app usable when one step has a broken result', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(api, 'health').mockResolvedValue(health)
    const broken = { overview: 'x', stages: [{ title: 't', explanation: 'e', evidence: [], equations: [] }] }
    vi.spyOn(api, 'get').mockResolvedValue({ ...paper, results: { ...paper.results, step2: broken as never } })
    render(<App />)
    await screen.findByText('問題A')
    await userEvent.click(screen.getByRole('tab', { name: /手法の流れと図表/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('このStepを表示できませんでした')
    await userEvent.click(screen.getByRole('tab', { name: /前提知識/ }))
    expect(screen.getByText('問題A')).toBeInTheDocument()
  })

  it('shows the error and retry button for a failed analysis', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue({ ...paper, status: 'failed', error: '認証に失敗', results: {} })
    render(<App />)
    expect(await screen.findByText('認証に失敗')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解析をやり直す' })).toBeInTheDocument()
    expect(screen.getByText('前提知識マップを作成できませんでした。')).toBeInTheDocument()
  })

  it('retries the analysis and refetches instead of reloading', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    const failed = { ...paper, status: 'failed' as const, error: '認証に失敗', results: {} }
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(failed).mockResolvedValue(paper)
    const retry = vi.spyOn(api, 'retry').mockResolvedValue({ ok: true })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '解析をやり直す' }))
    expect(retry).toHaveBeenCalledWith(paper.id)
    expect(await screen.findByText('問題A')).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('shows why the retry failed', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue({ ...paper, status: 'failed', error: '認証に失敗', results: {} })
    vi.spyOn(api, 'retry').mockRejectedValue(new Error('再実行できません'))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '解析をやり直す' }))
    expect(await screen.findByText(/再実行できません/)).toBeInTheDocument()
  })

  it('keeps the paper on screen and shows a banner when polling fails', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ ...paper, status: 'processing_step3' })
      .mockRejectedValue(new Error('Failed to fetch'))
    render(<App />)
    expect(await screen.findByText('問題A')).toBeInTheDocument()
    expect(await screen.findByText(/Failed to fetch/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('問題A')).toBeInTheDocument()
  })

  it('offers a way back to the upload page when the paper does not exist', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'list').mockResolvedValue([])
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('論文が見つかりません', 404))
    render(<App />)
    expect(await screen.findByText('論文が見つかりません')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'アップロード画面へ戻る' }))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
  })
})
