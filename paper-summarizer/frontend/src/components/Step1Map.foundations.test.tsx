import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { step1, step1Old } from '../test/fixtures'
import { Step1Map } from './Step1Map'

describe('Step1Map foundations', () => {
  it('shows the foundations section below the concept map', () => {
    render(<Step1Map data={step1} paperId="p1" />)
    expect(screen.getByRole('heading', { name: '先に読むとよい論文' })).toBeInTheDocument()
    expect(screen.getByText('Base Paper One')).toBeInTheDocument()
  })

  it('hides the section for old results without foundations and for zero papers', () => {
    const { rerender } = render(<Step1Map data={{ ...step1Old, foundations: undefined }} paperId="p1" />)
    expect(screen.queryByRole('heading', { name: '先に読むとよい論文' })).not.toBeInTheDocument()
    rerender(<Step1Map data={{ ...step1, foundations: [] }} paperId="p1" />)
    expect(screen.queryByRole('heading', { name: '先に読むとよい論文' })).not.toBeInTheDocument()
  })
})
