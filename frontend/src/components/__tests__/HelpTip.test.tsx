import { describe, it, expect, vi } from 'vitest'
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

  it('solar-tooltip regression: popover stays inside the viewport when the trigger sits above the legacy flip threshold', async () => {
    // Original defect (INSTRUCTION-253): the legacy VERTICAL_FLIP_THRESHOLD=160 px
    // branch placed the popover above whenever rect.top >= 160. For the long
    // "Solar production capacity (observed)" tooltip (~230 px tall) at rect.top
    // around 180 px, that produced top = -50 px and overflowed the viewport.
    // Here we synthesise the same conditions in JSDOM.

    // Tight viewport so the popover is taller than the space above.
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 400, writable: true, configurable: true })

    // Trigger sits at viewport y=180. Above the legacy 160 px threshold.
    const triggerTop = 180
    const triggerBottom = 194
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: triggerTop, bottom: triggerBottom, left: 500, right: 514,
      width: 14, height: 14, x: 500, y: triggerTop, toJSON: () => ({}),
    } as DOMRect)

    // Popover measured at 300 px tall (longer than the space above).
    const popHeight = 300
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => popHeight })

    render(<HelpTip text="solar regression" />)
    fireEvent.click(screen.getByRole('button', { name: /help/i }))
    const tip = await screen.findByRole('tooltip')

    const top = parseFloat((tip as HTMLElement).style.top)
    // Must be inside [VIEWPORT_MARGIN, innerHeight - VIEWPORT_MARGIN - popHeight].
    expect(top).toBeGreaterThanOrEqual(8)
    expect(top).toBeLessThanOrEqual(400 - 8 - popHeight)

    vi.restoreAllMocks()
  })
})
