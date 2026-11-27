import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Balancing } from '../Balancing'

const MOCK_RESPONSE = {
  reference_rate: 0.0042,
  rooms: {
    lounge: {
      normalised_rate: 0.005,
      imbalance_ratio: 0.19,
      consecutive_imbalanced: 0,
      observations: 8,
      stability: 0.12,
      recommendation_pending: false,
      recommendation_text: '',
      recommendations_given: 0,
      control_mode: 'direct',
      balance_status: 'automatic',
      notification_disabled: false,
    },
    bedroom: {
      normalised_rate: 0.004,
      imbalance_ratio: -0.05,
      consecutive_imbalanced: 0,
      observations: 6,
      stability: 0.15,
      recommendation_pending: true,
      recommendation_text: 'Bedroom is slightly under-heating. Try opening the lockshield valve by 1/4 turn.',
      recommendations_given: 1,
      control_mode: 'indirect',
      balance_status: 'balanced',
      notification_disabled: false,
    },
  },
  imbalanced_count: 0,
  total_observations: 14,
}

describe('Balancing page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders with mock data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<Balancing />)

    const heading = await screen.findByText('Balancing')
    expect(heading).toBeInTheDocument()

    // Room names rendered
    expect(await screen.findByText('Lounge')).toBeInTheDocument()
    expect(await screen.findByText('Bedroom')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<Balancing />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fail'))
    render(<Balancing />)
    const err = await screen.findByText(/error/i)
    expect(err).toBeInTheDocument()
  })

  it('shows pending recommendations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<Balancing />)

    const recs = await screen.findAllByText(/lockshield valve/i)
    expect(recs.length).toBeGreaterThan(0)
  })

  it('direct zones show auto instead of toggle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<Balancing />)

    const autoLabel = await screen.findByText('auto')
    expect(autoLabel).toBeInTheDocument()
  })

  it('toggle fires PATCH', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ room: 'bedroom', notification_disabled: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      } as Response)

    render(<Balancing />)

    // Wait for page to render
    await screen.findByText('Bedroom')

    // Find and click the toggle button (the one that's not 'auto' text)
    const toggles = screen.getAllByRole('button').filter(
      (btn) => btn.title === 'Notifications enabled' || btn.title === 'Notifications disabled'
    )
    expect(toggles.length).toBeGreaterThan(0)

    fireEvent.click(toggles[0])

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (call) => (call[1] as RequestInit)?.method === 'PATCH',
      )
      expect(patchCall).toBeDefined()
    })
  })

  it('renders tooltip text when help icon clicked (regression: D1 portal escape)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    render(<Balancing />)

    // Wait for table to render
    await screen.findByText('Lounge')

    // Click the first help icon (Deviation column)
    const helpButtons = screen.getAllByRole('button', { name: /help/i })
    expect(helpButtons.length).toBeGreaterThanOrEqual(2) // Deviation + Suggestion

    fireEvent.click(helpButtons[0])

    // BALANCING.severity text from helpText.ts, surfaced via role="tooltip"
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(/how far the zone flow deviates/i)
  })

  // ── INSTRUCTION-648E ────────────────────────────────────────────────────

  function mockWith(overrides: { lounge?: object; bedroom?: object; flow_model?: object }) {
    const body = {
      ...MOCK_RESPONSE,
      rooms: {
        lounge: { ...MOCK_RESPONSE.rooms.lounge, ...(overrides.lounge ?? {}) },
        bedroom: { ...MOCK_RESPONSE.rooms.bedroom, ...(overrides.bedroom ?? {}) },
      },
      ...(overrides.flow_model ? { flow_model: overrides.flow_model } : {}),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => body,
    } as Response)
  }

  function flowBasis(rooms: object = {}, samples = 0) {
    return { samples, constant: 0.5, unit: 'l_min', rooms }
  }

  it('shows the maximum opening of a direct room', async () => {
    mockWith({ lounge: { max_opening_pct: 60, max_opening_source: 'probe' } })
    render(<Balancing />)
    expect(await screen.findByText('60%')).toBeInTheDocument()
  })

  it('gives no lockshield suggestion for a bypass or underfloor room', async () => {
    // Control: the same bedroom with no exclusion gets a suggestion.
    mockWith({ bedroom: { imbalance_ratio: 0.5, recommendation_pending: false } })
    const control = render(<Balancing />)
    expect((await screen.findAllByText(/lockshield valve by/)).length).toBeGreaterThan(0)
    control.unmount()
    vi.restoreAllMocks()

    mockWith({ bedroom: { imbalance_ratio: 0.5, recommendation_pending: false, excluded: 'bypass' } })
    const bypass = render(<Balancing />)
    expect(await screen.findByText('bypass — not compared')).toBeInTheDocument()
    expect(screen.queryByText(/lockshield valve by/)).not.toBeInTheDocument()
    bypass.unmount()
    vi.restoreAllMocks()

    mockWith({ bedroom: { imbalance_ratio: 0.5, recommendation_pending: false, advice_off: 'ufh' } })
    render(<Balancing />)
    expect(await screen.findByText('underfloor — no lockshield advice')).toBeInTheDocument()
    expect(screen.queryByText(/lockshield valve by/)).not.toBeInTheDocument()
  })

  it('shows the hydraulic flow model', async () => {
    mockWith({
      flow_model: {
        basis: 'hydraulic',
        probe: { state: 'idle', room: null, full_open_lpm: { lounge: 4.0 }, results: {} },
        hydraulic: flowBasis({
          lounge: {
            full_open: 4.25, design: 3.0, index: 1.42, balance_index: 1.4,
            mature: true, active_samples: 150, rel_sd: 0.1,
          },
        }, 300),
        thermal: { ...flowBasis(), unit: 'kw_per_k_n' },
      },
    })
    render(<Balancing />)
    expect(await screen.findByText('Hydraulic')).toBeInTheDocument()
    expect(screen.getByText('4.3 L/min')).toBeInTheDocument()
    expect(screen.getByText('3.0 L/min')).toBeInTheDocument()
    expect(screen.getByText('1.40')).toBeInTheDocument()
    expect(screen.getByText('4.0 L/min')).toBeInTheDocument()
  })

  it('says the flow model is not yet learned', async () => {
    mockWith({
      flow_model: {
        basis: 'none',
        hydraulic: flowBasis({}, 12),
        thermal: { ...flowBasis({}, 40), unit: 'kw_per_k_n' },
      },
    })
    render(<Balancing />)
    expect(await screen.findByText('Not yet learned')).toBeInTheDocument()
    expect(screen.getByText(/Not enough data yet/)).toBeInTheDocument()
  })

  it('renders without a flow model', async () => {
    mockWith({})
    render(<Balancing />)
    expect(await screen.findByText('Lounge')).toBeInTheDocument()
    expect(screen.queryByText('Flow model')).not.toBeInTheDocument()
  })

  it('marks a lifted maximum opening', async () => {
    mockWith({ lounge: { max_opening_pct: 60, max_opening_source: 'probe', max_opening_lifted: true } })
    render(<Balancing />)
    expect(await screen.findByText('60% (lifted)')).toBeInTheDocument()
  })
})
