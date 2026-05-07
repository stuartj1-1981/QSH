import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HelpTip } from '../HelpTip'

describe('HelpTip', () => {
  it('renders trigger', () => {
    render(<HelpTip text="hello" />)
    expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument()
  })

  it('click opens portal popover with text and role="tooltip"', async () => {
    const { container } = render(<HelpTip text="hello" />)
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('hello')
    // Portal escape: popover must NOT be a descendant of the test render container
    expect(container.contains(tip)).toBe(false)
  })

  it('escape key closes the tooltip', async () => {
    render(<HelpTip text="hello" />)
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
    await screen.findByRole('tooltip')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('outside click closes the tooltip', async () => {
    render(<HelpTip text="hello" />)
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
    await screen.findByRole('tooltip')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('close button closes the tooltip', async () => {
    render(<HelpTip text="hello" />)
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
    await screen.findByRole('tooltip')
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('trigger receives aria-describedby only when open', async () => {
    render(<HelpTip text="hello" />)
    const trigger = screen.getByRole('button', { name: /help/i })
    expect(trigger.getAttribute('aria-describedby')).toBeNull()

    fireEvent.click(trigger)
    const tip = await screen.findByRole('tooltip')
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.getAttribute('id'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-describedby')).toBeNull()
  })

  it('renders inside overflow-x-auto ancestor (regression guard for D1 portal escape)', async () => {
    const { container } = render(
      <div style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>col<HelpTip text="zzz" /></th></tr></thead></table>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('zzz')
    // Critical: popover must escape the overflow-x-auto container by being portaled to document.body
    expect(container.contains(tip)).toBe(false)
  })
})
