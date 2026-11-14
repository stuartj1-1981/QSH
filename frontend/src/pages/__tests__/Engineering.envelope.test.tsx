import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Engineering } from '../Engineering'
import type { EfficiencyEnvelopeResponse, SysidResponse } from '../../types/api'

// INSTRUCTION-620B — the Engineering page shows the efficiency envelope card
// below the house heat loss card, and passes it the live outdoor temperature.

const ENVELOPE: EfficiencyEnvelopeResponse = {
  schema_version: 1,
  install_class: 'metered',
  power_entity: 'sensor.hp_power',
  heat_entity: 'sensor.hp_heat',
  cop_entity: '',
  samples: 42,
  refused: {},
  reference_input_kw: 1.2,
  s1: [],
  s1_mature: false,
  s2: [
    { flow_c: 32, outdoor_c: 3, cop: 3.9, n: 70, mature: true },
    { flow_c: 32, outdoor_c: 6, cop: 4.4, n: 90, mature: true },
  ],
  s2_mature: false,
  floor: { mature: false, floor_fraction: null, floor_kw_el: null, floor_penalty: null },
  ceiling: [],
  updated_at: 1794330827,
}

const SYSID: SysidResponse = {
  rooms: {
    lounge: {
      u_kw_per_c: 0.234,
      c_kwh_per_c: 1.42,
      u_observations: 87,
      c_observations: 4,
      c_source: 'PC',
      pc_fits: 12,
      solar_gain: 0.012,
      confidence: 'medium',
      u_prior_kw_per_c: 0.117,
      u_vs_design: 2.0,
    },
  },
  installation_heat_loss: {
    u_learned_kw_per_c: 0.234,
    u_design_kw_per_c: 0.117,
    ratio: 2.0,
    design_loss_kw: 2.808,
    design_delta_c: 24.0,
    learned_loss_at_design_kw: 5.6,
    rooms_total: 1,
    rooms_learned: 1,
    rooms_above_cap: 0,
    cap_mult: 2.5,
  },
}

vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({ data: { status: { outdoor_temp: 4.0 } }, isConnected: true }),
}))

vi.mock('../../hooks/useSysid', () => ({
  useSysid: () => ({ data: SYSID, error: null }),
  useSysidRoom: () => ({ data: null, error: null }),
  resetSysidRoom: vi.fn(),
}))

const refresh = vi.fn()
const resetEfficiencyEnvelope = vi.fn()

vi.mock('../../hooks/useEfficiencyEnvelope', () => ({
  useEfficiencyEnvelope: () => ({ data: ENVELOPE, error: null, loading: false, refresh }),
  resetEfficiencyEnvelope: () => resetEfficiencyEnvelope(),
}))

vi.mock('../../hooks/useConfig', () => ({
  useRawConfig: () => ({ data: null, error: null, loading: false, refetch: vi.fn() }),
}))

vi.mock('../../hooks/useHistory', () => ({
  useHistory: () => ({ data: [], loading: false }),
}))

vi.mock('../../components/TrendChart', () => ({
  TrendChart: ({ title }: { title: string }) => <div>{title}</div>,
}))

vi.mock('recharts', () => ({
  ScatterChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe('Engineering — efficiency envelope', () => {
  it('shows the card after the house heat loss card', () => {
    render(<Engineering />)
    const heatLoss = screen.getByTestId('heat-loss-summary')
    const card = screen.getByTestId('efficiency-envelope')
    expect(heatLoss.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('env-samples').textContent).toBe('42')
  })

  it('opens the card on the outdoor band of the live outdoor temperature', () => {
    render(<Engineering />)
    expect(screen.getByTestId('env-band-3').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('env-band-6').getAttribute('aria-pressed')).toBe('false')
  })

  it('resets through the reset route and reads the envelope again', async () => {
    resetEfficiencyEnvelope.mockResolvedValueOnce({
      ok: true,
      result: { status: 'reset', install_class: 'metered', power_entity: 'sensor.hp_power' },
    })
    refresh.mockClear()
    render(<Engineering />)
    fireEvent.click(screen.getByTestId('env-reset-request'))
    fireEvent.click(screen.getByTestId('env-reset-confirm-btn'))
    await waitFor(() => expect(screen.getByTestId('env-reset-outcome').textContent).toContain('Envelope reset.'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not read again after a failed reset', async () => {
    resetEfficiencyEnvelope.mockResolvedValueOnce({ ok: false, error: 'HTTP 503 — Efficiency envelope not yet initialised' })
    refresh.mockClear()
    render(<Engineering />)
    fireEvent.click(screen.getByTestId('env-reset-request'))
    fireEvent.click(screen.getByTestId('env-reset-confirm-btn'))
    await waitFor(() => expect(screen.getByTestId('env-reset-outcome').textContent).toContain('Reset failed'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
