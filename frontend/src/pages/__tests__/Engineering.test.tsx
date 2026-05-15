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
    },
  },
}

vi.mock('../../hooks/useSysid', () => ({
  useSysid: () => ({ data: MOCK_SYSID, error: null }),
}))

vi.mock('../../hooks/useConfig', () => ({
  useRawConfig: () => ({ data: null, error: null, loading: false, refetch: vi.fn() }),
}))

vi.mock('../../hooks/useHistory', () => ({
  useHistory: () => ({ data: [], loading: false }),
}))

// TrendChart pulls in recharts; stub it out to keep this test focused on
// tooltip wiring rather than chart rendering.
vi.mock('../../components/TrendChart', () => ({
  TrendChart: () => null,
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

  it('SysID column header row contains exactly nine Help buttons (one per column)', () => {
    // The tight count is intentional. Adding a column without a tooltip
    // SHOULD fail this test — that is the assertion's job.
    render(<Engineering />)
    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(9)
    const buttons = headers.flatMap((h) => within(h).getAllByLabelText('Help'))
    expect(buttons).toHaveLength(9)
  })

  // Column index map (matches the order of <th> elements in SysidTable):
  // 0 Room, 1 U (kW/°C), 2 C (kWh/°C), 3 U obs, 4 C obs, 5 C source,
  // 6 PC fits, 7 Solar, 8 Confidence
  const highRiskCases = [
    {
      label: 'U (kW/°C)',
      headerIdx: 1,
      substr: 'NOT a room-by-room heat-loss survey',
    },
    {
      label: 'PC fits',
      headerIdx: 6,
      substr: 'same number is shown in every row',
    },
    {
      label: 'Solar',
      headerIdx: 7,
      substr: 'that is expected, not a fault',
    },
    {
      label: 'Confidence',
      headerIdx: 8,
      substr: 'C and Solar observations are NOT inputs',
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

  it('U obs tooltip embeds current MIN_OBS_FOR_USE and CONFIDENCE_FULL_AT thresholds', async () => {
    // Bounded patterns are deliberate. Bare substring `"10"` is also a substring
    // of `"100"`, so a naive assertion would pass trivially when the second value
    // is present. Anchor each numeric on its surrounding prose so the two
    // assertions remain independent.
    render(<Engineering />)
    const headers = screen.getAllByRole('columnheader')
    fireEvent.click(within(headers[3]).getByLabelText('Help'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(/Below\s+10\s/)
    expect(tooltip).toHaveTextContent(/at\s+100\s+observations/)
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
})
