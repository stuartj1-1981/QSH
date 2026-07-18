import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Engineering } from '../Engineering'
import {
  MIN_OBS_FOR_USE,
  CONFIDENCE_FULL_AT,
  PC_FIT_R_SQUARED_MIN,
} from '../../lib/sysidConstants'

// --- Hook mocks -------------------------------------------------------------

const MOCK_LIVE = {
  cycle_number: 42,
  status: {
    operating_state: 'heating',
    applied_mode: 'heat',
    applied_flow: 35.5,
    total_demand: 4.2,
    outdoor_temp: 7.8,
    heat_source: {
      flow_temp: 36.0,
      return_temp: 32.0,
      delta_t: 4.0,
      flow_rate: 0.42,
      input_power_kw: 1.4,
    },
  },
  engineering: {
    det_flow: 35.0,
    rl_flow: 36.0,
    rl_blend: 0.25,
    rl_reward: -0.42,
    rl_loss: 0.0123,
    frost_cap_active: false,
    cascade_active: false,
    signal_quality: { hp: 'good', occupancy: 'good' },
  },
  hp: { cop: 3.4 },
}

vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({ data: MOCK_LIVE, isConnected: true }),
}))

const MOCK_SYSID = {
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
      // INSTRUCTION-420 — sensor-cadence classification struct.
      sensor_cadence: {
        class: 'blocked',
        median_step_c: 0.5,
        median_interval_s: 600,
        admissible_fraction: 0,
        event_count: 20,
        window_span_s: 12000,
      },
    },
  },
}

// INSTRUCTION-415/422 — the room-detail expansion fetches /api/sysid/{room}
// via useSysidRoom and resets via resetSysidRoom; both mocked module-wide.
const MOCK_ROOM_DETAIL = {
  room: 'lounge',
  u_kw_per_c: 0.234,
  c_kwh_per_c: 1.42,
  u_observations: 3,
  c_observations: 4,
  c_source: 'PC',
  pc_fits: 2,
  solar_gain: 0.012,
  confidence: 'low',
  gate_stats: {
    room_u_qualified: 3,
    room_u_rejected_rate: 41,
    room_u_rejected_delta_ext: 5,
    room_u_rejected_no_c: 0,
    room_u_flat: 12,
    room_u_rejected_sign: 2,
    room_u_rejected_outlier: 1,
  },
}

const mockResetSysidRoom = vi.fn()

vi.mock('../../hooks/useSysid', () => ({
  useSysid: () => ({ data: MOCK_SYSID, error: null }),
  useSysidRoom: () => ({ data: MOCK_ROOM_DETAIL, error: null }),
  resetSysidRoom: (room: string) => mockResetSysidRoom(room),
}))

vi.mock('../../hooks/useConfig', () => ({
  useRawConfig: () => ({ data: null, error: null, loading: false, refetch: vi.fn() }),
}))

vi.mock('../../hooks/useHistory', () => ({
  useHistory: () => ({ data: [], loading: false }),
}))

// TrendChart pulls in recharts; stub it out to keep this test focused on
// tooltip wiring rather than chart rendering. The stub still renders the
// title so the title-honesty assertion (INSTRUCTION-239) can verify it.
vi.mock('../../components/TrendChart', () => ({
  TrendChart: ({ title }: { title: string }) => <div>{title}</div>,
}))

// HardwareTelemetry is real — it does not pull anything heavy. Leave unmocked.

// --- Helpers ---------------------------------------------------------------

/** Returns the popover string-content matcher for a substring check. */
const includesText = (s: string) => (content: string) => content.includes(s)

// --- Tests -----------------------------------------------------------------

describe('Engineering page tooltips', () => {
  it('renders SYSTEM ID heading with a HelpTip', () => {
    render(<Engineering />)
    const heading = screen.getByRole('heading', { name: /SYSTEM ID/ })
    expect(within(heading).getByLabelText('Help')).toBeInTheDocument()
  })

  it('SysID column header row contains exactly ten Help buttons (one per column)', () => {
    // The tight count is intentional. Adding a column without a tooltip
    // SHOULD fail this test — that is the assertion's job.
    render(<Engineering />)
    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(10)
    const buttons = headers.flatMap((h) => within(h).getAllByLabelText('Help'))
    expect(buttons).toHaveLength(10)
  })

  // Column index map (matches the order of <th> elements in SysidTable):
  // 0 Room, 1 U (kW/°C), 2 C (kWh/°C), 3 U obs, 4 C obs, 5 C source,
  // 6 PC fits, 7 Solar, 8 Confidence, 9 Sensor (INSTRUCTION-420)
  const highRiskCases = [
    {
      label: 'U (kW/°C)',
      headerIdx: 1,
      substr: 'NOT a room-by-room heat-loss survey',
    },
    {
      // INSTRUCTION-416 — pc_fits is per-room now; the tooltip must say so.
      label: 'PC fits',
      headerIdx: 6,
      substr: 'for this room',
    },
    {
      label: 'Solar',
      headerIdx: 7,
      substr: 'that is expected, not a fault',
    },
    {
      // INSTRUCTION-416 D4 — the badge is a per-room U-evidence indicator;
      // C maturity moved to its own column.
      label: 'Confidence',
      headerIdx: 8,
      substr: 'C maturity is shown in its own column',
    },
  ]

  it.each(highRiskCases)(
    '$label tooltip contains the high-risk semantic claim',
    async ({ headerIdx, substr }) => {
      render(<Engineering />)
      const headers = screen.getAllByRole('columnheader')
      fireEvent.click(within(headers[headerIdx]).getByLabelText('Help'))
      // Popover portals to document.body — search the whole document.
      expect(await screen.findByText(includesText(substr))).toBeInTheDocument()
    },
  )

  it('U obs tooltip embeds MIN_OBS_FOR_USE and the 323 precision truth', async () => {
    // INSTRUCTION-418 D2 — the pre-323 "reaches 1.0 at 100 observations"
    // count-ratio claim is gone; the tooltip now states the evidence-ramp ×
    // precision model in operator language.
    render(<Engineering />)
    const headers = screen.getAllByRole('columnheader')
    fireEvent.click(within(headers[3]).getByLabelText('Help'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(/Below\s+10\s/)
    expect(tooltip).toHaveTextContent(/precision, not just count/)
  })

  it('Confidence badge tooltip embeds both band thresholds', async () => {
    // Bounded patterns are deliberate. Bare substring `"10"` is also a substring
    // of `"100"`, so a naive assertion would pass trivially when the second value
    // is present. Anchor each numeric on its surrounding prose so the two
    // assertions remain independent (INSTRUCTION-416 D4 bands).
    render(<Engineering />)
    const headers = screen.getAllByRole('columnheader')
    fireEvent.click(within(headers[8]).getByLabelText('Help'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(/fewer than\s+10\s+accepted/)
    expect(tooltip).toHaveTextContent(/High\s+=\s+100\+/)
  })

  it('PC fits tooltip embeds current PC_FIT_R_SQUARED_MIN threshold', async () => {
    render(<Engineering />)
    const headers = screen.getAllByRole('columnheader')
    fireEvent.click(within(headers[6]).getByLabelText('Help'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(/R²\s*≥\s*0\.8/)
  })

  it('sysidConstants pin to expected values (tripwire)', () => {
    // If a future contributor edits sysidConstants.ts without verifying against
    // qsh/sysid.py, this test fails and forces a re-read of INSTRUCTION-214 Task 0.
    expect(MIN_OBS_FOR_USE).toBe(10)
    expect(CONFIDENCE_FULL_AT).toBe(100)
    expect(PC_FIT_R_SQUARED_MIN).toBe(0.8)
  })

  it('PIPELINE STATE block has exactly 9 HelpTip buttons (1 heading + 8 stats)', () => {
    // The exact count is intentional. Adding a Stat without a help prop, or
    // removing the section heading HelpTip, SHOULD fail this test — that is the
    // assertion's job. Same discipline as the SysID column row test above.
    render(<Engineering />)
    const block = within(screen.getByTestId('pipeline-state'))
    expect(block.getAllByLabelText('Help')).toHaveLength(9)
  })

  it('chart titles do not advertise specific time windows', () => {
    // INSTRUCTION-239: the buffer-depth window grows from startup onwards,
    // so a chart title that commits to "(48h)" or "(7d)" is a UX defect
    // when rendered on a fresh install or shortly after restart.
    render(<Engineering />)
    expect(screen.getByText('RL Reward')).toBeInTheDocument()
    expect(screen.getByText('RL Loss')).toBeInTheDocument()
    expect(screen.getByText('Blend Factor')).toBeInTheDocument()
    expect(screen.getByText('Flow Comparison')).toBeInTheDocument()
    expect(screen.queryByText(/\(48h\)/)).toBeNull()
    expect(screen.queryByText(/\(7d\)/)).toBeNull()
  })
})

// ── INSTRUCTION-420 — Sensor column ─────────────────────────────────────────
describe('Engineering sensor-cadence column (INSTRUCTION-420)', () => {
  it('renders the cadence badge from the API class value', () => {
    render(<Engineering />)
    const badge = screen.getByTestId('cadence-badge')
    expect(badge).toHaveTextContent('Blocked')
  })

  it('Sensor header tooltip names the fix mechanisms and the advisory stance', async () => {
    render(<Engineering />)
    const headers = screen.getAllByRole('columnheader')
    fireEvent.click(within(headers[9]).getByLabelText('Help'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(/reporting deadband/)
    expect(tooltip).toHaveTextContent(/cannot learn at current settings/i)
    expect(tooltip).toHaveTextContent(/never blocks anything/i)
  })
})

// ── INSTRUCTION-415/422 — room detail: rejection ledger + reset flow ───────
describe('Engineering room detail (INSTRUCTION-415 ledger + INSTRUCTION-422 reset)', () => {
  const expandRow = () => {
    render(<Engineering />)
    fireEvent.click(screen.getByTestId('sysid-row-lounge'))
  }

  it('row click expands the detail with the U rejection ledger, dominant class emphasised', () => {
    expandRow()
    const ledger = screen.getByTestId('u-rejection-ledger')
    // All seven classes render with their counts.
    expect(ledger).toHaveTextContent('qualified 3')
    expect(ledger).toHaveTextContent('rate 41')
    expect(ledger).toHaveTextContent('flat 12')
    expect(ledger).toHaveTextContent('Δext 5')
    // Starved room (3 obs < 10) + rate-dominant → the mechanism copy names
    // the sensor-step fix (INSTRUCTION-415 D4).
    expect(screen.getByTestId('u-ledger-mechanism')).toHaveTextContent(
      /steps too large/,
    )
    expect(screen.getByTestId('u-ledger-mechanism')).toHaveTextContent(
      /deadband/,
    )
  })

  it('reset flow: confirm states what is discarded; success outcome renders (422)', async () => {
    mockResetSysidRoom.mockResolvedValueOnce({
      ok: true,
      result: {
        room: 'lounge',
        was: { u_observations: 3, c_observations: 4, solar_observations: 0,
               pc_fits: 2, u: 0.19, c: 0.9 },
        now: { u_prior: 0.4615, c_prior: 0.462 },
      },
    })
    expandRow()
    fireEvent.click(screen.getByTestId('sysid-reset-request'))
    const confirm = screen.getByTestId('sysid-reset-confirm')
    // The confirm names exactly what is discarded, this room only.
    expect(confirm).toHaveTextContent(/3 U observations/)
    expect(confirm).toHaveTextContent(/This room only/)
    fireEvent.click(screen.getByTestId('sysid-reset-confirm-btn'))
    const outcome = await screen.findByTestId('sysid-reset-outcome')
    expect(outcome).toHaveTextContent(/Room reset to config priors/)
    expect(outcome).toHaveTextContent(/discarded 3 U/)
    expect(outcome).toHaveTextContent(/U 0\.4615/)
    expect(mockResetSysidRoom).toHaveBeenCalledWith('lounge')
  })

  it('reset flow: failure outcome renders — no silent failure (414 law)', async () => {
    mockResetSysidRoom.mockResolvedValueOnce({
      ok: false,
      error: 'HTTP 503 — SysID not initialised',
    })
    expandRow()
    fireEvent.click(screen.getByTestId('sysid-reset-request'))
    fireEvent.click(screen.getByTestId('sysid-reset-confirm-btn'))
    const outcome = await screen.findByTestId('sysid-reset-outcome')
    expect(outcome).toHaveTextContent(/Reset failed/)
    expect(outcome).toHaveTextContent(/503/)
  })

  it('cancel closes the confirm without calling the API', () => {
    mockResetSysidRoom.mockClear()
    expandRow()
    fireEvent.click(screen.getByTestId('sysid-reset-request'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByTestId('sysid-reset-confirm')).toBeNull()
    expect(mockResetSysidRoom).not.toHaveBeenCalled()
  })
})
