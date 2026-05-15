import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CutoverGateStatusGrid } from '../forecast/CutoverGateStatusGrid'
import type { CutoverGateResult, CutoverGatesResponse } from '../../types/api'

const _gate = (overrides: Partial<CutoverGateResult> = {}): CutoverGateResult => ({
  prediction_error_p95_c: 0.5,
  prediction_error_p95_threshold_c: 1.0,
  prediction_error_gate_pass: true,
  comfort_excursions_attributable: 0,
  comfort_gate_pass: true,
  c_maturity: 0.9,
  c_maturity_threshold: 0.7,
  c_historical_min_observed: 0.6,
  c_historical_threshold: 0.5,
  composite_confidence_gate_pass: true,
  twin_drift_flagged: false,
  twin_gate_pass: true,
  all_gates_pass: true,
  cycles_holding: 168,
  cycles_required: 168,
  cutover_eligible: true,
  rationale: 'all good',
  ...overrides,
})

const _resp = (gate: CutoverGateResult): CutoverGatesResponse => ({
  window_cycles: 168,
  cycles_required: 168,
  gates: {
    rl: { _global: gate },
  },
})

describe('CutoverGateStatusGrid', () => {
  it('renders per-controller per-scope rows', () => {
    render(
      <CutoverGateStatusGrid data={_resp(_gate())} loading={false} error={null} />,
    )
    expect(screen.getByText('rl')).toBeInTheDocument()
    expect(screen.getByText('_global')).toBeInTheDocument()
  })

  it('renders ELIGIBLE badge when cutover_eligible', () => {
    render(
      <CutoverGateStatusGrid data={_resp(_gate())} loading={false} error={null} />,
    )
    expect(screen.getByText('ELIGIBLE')).toBeInTheDocument()
  })

  it('no ELIGIBLE badge when ineligible', () => {
    render(
      <CutoverGateStatusGrid
        data={_resp(_gate({ cutover_eligible: false }))}
        loading={false}
        error={null}
      />,
    )
    expect(screen.queryByText('ELIGIBLE')).toBeNull()
  })

  it('loading + error states', () => {
    const { rerender } = render(
      <CutoverGateStatusGrid data={null} loading={true} error={null} />,
    )
    expect(screen.getByText(/Loading cutover gates/)).toBeInTheDocument()
    rerender(<CutoverGateStatusGrid data={null} loading={false} error="oops" />)
    expect(screen.getByRole('alert')).toHaveTextContent('oops')
  })
})
