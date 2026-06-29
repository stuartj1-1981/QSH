import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Home } from '../Home'
import type { CycleMessage } from '../../types/api'
import type { QshConfigYaml } from '../../types/config'

// Mock all the hooks used by Home
let mockLiveData: CycleMessage | null = null
vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({ data: mockLiveData, isConnected: false }),
}))

let mockStatusData: Record<string, unknown> | null = null
vi.mock('../../hooks/useStatus', () => ({
  useStatus: () => ({ data: mockStatusData, error: null }),
}))

let mockVersion: string | null = '1.1.11'
vi.mock('../../hooks/useVersion', () => ({
  useVersion: () => ({ version: mockVersion, loading: false }),
}))

vi.mock('../../hooks/useHistory', () => ({
  useHistory: () => ({ data: [] }),
}))

vi.mock('../../hooks/useAway', () => ({
  useAwayState: () => ({ data: null, refetch: vi.fn() }),
  useSetAway: () => ({ setAway: vi.fn() }),
}))

vi.mock('../../hooks/useSourceSelection', () => ({
  useSourceSelection: () => ({ data: null, setMode: vi.fn(), setPreference: vi.fn() }),
}))

let mockRawConfigData: QshConfigYaml | null = null
let mockProcConfigData: QshConfigYaml | null = null
const mockRefetchConfig = vi.fn()
vi.mock('../../hooks/useConfig', () => ({
  useRawConfig: () => ({ data: mockRawConfigData, refetch: vi.fn() }),
  useConfig: () => ({ data: mockProcConfigData, refetch: mockRefetchConfig }),
}))

// Mock recharts
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
}))

describe('Home migration banner', () => {
  afterEach(() => {
    mockStatusData = null
    mockVersion = '1.1.11'
    mockLiveData = null
    mockRawConfigData = null
    mockProcConfigData = null
  })

  it('banner shown when migration_pending is true', () => {
    mockStatusData = { migration_pending: true }
    render(<Home engineering={false} />)
    expect(screen.getByText(/Fleet data sharing and beta disclaimer/)).toBeInTheDocument()
  })

  it('banner not shown when migration_pending is false', () => {
    mockStatusData = { migration_pending: false }
    render(<Home engineering={false} />)
    expect(screen.queryByText(/Fleet data sharing and beta disclaimer/)).toBeNull()
  })

  it('banner not shown when migration_pending is absent', () => {
    mockStatusData = {}
    render(<Home engineering={false} />)
    expect(screen.queryByText(/Fleet data sharing and beta disclaimer/)).toBeNull()
  })

  it('Go to Settings link calls onNavigate("settings")', () => {
    mockStatusData = { migration_pending: true }
    const onNavigate = vi.fn()
    render(<Home engineering={false} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('Go to Settings →'))
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })
})

describe('Home version footer', () => {
  afterEach(() => {
    mockStatusData = null
    mockVersion = '1.1.11'
    mockLiveData = null
    mockRawConfigData = null
    mockProcConfigData = null
  })

  it('renders the addon version when useVersion resolves', () => {
    mockStatusData = {}
    mockVersion = '1.1.11'
    render(<Home engineering={false} />)
    expect(screen.getByText('QSH v1.1.11')).toBeInTheDocument()
  })

  it('renders an ellipsis placeholder when version is null', () => {
    mockStatusData = {}
    mockVersion = null
    render(<Home engineering={false} />)
    expect(screen.getByText('QSH v…')).toBeInTheDocument()
  })

  it('renders "unknown" literally when config.json is unreadable', () => {
    mockStatusData = {}
    mockVersion = 'unknown'
    render(<Home engineering={false} />)
    expect(screen.getByText('QSH vunknown')).toBeInTheDocument()
  })
})

describe('Home Live/Shadow optimistic toggle', () => {
  afterEach(() => {
    mockStatusData = null
    mockLiveData = null
    mockRawConfigData = null
    mockProcConfigData = null
    vi.restoreAllMocks()
  })

  it('flips the ComfortControl button label immediately when the user toggles to Shadow', async () => {
    // Initial snapshot: live (control_enabled = true).
    mockStatusData = { control_enabled: true }
    // Mock fetch to resolve the POST without actually hitting the network.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ control_enabled: false }), { status: 200 }),
    )

    render(<Home engineering={false} />)

    // The button starts in "Live" state because the snapshot says so.
    expect(screen.getByRole('button', { name: /Live/ })).toBeInTheDocument()

    // Click opens the confirmation modal; confirm it.
    fireEvent.click(screen.getByRole('button', { name: /Live/ }))
    fireEvent.click(screen.getByRole('button', { name: /Switch to Shadow/ }))

    // Optimistic flip — the button label should now read "Shadow" before the
    // next snapshot arrives. Use findByRole so React flushes the state update.
    expect(await screen.findByRole('button', { name: /Shadow/ })).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api/control/mode'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('rolls back the optimistic flag when the server returns a non-2xx response', async () => {
    mockStatusData = { control_enabled: true }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 500 }),
    )

    render(<Home engineering={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Live/ }))
    fireEvent.click(screen.getByRole('button', { name: /Switch to Shadow/ }))

    // After the failed POST, the button should return to "Live" — the
    // optimistic overlay must not mask a server-side rejection.
    expect(await screen.findByRole('button', { name: /Live/ })).toBeInTheDocument()
  })
})

describe('Home tariff strategy integration — INSTRUCTION-182', () => {
  afterEach(() => {
    mockStatusData = null
    mockLiveData = null
    mockRawConfigData = null
    mockProcConfigData = null
  })

  it('renders the tariff strategy in the status banner subtitle when not in summer monitoring', () => {
    mockStatusData = {}
    mockLiveData = {
      type: 'cycle',
      engineering: {
        det_flow: 35,
        rl_flow: null,
        rl_blend: 0,
        rl_reward: 0,
        shoulder_monitoring: false,
        summer_monitoring: false,
      },
    } as unknown as CycleMessage
    mockRawConfigData = {
      energy: { tariff_aggression_mode: 'aggressive' },
    } as unknown as QshConfigYaml

    render(<Home engineering={false} />)

    const node = screen.getByTestId('status-banner-tariff')
    expect(node).toBeInTheDocument()
    expect(node.textContent).toContain('Aggressive')
  })

  it('hides the tariff strategy segment when in summer monitoring', () => {
    mockStatusData = {}
    mockLiveData = {
      type: 'cycle',
      engineering: {
        det_flow: 35,
        rl_flow: null,
        rl_blend: 0,
        rl_reward: 0,
        shoulder_monitoring: false,
        summer_monitoring: true,
      },
    } as unknown as CycleMessage
    mockRawConfigData = {
      energy: { tariff_aggression_mode: 'aggressive' },
    } as unknown as QshConfigYaml

    render(<Home engineering={false} />)

    expect(screen.queryByTestId('status-banner-tariff')).toBeNull()
  })
})

describe('Home enforced flow envelope — INSTRUCTION-372C', () => {
  afterEach(() => {
    mockStatusData = null
    mockLiveData = null
    mockRawConfigData = null
    mockProcConfigData = null
  })

  it('displays the enforced envelope from the live snapshot, read-only', () => {
    mockStatusData = {}
    mockLiveData = {
      type: 'cycle',
      engineering: {
        det_flow: 35,
        rl_flow: null,
        rl_blend: 0,
        rl_reward: 0,
        shoulder_monitoring: false,
        summer_monitoring: false,
        flow_floor_c: 30,
        flow_ceiling_c: 55,
      },
    } as unknown as CycleMessage
    // INSTRUCTION-377B: an external flow-limit entity forces the read-only
    // enforced-envelope display (no editable steppers).
    mockRawConfigData = {
      heat_sources: [{ name: 'hp', type: 'heat_pump', flow_min_entity: 'sensor.flow_min' }],
    } as unknown as QshConfigYaml

    render(<Home engineering={false} />)

    expect(screen.getByText('Flow Limits')).toBeInTheDocument()
    expect(screen.getByText('30.0°')).toBeInTheDocument()
    expect(screen.getByText('55.0°')).toBeInTheDocument()
    // Read-only mode: no stepper buttons inside the Flow Limits card.
    const card = screen.getByText('Flow Limits').closest('div.rounded-xl') as HTMLElement
    expect(within(card).queryAllByRole('button').length).toBe(0)
  })

  it('shows "--" when the enforced envelope is absent (post-restart null)', () => {
    mockStatusData = {}
    mockLiveData = {
      type: 'cycle',
      engineering: {
        det_flow: 35,
        rl_flow: null,
        rl_blend: 0,
        rl_reward: 0,
        shoulder_monitoring: false,
        summer_monitoring: false,
      },
    } as unknown as CycleMessage
    // External config → read-only enforced display; with the envelope absent
    // both values fall back to "--".
    mockRawConfigData = {
      heat_sources: [{ name: 'hp', type: 'heat_pump', flow_max_entity: 'sensor.flow_max' }],
    } as unknown as QshConfigYaml

    render(<Home engineering={false} />)

    // The Flow Limits card still renders; both values fall back to "--".
    expect(screen.getByText('Flow Limits')).toBeInTheDocument()
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(2)
  })
})

describe('Home editable operating setpoint — INSTRUCTION-377B', () => {
  afterEach(() => {
    mockStatusData = null
    mockLiveData = null
    mockRawConfigData = null
    mockProcConfigData = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const liveWithEnvelope = {
    type: 'cycle',
    engineering: {
      det_flow: 35,
      rl_flow: null,
      rl_blend: 0,
      rl_reward: 0,
      shoulder_monitoring: false,
      summer_monitoring: false,
      flow_floor_c: 30,
      flow_ceiling_c: 55,
    },
  } as unknown as CycleMessage

  // The Flow Limits card is the nearest `rounded-xl` ancestor of its heading.
  const flowCard = () =>
    screen.getByText('Flow Limits').closest('div.rounded-xl') as HTMLElement

  it('single-source internal: editable steppers PATCH api/control/flow-min and refetch', async () => {
    vi.useFakeTimers()
    mockStatusData = {}
    mockLiveData = liveWithEnvelope
    // Raw config: single source, internal (no flow_*_entity). The raw YAML does
    // NOT carry flow_*_internal (runtime-default keys) — mirroring production.
    mockRawConfigData = {
      heat_sources: [{ name: 'hp', type: 'heat_pump' }],
    } as unknown as QshConfigYaml
    // Processed config carries the setpoint the backend operates on (35/48).
    mockProcConfigData = {
      flow_min_internal: 35,
      flow_max_internal: 48,
    } as unknown as QshConfigYaml

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    )

    render(<Home engineering={false} />)

    // Editable mode: the setpoint (not the enforced envelope) is shown, with
    // four stepper buttons [min-, min+, max-, max+] inside the card.
    const card = flowCard()
    expect(within(card).getByText('35.0°')).toBeInTheDocument()
    expect(within(card).getByText('48.0°')).toBeInTheDocument()
    const buttons = within(card).getAllByRole('button')
    expect(buttons.length).toBe(4)

    // Click Min "+" (buttons[1]) → 35.5, then flush the 500 ms debounce.
    fireEvent.click(buttons[1])
    vi.advanceTimersByTime(500)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api/control/flow-min'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ value: 35.5 }),
      }),
    )

    // The PATCH .then() refetches the processed config so the new setpoint
    // re-displays. Flush the resolved fetch promise first.
    await vi.runOnlyPendingTimersAsync()
    expect(mockRefetchConfig).toHaveBeenCalled()
  })

  it('external single-source: read-only enforced display, no steppers', () => {
    mockStatusData = {}
    mockLiveData = liveWithEnvelope
    mockRawConfigData = {
      heat_sources: [{ name: 'hp', type: 'heat_pump', flow_min_entity: 'sensor.flow_min' }],
      flow_min_internal: 35,
      flow_max_internal: 48,
    } as unknown as QshConfigYaml

    render(<Home engineering={false} />)

    const card = flowCard()
    // Read-only enforced values (30/55), not the setpoint (35/48).
    expect(within(card).getByText('30.0°')).toBeInTheDocument()
    expect(within(card).getByText('55.0°')).toBeInTheDocument()
    // No stepper buttons in read-only mode.
    expect(within(card).queryAllByRole('button').length).toBe(0)
  })

  it('multi-source: read-only enforced display, no steppers (D-377-4)', () => {
    mockStatusData = {}
    mockLiveData = liveWithEnvelope
    // Two sources, no external entity → multi-source ⇒ read-only.
    mockRawConfigData = {
      heat_sources: [
        { name: 'hp', type: 'heat_pump' },
        { name: 'boiler', type: 'gas_boiler' },
      ],
      flow_min_internal: 35,
      flow_max_internal: 48,
    } as unknown as QshConfigYaml

    render(<Home engineering={false} />)

    const card = flowCard()
    expect(within(card).getByText('30.0°')).toBeInTheDocument()
    expect(within(card).getByText('55.0°')).toBeInTheDocument()
    expect(within(card).queryAllByRole('button').length).toBe(0)
  })
})
