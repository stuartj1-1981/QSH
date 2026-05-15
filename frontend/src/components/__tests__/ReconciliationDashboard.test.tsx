import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReconciliationDashboard } from '../forecast/ReconciliationDashboard'
import type { ReconciliationPoint } from '../../hooks/useReconciliation'

const LEGACY_TOKEN = 'doub' + 'ly_robust'

const _pt = (room: string, err: number): ReconciliationPoint => ({
  controller: 'rl',
  room,
  weather_class: 'cold|low|calm',
  predicted: 21,
  actual: 21 + err,
  error_c: err,
  prediction_target_ts: 1000,
  basis_summary: null,
  basis_hash: null,
})

describe('ReconciliationDashboard', () => {
  it('renders controller selector', () => {
    render(
      <ReconciliationDashboard
        points={[]}
        loading={false}
        error={null}
        selectedController="rl"
        onControllerChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('renders loading state', () => {
    render(
      <ReconciliationDashboard
        points={[]}
        loading={true}
        error={null}
        selectedController="rl"
        onControllerChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })

  it('renders error state', () => {
    render(
      <ReconciliationDashboard
        points={[]}
        loading={false}
        error="historian down"
        selectedController="rl"
        onControllerChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('historian down')
  })

  it('aggregates and renders rows', () => {
    render(
      <ReconciliationDashboard
        points={[_pt('lounge', 0.3), _pt('lounge', -0.2), _pt('bed', 0.5)]}
        loading={false}
        error={null}
        selectedController="rl"
        onControllerChange={vi.fn()}
      />,
    )
    expect(screen.getByText('lounge')).toBeInTheDocument()
    expect(screen.getByText('bed')).toBeInTheDocument()
  })

  it('selector change triggers callback', () => {
    const onChange = vi.fn()
    render(
      <ReconciliationDashboard
        points={[]}
        loading={false}
        error={null}
        selectedController="rl"
        onControllerChange={onChange}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'shoulder_controller' },
    })
    expect(onChange).toHaveBeenCalledWith('shoulder_controller')
  })

  it('legacy estimator term absent from rendered DOM', () => {
    render(
      <ReconciliationDashboard
        points={[_pt('lounge', 0.3)]}
        loading={false}
        error={null}
        selectedController="rl"
        onControllerChange={vi.fn()}
      />,
    )
    expect(screen.queryByText(new RegExp(LEGACY_TOKEN))).toBeNull()
  })
})
