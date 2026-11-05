import { render, screen } from '@testing-library/react'
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
})
