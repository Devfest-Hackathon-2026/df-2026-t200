import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import App from './App'
import { paper } from './test/fixtures'

vi.mock('./components/PdfViewer', async () => {
  const { forwardRef } = await import('react')
  return { PdfViewer: forwardRef(() => <div data-testid="pdf" />) }
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

  it('shows the error and retry button for a failed analysis', async () => {
    window.location.hash = `#/paper/${paper.id}`
    vi.spyOn(api, 'health').mockResolvedValue(health)
    vi.spyOn(api, 'get').mockResolvedValue({ ...paper, status: 'failed', error: '認証に失敗', results: {} })
    render(<App />)
    expect(await screen.findByText('認証に失敗')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再実行' })).toBeInTheDocument()
    expect(screen.getByText('前提知識マップは生成されていません。')).toBeInTheDocument()
  })
})
