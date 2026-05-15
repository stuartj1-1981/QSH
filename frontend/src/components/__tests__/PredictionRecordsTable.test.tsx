import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PredictionRecordsTable } from '../forecast/PredictionRecordsTable'
import type { PredictionRecord } from '../../types/api'

const _rec = (val: number): PredictionRecord => ({
  predicted_value: val,
  predicted_metric: 'shoulder_restart_bias_mult',
  prediction_target_ts: Date.now() / 1000 + 3600,
  decision_basis: { confidence: 0.8 },
  decision_taken: 'restart_bias_eager_restart',
})

describe('PredictionRecordsTable', () => {
  it('renders flat rows for nested records', () => {
    render(
      <PredictionRecordsTable
        records={{
          shoulder_controller: { _global: _rec(0.7) },
          tariff_optimiser: { _global: _rec(0.85) },
        }}
      />,
    )
    expect(screen.getByText('shoulder_controller')).toBeInTheDocument()
    expect(screen.getByText('tariff_optimiser')).toBeInTheDocument()
  })

  it('renders empty state when records undefined', () => {
    render(<PredictionRecordsTable records={undefined} />)
    expect(screen.getByText(/No in-flight prediction records/)).toBeInTheDocument()
  })

  it('expand toggle reveals decision_basis JSON', () => {
    render(
      <PredictionRecordsTable
        records={{ shoulder_controller: { _global: _rec(0.7) } }}
      />,
    )
    // The row is clickable; click to expand.
    fireEvent.click(screen.getByText('shoulder_controller'))
    expect(screen.getByText(/confidence/)).toBeInTheDocument()
  })

  it('collapsed by default', () => {
    render(
      <PredictionRecordsTable
        records={{ shoulder_controller: { _global: _rec(0.7) } }}
      />,
    )
    // Decision basis JSON should NOT be in DOM until clicked.
    expect(screen.queryByText(/confidence/)).toBeNull()
  })

  // INSTRUCTION-227A Task 3 — HelpTip is shared between empty + populated
  // branches, so the help icon must be visible regardless of records state.
  it('renders the In-Flight Prediction Records header in the empty state', () => {
    render(<PredictionRecordsTable records={undefined} />)
    expect(screen.getByText('In-Flight Prediction Records')).toBeInTheDocument()
  })

  it('renders HelpTip when records is undefined', () => {
    render(<PredictionRecordsTable records={undefined} />)
    expect(screen.getByLabelText('Help')).toBeInTheDocument()
  })

  it('renders HelpTip when records is an empty dict', () => {
    render(<PredictionRecordsTable records={{}} />)
    expect(screen.getByLabelText('Help')).toBeInTheDocument()
  })

  it('renders HelpTip when records has entries', () => {
    render(
      <PredictionRecordsTable
        records={{ shoulder_controller: { _global: _rec(0.7) } }}
      />,
    )
    expect(screen.getByLabelText('Help')).toBeInTheDocument()
  })

  it('expand/collapse regression: clicking row still toggles decision_basis JSON after Task 3 header lift', () => {
    render(
      <PredictionRecordsTable
        records={{ shoulder_controller: { _global: _rec(0.7) } }}
      />,
    )
    expect(screen.queryByText(/confidence/)).toBeNull()
    fireEvent.click(screen.getByText('shoulder_controller'))
    expect(screen.getByText(/confidence/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('shoulder_controller'))
    expect(screen.queryByText(/confidence/)).toBeNull()
  })
})
