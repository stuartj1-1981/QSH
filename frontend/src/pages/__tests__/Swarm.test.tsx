import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Swarm } from '../Swarm'
import { useSwarm } from '../../hooks/useSwarm'
import type {
  SwarmStatus,
  SwarmPriors,
  SwarmDivergence,
  SwarmGates,
  SwarmGlobal,
  SwarmChannels,
} from '../../types/api'

vi.mock('../../hooks/useSwarm')
const mockUseSwarm = vi.mocked(useSwarm)

const STATUS: SwarmStatus = {
  enabled: true,
  unit_id: 'urn:swarm:unit:stu-b27eb2c9',
  cohort_id: 'detached-2016',
  subscribe_enabled: false,
  endpoint: 'https://swarm.example.workers.dev',
  queue: { pending: 2, delivered: 5 },
  pending: 2,
}
const PRIORS_EMPTY: SwarmPriors = { families: {}, family_names: [], last_etag: null, count: 0 }
const DIVERGENCE: SwarmDivergence = {
  rooms: [
    {
      room: 'lounge',
      u_shadow: 0.3, u_live: 0.28, u_delta: 0.02,
      c_shadow: 3.0, c_live: 2.5, c_delta: 0.5,
      solar_shadow: 0.5, solar_live: 0.45, solar_delta: 0.05,
    },
  ],
  counterfactual_summary: 'shadow leads live by 7%',
}
const GATES: SwarmGates = {
  gates: {
    disturbance_relay: 'UNKNOWN',
    sysid_priors: 'UNKNOWN',
    solar_bootstrap: 'UNKNOWN',
    rl_benchmarking: 'UNKNOWN',
  },
}
// GLOBAL Open, master OFF — "Go Live" available, GLOBAL badge OPEN (so it does
// not disturb the four-UNKNOWN LocalGate count in the legacy render test).
const GLOBAL_OPEN_SHADOW: SwarmGlobal = {
  global_gate: 'OPEN',
  live_enabled: false,
  live_active: false,
  can_enable: true,
}
// BASE fixture (master in shadow → live_active false): one observing tile
// (sysid_priors: wired, gate Open, fresh, but not live), one no_data tile
// (solar_bootstrap: wired but nothing cached), two reserved (not wired).
const CHANNELS: SwarmChannels = {
  channels: {
    sysid_priors: { gate: 'OPEN', family: 'thermal_envelope', data: 'fresh', wired: true },
    solar_bootstrap: { gate: 'CLOSED', family: 'solar_capture', data: 'none', wired: true },
    disturbance_relay: { gate: 'UNKNOWN', family: null, data: 'none', wired: false },
    rl_benchmarking: { gate: 'UNKNOWN', family: null, data: 'none', wired: false },
  },
}

function okSetLive() {
  return vi.fn(async () => ({ ok: true, status: 200, detail: null as string | null }))
}

const BASE: ReturnType<typeof useSwarm> = {
  status: STATUS,
  priors: PRIORS_EMPTY,
  divergence: DIVERGENCE,
  gates: GATES,
  globalState: GLOBAL_OPEN_SHADOW,
  channels: CHANNELS,
  error: null,
  refetch: vi.fn(),
  setLive: okSetLive(),
}

describe('Swarm page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders identity, the four input tiles, and four local-gate Standby badges', () => {
    mockUseSwarm.mockReturnValue(BASE)
    render(<Swarm />)

    expect(screen.getByText('urn:swarm:unit:stu-b27eb2c9')).toBeInTheDocument()
    expect(screen.getByText('https://swarm.example.workers.dev')).toBeInTheDocument()

    // Swarm Inputs tiles replace the divergence table. ('Disturbance Relay' also
    // appears in Panel 4's humanized gate list, hence getAllByText for it.)
    expect(screen.getByText('Thermal Envelope')).toBeInTheDocument()
    expect(screen.getByText('Solar Capture')).toBeInTheDocument()
    expect(screen.getByText('RL Benchmarking')).toBeInTheDocument()
    expect(screen.getAllByText('Disturbance Relay').length).toBeGreaterThanOrEqual(1)

    // Derived statuses for BASE (master in shadow → no in_use): observing +
    // no_data + two reserved.
    expect(screen.getByText('Observing')).toBeInTheDocument()
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getAllByText('Reserved')).toHaveLength(2)

    // Panel 4 local gates: all-UNKNOWN now renders as "Standby" (×4). The Live
    // Control GLOBAL badge is OPEN, so it does not add to the Standby count.
    expect(screen.getAllByText('Standby')).toHaveLength(4)
  })

  it('renders In use tiles when channels are fresh, gate-Open, and the master is live', () => {
    const liveChannels: SwarmChannels = {
      channels: {
        sysid_priors: { gate: 'OPEN', family: 'thermal_envelope', data: 'fresh', wired: true },
        solar_bootstrap: { gate: 'OPEN', family: 'solar_capture', data: 'fresh', wired: true },
        disturbance_relay: { gate: 'UNKNOWN', family: null, data: 'none', wired: false },
        rl_benchmarking: { gate: 'UNKNOWN', family: null, data: 'none', wired: false },
      },
    }
    mockUseSwarm.mockReturnValue({
      ...BASE,
      channels: liveChannels,
      globalState: { global_gate: 'OPEN', live_enabled: true, live_active: true, can_enable: true },
    })
    render(<Swarm />)
    // Both wired+fresh+gate-Open channels are consumed when the master is live.
    expect(screen.getAllByText('In use')).toHaveLength(2)
  })

  it('renders the disabled state when enabled is false', () => {
    mockUseSwarm.mockReturnValue({ ...BASE, status: { ...STATUS, enabled: false } })
    render(<Swarm />)
    expect(screen.getByText(/swarm is disabled/i)).toBeInTheDocument()
    expect(screen.queryByText('Local Gates')).not.toBeInTheDocument()
    // The Live Control panel is also gated behind the enabled state.
    expect(screen.queryByText('Swarm Live Control')).not.toBeInTheDocument()
  })

  it('renders the explicit empty-state when priors.count is 0', () => {
    mockUseSwarm.mockReturnValue(BASE)
    render(<Swarm />)
    expect(screen.getByText(/no priors received yet/i)).toBeInTheDocument()
  })

  it('renders the error surface when error is set and no status yet', () => {
    mockUseSwarm.mockReturnValue({
      status: null,
      priors: null,
      divergence: null,
      gates: null,
      globalState: null,
      channels: null,
      error: 'network down',
      refetch: vi.fn(),
      setLive: okSetLive(),
    })
    render(<Swarm />)
    expect(screen.getByText(/network down/i)).toBeInTheDocument()
  })

  // ── INSTRUCTION-294B — Swarm Live Control panel ──────────────────────

  it('renders the Live Control panel with the GLOBAL badge and an enabled Go Live', () => {
    mockUseSwarm.mockReturnValue(BASE)
    render(<Swarm />)
    expect(screen.getByText('Swarm Live Control')).toBeInTheDocument()
    expect(screen.getByText('Fleet GLOBAL gate')).toBeInTheDocument()
    expect(screen.getByText('Shadow')).toBeInTheDocument() // master state (OFF)
    expect(screen.getByRole('button', { name: 'Go Live' })).toBeEnabled()
  })

  it('disables Go Live with the Closed caption when GLOBAL is Closed', () => {
    mockUseSwarm.mockReturnValue({
      ...BASE,
      globalState: { global_gate: 'CLOSED', live_enabled: false, live_active: false, can_enable: false },
    })
    render(<Swarm />)
    expect(screen.getByRole('button', { name: 'Go Live' })).toBeDisabled()
    expect(screen.getByText('Locked — fleet GLOBAL gate is Closed')).toBeInTheDocument()
  })

  it('relabels GLOBAL Unknown as "No Signal" with the relabelled lock caption', () => {
    mockUseSwarm.mockReturnValue({
      ...BASE,
      globalState: { global_gate: 'UNKNOWN', live_enabled: false, live_active: false, can_enable: false },
    })
    render(<Swarm />)
    expect(screen.getByRole('button', { name: 'Go Live' })).toBeDisabled()
    // The GLOBAL badge text is context-relabelled (UNKNOWN → "No Signal").
    expect(screen.getByText('No Signal')).toBeInTheDocument()
    expect(
      screen.getByText('Locked — fleet GLOBAL gate — No Signal (stale / unreachable)'),
    ).toBeInTheDocument()
  })

  it('shows Live + an always-enabled Return to Shadow when live_active', () => {
    mockUseSwarm.mockReturnValue({
      ...BASE,
      globalState: { global_gate: 'OPEN', live_enabled: true, live_active: true, can_enable: true },
    })
    render(<Swarm />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Return to Shadow' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Go Live' })).not.toBeInTheDocument()
  })

  it('shows the amber Armed — suppressed state when live_enabled but not live_active', () => {
    mockUseSwarm.mockReturnValue({
      ...BASE,
      globalState: { global_gate: 'CLOSED', live_enabled: true, live_active: false, can_enable: false },
    })
    render(<Swarm />)
    expect(screen.getByText(/armed — suppressed \(global not open\)/i)).toBeInTheDocument()
    // Intent is ON, so the control offers Return to Shadow (not Go Live).
    expect(screen.getByRole('button', { name: 'Return to Shadow' })).toBeInTheDocument()
  })

  it('renders the loading state (not "Shadow") when globalState is null', () => {
    mockUseSwarm.mockReturnValue({ ...BASE, globalState: null })
    render(<Swarm />)
    // Two rows show "Loading…"; no master "Shadow" badge, no control button.
    expect(screen.getAllByText('Loading…').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('Shadow')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go Live' })).not.toBeInTheDocument()
  })

  it('Go Live goes through a confirm step then calls setLive(true)', async () => {
    const setLive = okSetLive()
    mockUseSwarm.mockReturnValue({ ...BASE, setLive })
    const user = userEvent.setup()
    render(<Swarm />)

    await user.click(screen.getByRole('button', { name: 'Go Live' }))
    // Confirm prompt replaces the button.
    expect(screen.getByText(/enable live consumption of swarm priors/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(setLive).toHaveBeenCalledWith(true)
    expect(await screen.findByText(/live enabled/i)).toBeInTheDocument()
  })

  it('renders the distinct 409 message when the gate is not Open at click time', async () => {
    const setLive = vi.fn(async () => ({
      ok: false,
      status: 409,
      detail: 'cannot enable — GLOBAL gate is not Open' as string | null,
    }))
    mockUseSwarm.mockReturnValue({ ...BASE, setLive })
    const user = userEvent.setup()
    render(<Swarm />)

    await user.click(screen.getByRole('button', { name: 'Go Live' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(setLive).toHaveBeenCalledWith(true)
    expect(await screen.findByText(/cannot enable — global gate is not open/i)).toBeInTheDocument()
  })

  it('renders a distinct (non-409) message on an unreachable network error', async () => {
    const setLive = vi.fn(async () => ({ ok: false, status: 0, detail: 'offline' as string | null }))
    mockUseSwarm.mockReturnValue({ ...BASE, setLive })
    const user = userEvent.setup()
    render(<Swarm />)

    await user.click(screen.getByRole('button', { name: 'Go Live' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    // Distinct from the 409 "not Open" copy — the network failure is surfaced as-is.
    expect(await screen.findByText(/request failed: offline/i)).toBeInTheDocument()
    expect(screen.queryByText(/global gate is not open/i)).not.toBeInTheDocument()
  })

  it('can cancel the confirm step without dispatching', async () => {
    const setLive = okSetLive()
    mockUseSwarm.mockReturnValue({ ...BASE, setLive })
    const user = userEvent.setup()
    render(<Swarm />)

    await user.click(screen.getByRole('button', { name: 'Go Live' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(setLive).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Go Live' })).toBeInTheDocument()
  })
})
