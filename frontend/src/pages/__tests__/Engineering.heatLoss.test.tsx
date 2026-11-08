import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Engineering } from '../Engineering'
import type { SysidResponse } from '../../types/api'

// INSTRUCTION-614 — the Engineering page shows the house heat loss card when
// /api/sysid carries the installation_heat_loss envelope, and not otherwise.

const LOUNGE = {
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
}

const sysid: { data: SysidResponse } = {
  data: {
    rooms: { lounge: LOUNGE },
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
  },
}

vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({ data: null, isConnected: true }),
}))

vi.mock('../../hooks/useSysid', () => ({
  useSysid: () => ({ data: sysid.data, error: null }),
  useSysidRoom: () => ({ data: null, error: null }),
  resetSysidRoom: vi.fn(),
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

describe('Engineering — house heat loss', () => {
  it('shows the card when the envelope is present', () => {
    render(<Engineering />)
    expect(screen.getByTestId('heat-loss-summary')).toBeTruthy()
    expect(screen.getByTestId('hl-ratio').textContent).toBe('2.00×')
  })

  it('shows no card when the envelope is absent', () => {
    const saved = sysid.data
    sysid.data = { rooms: { lounge: LOUNGE } }
    try {
      render(<Engineering />)
      expect(screen.queryByTestId('heat-loss-summary')).toBeNull()
      expect(screen.getByText('SYSTEM ID')).toBeTruthy()
    } finally {
      sysid.data = saved
    }
  })
})
