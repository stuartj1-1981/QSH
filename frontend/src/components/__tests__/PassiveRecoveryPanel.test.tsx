import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PassiveRecoveryPanel } from '../forecast/PassiveRecoveryPanel'
import type { PassiveRecoveryState } from '../../types/api'

const _state = (c: number): PassiveRecoveryState => ({
  predicted_t_indoor: 20.5,
  composite_confidence: c,
  weather_class: ['cold', 'low', 'calm'],
  bias_correction_c: 0.1,
  prediction_target_ts: 1000,
})

describe('PassiveRecoveryPanel', () => {
  it('renders per-room rows alphabetically', () => {
    render(
      <PassiveRecoveryPanel
        recovery={{ bedroom: _state(0.8), lounge: _state(0.5) }}
      />,
    )
    const rows = screen.getAllByRole('row')
    // first row is header; data rows follow alphabetically: bedroom then lounge
    expect(rows[1]).toHaveTextContent('bedroom')
    expect(rows[2]).toHaveTextContent('lounge')
  })

  it('renders empty state when recovery undefined', () => {
    render(<PassiveRecoveryPanel recovery={undefined} />)
    expect(screen.getByText(/No passive-recovery predictions/)).toBeInTheDocument()
  })

  it('renders empty state when recovery is empty dict', () => {
    render(<PassiveRecoveryPanel recovery={{}} />)
    expect(screen.getByText(/No passive-recovery predictions/)).toBeInTheDocument()
  })

  it('confidence values rendered with 2 decimal places', () => {
    render(<PassiveRecoveryPanel recovery={{ lounge: _state(0.75) }} />)
    expect(screen.getByText('0.75')).toBeInTheDocument()
  })
})

// INSTRUCTION-227A Task 4 — display sanity envelope around predicted_t_indoor.
// Defence-in-depth permanent guard; remains in place after 227C lands.
describe('PassiveRecoveryPanel predicted_t_indoor sanity guard', () => {
  const _withTemp = (t: number): PassiveRecoveryState => ({
    ..._state(0.7),
    predicted_t_indoor: t,
  })

  it('renders a valid value as "<value>°C"', () => {
    render(<PassiveRecoveryPanel recovery={{ lounge: _withTemp(21.5) }} />)
    expect(screen.getByText('21.5°C')).toBeInTheDocument()
    expect(screen.queryByText('invalid')).toBeNull()
  })

  it('renders a value above 100 °C as "invalid" with --red text', () => {
    render(<PassiveRecoveryPanel recovery={{ lounge: _withTemp(3349.9) }} />)
    const invalid = screen.getByText('invalid')
    expect(invalid).toBeInTheDocument()
    expect(invalid.className).toContain('text-[var(--red)]')
    expect(screen.queryByText(/3349/)).toBeNull()
  })

  it('renders a value below -50 °C as "invalid"', () => {
    render(<PassiveRecoveryPanel recovery={{ lounge: _withTemp(-200) }} />)
    expect(screen.getByText('invalid')).toBeInTheDocument()
  })

  it('renders NaN as "invalid"', () => {
    render(<PassiveRecoveryPanel recovery={{ lounge: _withTemp(Number.NaN) }} />)
    expect(screen.getByText('invalid')).toBeInTheDocument()
  })

  it('renders Infinity as "invalid"', () => {
    render(<PassiveRecoveryPanel recovery={{ lounge: _withTemp(Number.POSITIVE_INFINITY) }} />)
    expect(screen.getByText('invalid')).toBeInTheDocument()
  })

  it('boundary: -50 and 100 are valid (inclusive)', () => {
    render(<PassiveRecoveryPanel recovery={{ a_low: _withTemp(-50), b_high: _withTemp(100) }} />)
    expect(screen.getByText('-50.0°C')).toBeInTheDocument()
    expect(screen.getByText('100.0°C')).toBeInTheDocument()
    expect(screen.queryByText('invalid')).toBeNull()
  })
})
