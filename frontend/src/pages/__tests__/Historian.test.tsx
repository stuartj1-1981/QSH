import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Historian } from '../Historian'

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
}))

describe('Historian page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['outdoor_temp'] }],
        fields: ['outdoor_temp'],
        tags: { room: [] },
      }),
    } as Response)

    render(<Historian />)
    expect(screen.getByText('Historian')).toBeInTheDocument()
  })

  it('shows not-configured message when historian unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: false,
        message: 'Historian not configured.',
        measurements: [],
        fields: [],
        tags: {},
      }),
    } as Response)

    render(<Historian />)

    // Wait for the "not configured" message to appear
    const message = await screen.findByText(/not configured/i)
    expect(message).toBeInTheDocument()
  })

  it('renders measurement selector', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['outdoor_temp'] },
          { name: 'qsh_room', fields: ['temperature'] },
        ],
        fields: ['outdoor_temp'],
        tags: { room: [] },
      }),
    } as Response)

    render(<Historian />)

    const label = await screen.findByText('Measurement')
    expect(label).toBeInTheDocument()
  })

  // ===========================================================================
  // INSTRUCTION-224E — qsh_emitter measurement support
  // ===========================================================================

  /** Route-aware fetch mock — different responses for measurements/tags/fields. */
  function _mockFetchByUrl(handlers: Record<string, unknown>) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString()
      for (const [pattern, body] of Object.entries(handlers)) {
        if (url.includes(pattern)) {
          return Promise.resolve({
            ok: true,
            json: async () => body,
          } as Response)
        }
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ available: true, measurements: [], fields: [], tags: {} }),
      } as Response)
    })
  }

  it('qsh_emitter is selectable from the measurement dropdown', async () => {
    _mockFetchByUrl({
      'api/historian/measurements': {
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['outdoor_temp'] },
          { name: 'qsh_room', fields: ['temperature', 'valve_pct'] },
          { name: 'qsh_emitter', fields: ['valve_open'] },
        ],
      },
      'api/historian/fields?measurement=qsh_system': {
        available: true,
        fields: ['outdoor_temp'],
      },
      'api/historian/tags?measurement=qsh_system': {
        available: true,
        tags: {},
      },
    })

    render(<Historian />)
    // Wait for the dropdown to populate from the measurements fetch.
    const option = await screen.findByRole('option', { name: 'qsh_emitter' })
    expect(option).toBeInTheDocument()
  })

  it('selecting qsh_emitter exposes the emitter filter dropdown', async () => {
    _mockFetchByUrl({
      'api/historian/measurements': {
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['outdoor_temp'] },
          { name: 'qsh_emitter', fields: ['valve_open'] },
        ],
      },
      'api/historian/fields?measurement=qsh_emitter': {
        available: true,
        fields: ['valve_open'],
      },
      'api/historian/tags?measurement=qsh_emitter': {
        available: true,
        tags: {
          room: ['open_plan', 'kitchen'],
          emitter: ['dining_trv', 'sitting_room_trv', 'kitchen_trv'],
        },
      },
    })

    render(<Historian />)
    // Wait for the dropdown to populate then switch the selection.
    const option = await screen.findByRole('option', { name: 'qsh_emitter' })
    expect(option).toBeInTheDocument()
    // The first <select> on the page is the Measurement selector. Its initial
    // value is the default `qsh_system`; switching it to `qsh_emitter` triggers
    // the tags fetch for the new measurement.
    const selects = screen.getAllByRole('combobox')
    const measurementSelect = selects[0] as HTMLSelectElement
    fireEvent.change(measurementSelect, { target: { value: 'qsh_emitter' } })

    const emitterLabel = await screen.findByText('Emitter')
    expect(emitterLabel).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'dining_trv' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'sitting_room_trv' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'kitchen_trv' })).toBeInTheDocument()
  })

  it('exposes both room and emitter filters when both tags are present', async () => {
    _mockFetchByUrl({
      'api/historian/measurements': {
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['outdoor_temp'] },
          { name: 'qsh_emitter', fields: ['valve_open'] },
        ],
      },
      'api/historian/fields?measurement=qsh_emitter': {
        available: true,
        fields: ['valve_open'],
      },
      'api/historian/tags?measurement=qsh_emitter': {
        available: true,
        tags: {
          room: ['open_plan', 'kitchen'],
          emitter: ['dining_trv', 'sitting_room_trv', 'kitchen_a_trv', 'kitchen_b_trv'],
        },
      },
    })

    render(<Historian />)
    const option = await screen.findByRole('option', { name: 'qsh_emitter' })
    expect(option).toBeInTheDocument()
    // The first <select> on the page is the Measurement selector. Its initial
    // value is the default `qsh_system`; switching it to `qsh_emitter` triggers
    // the tags fetch for the new measurement.
    const selects = screen.getAllByRole('combobox')
    const measurementSelect = selects[0] as HTMLSelectElement
    fireEvent.change(measurementSelect, { target: { value: 'qsh_emitter' } })

    // Two filter labels surface — `Room` (existing) and `Emitter` (224E).
    expect(await screen.findByText('Room')).toBeInTheDocument()
    expect(screen.getByText('Emitter')).toBeInTheDocument()
    // V2 L5 disposition: full multi-trace per (room, emitter) rendering
    // requires a backend GROUP BY tags extension that is out of 224E scope.
    // The Emitter filter dropdown lets the operator narrow trends to a
    // single emitter; the chart renders one trace per selected field for
    // the filtered series — same pattern as qsh_room.
  })
})
