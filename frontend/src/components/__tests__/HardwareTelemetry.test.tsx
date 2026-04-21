import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HardwareTelemetry } from '../HardwareTelemetry'

// INSTRUCTION-120C Task 7: the HardwareTelemetry COP gate consumes the
// backend null sentinel (120B). `null` → '—'. `0` is a legitimate value
// and must render as '0.0' — locks in the V3 semantic that presentation
// layers do not second-guess the data layer.

function copCell() {
  // Narrow: find the TelemetryItem wrapping the COP label, then assert
  // on its sibling value node. Broader getByText('—') would misfire if
  // any other omitted sensor produced a '—'.
  const label = screen.getByText('COP')
  const wrapper = label.closest('[class*="rounded-lg"]')
  expect(wrapper).not.toBeNull()
  return within(wrapper as HTMLElement)
}

describe('HardwareTelemetry COP null-sentinel gate', () => {
  it('renders "—" when cop is null (HP off or in sensor-loss fallback)', () => {
    render(<HardwareTelemetry cop={null} configured={new Set(['cop'])} />)
    expect(copCell().getByText('—')).toBeDefined()
  })

  it('renders the COP value when cop is a positive live number', () => {
    render(<HardwareTelemetry cop={3.6} configured={new Set(['cop'])} />)
    expect(copCell().getByText('3.6')).toBeDefined()
  })

  it('renders "0.0" when cop is 0 — legitimate value, not suppressed', () => {
    // Regression lock: a future reviewer must not re-introduce a `> 0`
    // gate on the grounds that "the old code had it." The backend has
    // already decided; the frontend obeys. Ref: INSTRUCTION-120C Task 7
    // test 7 and 120B's data-layer authority principle.
    render(<HardwareTelemetry cop={0} configured={new Set(['cop'])} />)
    expect(copCell().getByText('0.0')).toBeDefined()
  })
})
