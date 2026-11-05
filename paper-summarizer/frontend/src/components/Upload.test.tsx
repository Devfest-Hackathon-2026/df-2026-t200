import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api, type Health } from '../api'
import { Upload } from './Upload'

const health: Health = { demo_mode: true, backend: 'demo', analysis_model: 'm', max_upload_mb: 1 }
const fileInput = (c: HTMLElement) => c.querySelector('input[type=file]') as HTMLInputElement

describe('Upload', () => {
  it('uploads a PDF with the selected level and opens it', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const upload = vi.spyOn(api, 'upload').mockResolvedValue({ id: 'new', reused: false })
    const onOpen = vi.fn()
    const { container } = render(<Upload health={health} onOpen={onOpen} />)
    await userEvent.click(screen.getByLabelText('大学院生向け'))
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput(container), file)
    expect(upload).toHaveBeenCalledWith(file, 'grad')
    expect(onOpen).toHaveBeenCalledWith('new')
  })

  it('rejects files over the size limit before uploading', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const upload = vi.spyOn(api, 'upload')
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput(container), big)
    expect(screen.getByText('ファイルサイズの上限は 1MB です')).toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()
  })

  it('shows server errors', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    vi.spyOn(api, 'upload').mockRejectedValue(new Error('テキストを含む PDF のみ対応しています'))
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.upload(fileInput(container), new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('テキストを含む PDF のみ対応しています')).toBeInTheDocument()
  })

  it('lists previous papers and opens one', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([{ id: 'old', filename: 'old.pdf', title: 'Old Paper', status: 'done', created_at: '' }])
    const onOpen = vi.fn()
    render(<Upload health={health} onOpen={onOpen} />)
    await userEvent.click(await screen.findByRole('button', { name: /Old Paper/ }))
    expect(onOpen).toHaveBeenCalledWith('old')
    expect(screen.getByText('完了')).toBeInTheDocument()
  })

  it('uses consecutive heading levels', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([{ id: 'old', filename: 'old.pdf', title: 'Old Paper', status: 'done', created_at: '' }])
    render(<Upload health={health} onOpen={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'これまでの論文' })).toBeInTheDocument()
  })

  it('shows the level selector before the drop zone', () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    render(<Upload health={health} onOpen={vi.fn()} />)
    const level = screen.getByRole('radiogroup', { name: '説明のレベル' })
    const drop = screen.getByRole('button', { name: /論文の PDF をドロップ/ })
    expect(level.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the date and level of previous papers', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([
      { id: 'a', filename: 'a.pdf', title: 'Same Paper', status: 'done', created_at: '2026-11-05T09:30:00+00:00', level: 'grad' },
      { id: 'b', filename: 'a.pdf', title: 'Same Paper', status: 'done', created_at: '2026-11-04T09:30:00+00:00', level: 'undergrad' },
      { id: 'c', filename: 'c.pdf', title: null, status: 'failed', created_at: 'not a date' },
    ])
    render(<Upload health={health} onOpen={vi.fn()} />)
    const a = await screen.findByRole('button', { name: /Same Paper.*大学院生向け/ })
    expect(a).toHaveTextContent(/2026\/11\/0[56]/)
    expect(screen.getByRole('button', { name: /Same Paper.*学部生向け/ })).toHaveTextContent(/2026\/11\/0[45]/)
    expect(screen.getByRole('button', { name: /c\.pdf/ })).toHaveTextContent('失敗')
  })

  it('tells that the analysis is a sample in demo mode', () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const { rerender } = render(<Upload health={health} onOpen={vi.fn()} />)
    expect(screen.getByText(/解説はサンプルです/)).toBeInTheDocument()
    rerender(<Upload health={{ ...health, demo_mode: false }} onOpen={vi.fn()} />)
    expect(screen.queryByText(/解説はサンプルです/)).not.toBeInTheDocument()
  })

  it('ignores drops while an upload is running', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    let finish: (v: { id: string; reused: boolean }) => void = () => {}
    const upload = vi.spyOn(api, 'upload').mockReturnValue(new Promise((r) => (finish = r)))
    const onOpen = vi.fn()
    render(<Upload health={health} onOpen={onOpen} />)
    const drop = screen.getByRole('button', { name: /論文の PDF をドロップ/ })
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    await screen.findByText('アップロード中…')
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    expect(upload).toHaveBeenCalledTimes(1)
    finish({ id: 'x', reused: false })
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('x'))
  })

  it('resets the file input so the same file can be chosen again after an error', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const upload = vi.spyOn(api, 'upload').mockRejectedValue(new Error('失敗しました'))
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput(container), file)
    await screen.findByText('失敗しました')
    expect(fileInput(container).value).toBe('')
    await userEvent.upload(fileInput(container), file)
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
  })

  it('opens the file dialog with Space without scrolling the page', () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    const click = vi.spyOn(fileInput(container), 'click')
    const notPrevented = fireEvent.keyDown(screen.getByRole('button', { name: /論文の PDF をドロップ/ }), { key: ' ' })
    expect(notPrevented).toBe(false)
    expect(click).toHaveBeenCalled()
  })
})
