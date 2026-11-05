import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EvidenceChip, EvidenceList, JumpContext, PageChip } from './jump'

const withJump = (ui: React.ReactNode, jump = vi.fn()) => ({
  jump,
  ...render(<JumpContext.Provider value={jump}>{ui}</JumpContext.Provider>),
})

describe('EvidenceChip', () => {
  it('jumps to page and quote on click', async () => {
    const { jump } = withJump(<EvidenceChip ev={{ page: 4, quote: 'simple', verified: true }} />)
    await userEvent.click(screen.getByRole('button', { name: /^p\.4/ }))
    expect(jump).toHaveBeenCalledWith(4, 'simple')
  })

  it('flags unverified quotes', () => {
    withJump(<EvidenceChip ev={{ page: 2, quote: 'x', verified: false }} />)
    expect(screen.getByText('未確認')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveClass('unverified')
  })
})

describe('PageChip', () => {
  it('renders nothing without page', () => {
    const { container } = withJump(<PageChip page={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('jumps without quote', async () => {
    const { jump } = withJump(<PageChip page={7} label="初出のp.7を開く" />)
    await userEvent.click(screen.getByRole('button', { name: '初出のp.7を開く' }))
    expect(jump).toHaveBeenCalledWith(7)
  })
})

describe('EvidenceList', () => {
  it('renders nothing for empty list', () => {
    const { container } = withJump(<EvidenceList items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one chip per evidence', () => {
    withJump(
      <EvidenceList
        items={[
          { page: 1, quote: 'a' },
          { page: 2, quote: 'b' },
        ]}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
