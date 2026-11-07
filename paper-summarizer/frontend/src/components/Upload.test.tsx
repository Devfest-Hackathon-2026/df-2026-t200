import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api, type Health } from '../api'
import { Upload } from './Upload'

const health: Health = { demo_mode: true, backend: 'demo', analysis_model: 'm', max_upload_mb: 1 }
const fileInput = (c: HTMLElement) => c.querySelector('input[type=file]') as HTMLInputElement

describe('Upload', () => {
  it('uploads a PDF without asking for a level and opens it', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const upload = vi.spyOn(api, 'upload').mockResolvedValue({ id: 'new', reused: false })
    const onOpen = vi.fn()
    const { container } = render(<Upload health={health} onOpen={onOpen} />)
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput(container), file)
    expect(upload).toHaveBeenCalledWith(file, 'ja')
    expect(onOpen).toHaveBeenCalledWith('new')
  })

  it('uploads with English output when chosen', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const upload = vi.spyOn(api, 'upload').mockResolvedValue({ id: 'new', reused: false })
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('English'))
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput(container), file)
    expect(upload).toHaveBeenCalledWith(file, 'en')
  })

  it('offers a language radio group, Japanese by default, usable with the keyboard', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    render(<Upload health={health} onOpen={vi.fn()} />)
    const group = screen.getByRole('radiogroup', { name: '解説の言語' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '日本語' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'English' })).not.toBeChecked()
    screen.getByRole('radio', { name: 'English' }).focus()
    await userEvent.keyboard(' ')
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
  })

  it('rejects files over the size limit before uploading', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const upload = vi.spyOn(api, 'upload')
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput(container), big)
    expect(screen.getByText('ファイルが大きすぎます。1MB以下のPDFを選んでください。')).toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()
  })

  it('shows server errors', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    vi.spyOn(api, 'upload').mockRejectedValue(new Error('テキストを含む PDF のみ対応しています'))
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    await userEvent.upload(fileInput(container), new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText(/テキストを含む PDF のみ対応しています/)).toBeInTheDocument()
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

  it('does not offer a level choice', () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    render(<Upload health={health} onOpen={vi.fn()} />)
    expect(screen.queryByRole('radiogroup', { name: '説明のレベル' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('大学院生向け')).not.toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: '解説の言語' })).toBeInTheDocument()
  })

  it('shows the date but no level for previous papers', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([
      { id: 'a', filename: 'a.pdf', title: 'Same Paper', status: 'done', created_at: '2026-11-05T09:30:00+00:00' },
      { id: 'b', filename: 'a.pdf', title: 'Same Paper', status: 'done', created_at: '2026-11-04T09:30:00+00:00' },
      { id: 'c', filename: 'c.pdf', title: null, status: 'failed', created_at: 'not a date' },
    ])
    render(<Upload health={health} onOpen={vi.fn()} />)
    const cards = await screen.findAllByRole('button', { name: /Same Paper/ })
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent(/11月[45]日/)
    expect(cards[0]).toHaveTextContent('続きから読む')
    expect(cards[1]).toHaveTextContent(/11月[34]日/)
    for (const c of cards) expect(c).not.toHaveTextContent(/大学院生向け|学部生向け/)
    expect(screen.getByRole('button', { name: /c\.pdf/ })).toHaveTextContent('失敗')
  })

  it('shows how far the analysis has gone on each card', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([
      { id: 'p', filename: 'draft.pdf', title: null, status: 'processing_step2', created_at: '2026-11-04T09:30:00+00:00' },
    ])
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    const card = await screen.findByRole('button', { name: /draft\.pdf/ })
    expect(card).toHaveTextContent('解析中（2/3）')
    expect(card).not.toHaveTextContent('続きから読む')
    expect(container.querySelectorAll('.progress span.filled')).toHaveLength(2)
    expect(container.querySelectorAll('.progress span')).toHaveLength(3)
    // 状態はマグネットの色でも示す（解析中は黄）
    expect(card.querySelector('.magnet')).toHaveClass('yellow')
  })

  it('adds the year only for papers from an earlier year and shows only the date', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([
      { id: 'o', filename: 'old.pdf', title: 'Old', status: 'done', created_at: '2020-03-02T09:30:00+00:00' },
    ])
    render(<Upload health={health} onOpen={vi.fn()} />)
    const card = await screen.findByRole('button', { name: /Old/ })
    expect(card).toHaveTextContent(/2020年3月2日/)
    expect(card.querySelectorAll('.paper-card-meta > span')).toHaveLength(1)
  })

  it('tells the student what to load and to check the AI against the paper', () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    render(<Upload health={health} onOpen={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 1, name: '英語の論文を1本、PDFで読み込んでください' })).toBeVisible()
    expect(screen.getByText(/AIの解説は間違えることがあるので、ページを開いて原文で確かめながら読んでください。/)).toBeInTheDocument()
  })

  it('puts the drop zone hint and a real button in the drop zone', () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    render(<Upload health={health} onOpen={vi.fn()} />)
    expect(screen.getByText('論文のPDFをドロップ、')).toBeInTheDocument()
    expect(screen.getByText('またはクリックして選択')).toBeInTheDocument()
    expect(screen.getByText('テキストを含むPDF・1MBまで')).toBeInTheDocument()
  })

  it('ignores drops while an upload is running', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    let finish: (v: { id: string; reused: boolean }) => void = () => {}
    const upload = vi.spyOn(api, 'upload').mockReturnValue(new Promise((r) => (finish = r)))
    const onOpen = vi.fn()
    render(<Upload health={health} onOpen={onOpen} />)
    const drop = screen.getByRole('button', { name: 'PDFを選択' })
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(drop, { dataTransfer: { files: [file] } })
    await screen.findByText('アップロードしています…')
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
    await screen.findByText(/失敗しました/)
    expect(fileInput(container).value).toBe('')
    await userEvent.upload(fileInput(container), file)
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
  })

  it('opens the file dialog from the button and from a click anywhere in the drop zone, once each', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([])
    const { container } = render(<Upload health={health} onOpen={vi.fn()} />)
    const click = vi.spyOn(fileInput(container), 'click')
    await userEvent.click(screen.getByRole('button', { name: 'PDFを選択' }))
    expect(click).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByText('またはクリックして選択'))
    expect(click).toHaveBeenCalledTimes(2)
  })
})
