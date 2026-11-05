import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ fail }: { fail: boolean }): React.ReactNode {
  if (fail) throw new Error('stage.figures is undefined')
  return <p>ok</p>
}

describe('ErrorBoundary', () => {
  it('shows the fallback instead of a blank screen and can try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = true
    const Child = () => <Boom fail={fail} />
    render(
      <ErrorBoundary title="このStepを表示できませんでした">
        <Child />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('このStepを表示できませんでした')
    expect(screen.getByText(/stage.figures is undefined/)).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'もう一度表示する' }))
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary title="x">
        <Boom fail={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
