import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import App from './App'
import { paper } from './test/fixtures'

const viewer = vi.hoisted(() => ({ jumpTo: vi.fn(), clearHighlight: vi.fn() }))
vi.mock('./components/PdfViewer', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    PdfViewer: forwardRef((_props, ref) => {
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
    expect(screen.getByText('英語論文を、3つのステップで自分のものに。')).toBeInTheDocument()
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

  it('clears the PDF highlight when switching steps', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue(paper)
    render(<App />)
    await screen.findByText('問題A')
    viewer.clearHighlight.mockClear()
    await userEvent.click(screen.getByRole('tab', { name: /コアロジック/ }))
    expect(viewer.clearHighlight).toHaveBeenCalledTimes(1)
    expect(viewer.jumpTo).not.toHaveBeenCalled()
  })

  it('shows the error and retry button for a failed analysis', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue({ ...paper, status: 'failed', error: '認証に失敗', results: {} })
    render(<App />)
    expect(await screen.findByText('認証に失敗')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再実行' })).toBeInTheDocument()
    expect(screen.getByText('前提知識マップは生成されていません。')).toBeInTheDocument()
  })

  it('retries the analysis and refetches instead of reloading', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    const failed = { ...paper, status: 'failed' as const, error: '認証に失敗', results: {} }
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(failed).mockResolvedValue(paper)
    const retry = vi.spyOn(api, 'retry').mockResolvedValue({ ok: true })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '再実行' }))
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
    await userEvent.click(await screen.findByRole('button', { name: '再実行' }))
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
