import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { answer } from '../test/fixtures'
import { QaPanel } from './QaPanel'

const user = { role: 'user' as const, text: '弱点は？', created_at: '2026-11-05T00:00:00Z' }

describe('QaPanel', () => {
  it('sends a question and shows the grounded answer', async () => {
    const ask = vi.spyOn(api, 'ask').mockResolvedValue({ messages: [user, answer] })
    render(<QaPanel paperId="pid" initial={[]} currentStep={2} />)
    await userEvent.type(screen.getByLabelText('論文への質問'), '弱点は？')
    await userEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(ask).toHaveBeenCalledWith('pid', '弱点は？', 2)
    expect(await screen.findByText('論文の4ページに書かれています')).toBeInTheDocument()
    expect(screen.getByText('論文に記載')).toBeInTheDocument()
    expect(screen.getByText('確信度 高')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('回答が届きました')
  })

  it('starts collapsed with only a one-line input', () => {
    const { container } = render(<QaPanel paperId="pid" initial={[answer]} currentStep={1} />)
    expect(screen.getByPlaceholderText('質問を入力')).toBeInTheDocument()
    expect(screen.queryByText('論文の4ページに書かれています')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この手法の弱点は？' })).not.toBeInTheDocument()
    expect(container.querySelector('.qa')).not.toHaveClass('open')
    expect(screen.getByText('（1件）')).toBeInTheDocument()
  })

  it('opens when a question is sent', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue({ messages: [user, answer] })
    const { container } = render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.type(screen.getByPlaceholderText('質問を入力'), '弱点は？{Enter}')
    expect(container.querySelector('.qa')).toHaveClass('open')
    expect(await screen.findByText('論文の4ページに書かれています')).toBeInTheDocument()
  })

  it('sends a suggested question with one click', async () => {
    const ask = vi.spyOn(api, 'ask').mockResolvedValue({ messages: [user, answer] })
    render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.click(screen.getByRole('button', { name: /質問と回答/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この手法の弱点は？' }))
    expect(ask).toHaveBeenCalledWith('pid', 'この手法の弱点は？', 1)
  })

  it('restores the input and shows the error when asking fails', async () => {
    vi.spyOn(api, 'ask').mockRejectedValue(new Error('レート制限に達しました'))
    render(<QaPanel paperId="pid" initial={[]} currentStep={1} />)
    await userEvent.type(screen.getByPlaceholderText('質問を入力'), '質問A')
    await userEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('レート制限に達しました')
    expect(screen.getByPlaceholderText('質問を入力')).toHaveValue('質問A')
  })

  it('can be expanded and collapsed again', async () => {
    render(<QaPanel paperId="pid" initial={[answer]} currentStep={1} />)
    const toggle = screen.getByRole('button', { name: /質問と回答/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('log')).toHaveTextContent('論文の4ページに書かれています')
    expect(screen.getByText('論文の4ページに書かれています')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.queryByText('論文の4ページに書かれています')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('質問を入力')).toBeInTheDocument()
  })

  it('scrolls to the newest answer when the hidden panel becomes visible again', async () => {
    // 狭い画面で PDF タブを見ている間は Q&A の高さが 0。解説に戻ると高さが付く
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
    render(<QaPanel paperId="pid" initial={[user, answer]} currentStep={1} />)
    await userEvent.click(screen.getByRole('button', { name: /質問と回答/ }))
    const log = screen.getByRole('log')
    log.style.overflowY = 'auto'
    const scrollTo = vi.fn()
    log.scrollTo = scrollTo as unknown as typeof log.scrollTo
    let height = 0
    Object.defineProperty(log, 'clientHeight', { get: () => height, configurable: true })
    act(() => onResize())
    expect(scrollTo).not.toHaveBeenCalled()
    height = 200
    act(() => onResize())
    expect(scrollTo).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('renders bold and inline code in an answer as elements, and HTML as text', async () => {
    const text = '**重要** と `softmax` <img src=x onerror=alert(1)> **閉じない'
    render(<QaPanel paperId="pid" initial={[user, { ...answer, text }]} currentStep={1} />)
    await userEvent.click(screen.getByRole('button', { name: /質問と回答/ }))
    const el = document.querySelectorAll('.msg.assistant .msg-text')[0] as HTMLElement
    expect(el.querySelector('strong')).toHaveTextContent('重要')
    expect(el.querySelector('code')).toHaveTextContent('softmax')
    expect(el.querySelector('img')).toBeNull()
    expect(el).toHaveTextContent('重要 と softmax <img src=x onerror=alert(1)> **閉じない')
  })

  describe('高さを変える取っ手', () => {
    const open = async (paneHeight = 0) => {
      const view = render(<QaPanel paperId="pid" initial={[answer]} currentStep={1} />)
      if (paneHeight) Object.defineProperty(view.container, 'clientHeight', { value: paneHeight, configurable: true })
      await userEvent.click(screen.getByRole('button', { name: /質問と回答/ }))
      return view
    }
    const handle = () => screen.getByRole('separator', { name: '質問と回答の欄の高さ' })
    const now = () => Number(handle().getAttribute('aria-valuenow'))
    const maxH = () => Math.floor(window.innerHeight * 0.75)

    it('is not shown while the panel is closed', () => {
      render(<QaPanel paperId="pid" initial={[answer]} currentStep={1} />)
      expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    })

    it('is a focusable horizontal separator that announces its value and range', async () => {
      await open()
      expect(handle()).toHaveAttribute('aria-orientation', 'horizontal')
      expect(handle()).toHaveAttribute('tabindex', '0')
      expect(handle()).toHaveAttribute('aria-valuemin', '120')
      expect(Number(handle().getAttribute('aria-valuemax'))).toBe(maxH())
      expect(now()).toBeGreaterThanOrEqual(120)
      expect(handle()).toHaveAttribute('aria-controls')
    })

    it('grows with the up key and shrinks with the down key, with bigger steps for Shift', async () => {
      const { container } = await open()
      const start = now()
      fireEvent.keyDown(handle(), { key: 'ArrowUp' })
      expect(now()).toBe(start + 16)
      expect(container.querySelector<HTMLElement>('.qa')!.style.height).toBe(`${start + 16}px`)
      fireEvent.keyDown(handle(), { key: 'ArrowDown', shiftKey: true })
      expect(now()).toBe(start + 16 - 64)
      fireEvent.keyDown(handle(), { key: 'a' })
      expect(now()).toBe(start + 16 - 64)
    })

    it('stops at the minimum and the maximum', async () => {
      await open()
      fireEvent.keyDown(handle(), { key: 'Home' })
      expect(now()).toBe(120)
      fireEvent.keyDown(handle(), { key: 'ArrowDown' })
      expect(now()).toBe(120)
      fireEvent.keyDown(handle(), { key: 'End' })
      expect(now()).toBe(maxH())
      fireEvent.keyDown(handle(), { key: 'ArrowUp', shiftKey: true })
      expect(now()).toBe(maxH())
    })

    it('keeps room for the explanation above, based on the pane height', async () => {
      await open(500)
      expect(handle()).toHaveAttribute('aria-valuemax', '320')
    })

    it('follows the pointer while dragging up and down, and cleans up after', async () => {
      await open()
      const start = now()
      fireEvent.pointerDown(handle(), { clientY: 500, pointerId: 1, button: 0 })
      expect(document.body).toHaveClass('qa-resizing')
      fireEvent.pointerMove(handle(), { clientY: 450, pointerId: 1 })
      expect(now()).toBe(start + 50)
      fireEvent.pointerMove(handle(), { clientY: 520, pointerId: 2 }) // 別の指は無視
      expect(now()).toBe(start + 50)
      fireEvent.pointerUp(handle(), { pointerId: 1 })
      expect(document.body).not.toHaveClass('qa-resizing')
      fireEvent.pointerMove(handle(), { clientY: 100, pointerId: 1 })
      expect(now()).toBe(start + 50)
    })

    it('removes the dragging class when it unmounts in the middle of a drag', async () => {
      const { unmount } = await open()
      fireEvent.pointerDown(handle(), { clientY: 500, pointerId: 1, button: 0 })
      unmount()
      expect(document.body).not.toHaveClass('qa-resizing')
    })

    it('ends the drag cleanly even when releasing the pointer capture throws', async () => {
      await open()
      const el = handle()
      el.releasePointerCapture = () => {
        throw new DOMException('no capture', 'NotFoundError')
      }
      fireEvent.pointerDown(el, { clientY: 500, pointerId: 1, button: 0 })
      expect(() => fireEvent.pointerCancel(el, { pointerId: 1 })).not.toThrow()
      expect(document.body).not.toHaveClass('qa-resizing')
    })

    it('goes back to the default height on double click', async () => {
      await open()
      const start = now()
      fireEvent.keyDown(handle(), { key: 'ArrowUp', shiftKey: true })
      expect(now()).not.toBe(start)
      fireEvent.doubleClick(handle())
      expect(now()).toBe(start)
    })

    it('remembers the height and uses it the next time', async () => {
      const first = await open()
      fireEvent.keyDown(handle(), { key: 'ArrowUp', shiftKey: true })
      const changed = now()
      first.unmount()
      expect(JSON.parse(localStorage.getItem('qa-height') ?? 'null')).toBe(changed)
      await open()
      expect(now()).toBe(changed)
    })

    it('ignores a broken saved value and works without localStorage', async () => {
      localStorage.setItem('qa-height', JSON.stringify('tall'))
      await open()
      expect(now()).toBeGreaterThanOrEqual(120)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied')
      })
      const before = now()
      fireEvent.keyDown(handle(), { key: 'ArrowUp' })
      expect(now()).toBe(before + 16)
    })

    it('disappears with the panel when it is closed again', async () => {
      await open()
      await userEvent.click(screen.getByRole('button', { name: /質問と回答/ }))
      expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    })
  })
})
