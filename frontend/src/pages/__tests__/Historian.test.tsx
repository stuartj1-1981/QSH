import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
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
        field_types: { outdoor_temp: 'numeric' },
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
        field_types: { valve_open: 'boolean' },
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
        field_types: { valve_open: 'boolean' },
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

  // ===========================================================================
  // INSTRUCTION-526B T3/T5 — room filter shows a label only where a
  // configured room has one; retired keys and unlabelled configured rooms
  // both render as themselves.
  // ===========================================================================

  it('labels a configured room with a display_name, and shows the raw key for an unlabelled configured room and a retired key', async () => {
    _mockFetchByUrl({
      'api/historian/measurements': {
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['outdoor_temp'] }],
      },
      'api/historian/fields?measurement=qsh_system': {
        available: true,
        fields: ['outdoor_temp'],
        field_types: { outdoor_temp: 'numeric' },
      },
      'api/historian/tags?measurement=qsh_system': {
        available: true,
        tags: { room: ['living_room', 'kitchen', 'retired_room'] },
      },
      'api/status/rooms': {
        timestamp: 0,
        rooms: {
          living_room: { display_name: 'Snug' },
          kitchen: {},
        },
      },
    })

    render(<Historian />)
    expect(await screen.findByRole('option', { name: 'Snug' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'kitchen' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'retired_room' })).toBeInTheDocument()
  })

  // ===========================================================================
  // INSTRUCTION-541B — the field-class badge and the coercion note
  // ===========================================================================

  // G1
  it('labels a text field, and leaves a numeric field unlabelled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['outdoor_temp', 'fabric_loss_basis'] }],
        fields: ['outdoor_temp', 'fabric_loss_basis'],
        field_types: { outdoor_temp: 'numeric', fabric_loss_basis: 'text' },
        tags: {},
      }),
    } as Response)

    render(<Historian />)

    const textButton = await screen.findByRole('button', { name: /fabric_loss_basis/i })
    expect(within(textButton).getByText('txt')).toBeInTheDocument()

    const numericButton = screen.getByRole('button', { name: /outdoor_temp/i })
    expect(within(numericButton).queryByText('txt')).not.toBeInTheDocument()
    expect(within(numericButton).queryByText('bool')).not.toBeInTheDocument()
  })

  // G2
  it('labels a boolean field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['outdoor_temp', 'saturation_active'] }],
        fields: ['outdoor_temp', 'saturation_active'],
        field_types: { outdoor_temp: 'numeric', saturation_active: 'boolean' },
        tags: {},
      }),
    } as Response)

    render(<Historian />)

    const boolButton = await screen.findByRole('button', { name: /saturation_active/i })
    expect(within(boolButton).getByText('bool')).toBeInTheDocument()
  })

  // G3 — D1's evidence, and the degrade path 541A produces for a backend
  // that reports no types.
  it('renders no badge anywhere when the fields response carries no field_types', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['outdoor_temp'] }],
        fields: ['outdoor_temp'],
        tags: {},
      }),
    } as Response)

    render(<Historian />)

    const button = await screen.findByRole('button', { name: /outdoor_temp/i })
    expect(within(button).queryByText('txt')).not.toBeInTheDocument()
    expect(within(button).queryByText('bool')).not.toBeInTheDocument()
  })

  // G4 — a field must be toggled first: the query hook returns early while
  // fieldsKey is empty, so queryData is null and the note never mounts.
  it('renders the coercion note only when the response carries coerced_fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['fabric_loss_basis'] }],
        fields: ['fabric_loss_basis'],
        field_types: { fabric_loss_basis: 'text' },
        tags: {},
        points: [{ t: 1700000000, fabric_loss_basis: 'solar' }],
        coerced_fields: { fabric_loss_basis: { requested: 'mean', applied: 'last' } },
      }),
    } as Response)

    render(<Historian />)

    expect(screen.queryByTestId('historian-coercion-note')).not.toBeInTheDocument()

    const button = await screen.findByRole('button', { name: /fabric_loss_basis/i })
    fireEvent.click(button)

    const note = await screen.findByTestId('historian-coercion-note')
    expect(note).toHaveTextContent('fabric_loss_basis')
    expect(note).toHaveTextContent('last value shown in place of mean.')
  })

  // G5 — all three aggregations the selector offers, and D6's evidence: the
  // note names the substitution, never a binding rule (§1.4). D4: the note
  // is driven by the response, not the selection — so the mocked response's
  // own `requested` value is what the assertion checks, independent of
  // whichever aggregation is actually selected on screen.
  it('renders the coercion note for max and for min, naming the substitution', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['fabric_loss_basis'] }],
        fields: ['fabric_loss_basis'],
        field_types: { fabric_loss_basis: 'text' },
        tags: {},
        points: [{ t: 1700000000, fabric_loss_basis: 'solar' }],
        coerced_fields: { fabric_loss_basis: { requested: 'max', applied: 'last' } },
      }),
    } as Response)

    const { unmount } = render(<Historian />)
    const maxButton = await screen.findByRole('button', { name: /fabric_loss_basis/i })
    fireEvent.click(maxButton)
    await waitFor(() => {
      expect(screen.getByTestId('historian-coercion-note')).toHaveTextContent(
        'last value shown in place of max.',
      )
    })
    unmount()
    vi.restoreAllMocks()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [{ name: 'qsh_system', fields: ['fabric_loss_basis'] }],
        fields: ['fabric_loss_basis'],
        field_types: { fabric_loss_basis: 'text' },
        tags: {},
        points: [{ t: 1700000000, fabric_loss_basis: 'solar' }],
        coerced_fields: { fabric_loss_basis: { requested: 'min', applied: 'last' } },
      }),
    } as Response)

    render(<Historian />)
    const minButton = await screen.findByRole('button', { name: /fabric_loss_basis/i })
    fireEvent.click(minButton)
    await waitFor(() => {
      expect(screen.getByTestId('historian-coercion-note')).toHaveTextContent(
        'last value shown in place of min.',
      )
    })
  })

  // G6 — pins T3(e); without it a single JSON value silently adds columns.
  it('quotes CSV cells containing commas, so a JSON-valued field cannot add a column', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['fabric_loss_basis', 'outdoor_temp', 'target'] },
        ],
        fields: ['fabric_loss_basis', 'outdoor_temp', 'target'],
        field_types: { fabric_loss_basis: 'text', outdoor_temp: 'numeric', target: 'numeric' },
        tags: {},
        points: [{ t: 1700000000, fabric_loss_basis: '{"a":1,"b":2}', outdoor_temp: 10.5, target: 20 }],
      }),
    } as Response)

    render(<Historian />)

    for (const name of [/fabric_loss_basis/i, /^outdoor_temp$/i, /^target$/i]) {
      const btn = await screen.findByRole('button', { name })
      fireEvent.click(btn)
    }

    const exportButton = await screen.findByText('CSV')

    let capturedBlob: Blob | null = null
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((obj: Blob | MediaSource) => {
        capturedBlob = obj as Blob
        return 'blob:mock'
      })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    fireEvent.click(exportButton)

    expect(capturedBlob).not.toBeNull()
    const csv = await (capturedBlob as unknown as Blob).text()
    const lines = csv.trim().split('\n')
    const dataRow = lines[1]

    // RFC 4180 parse — a naive split on ',' would give five cells here,
    // because the quoted cell's own content contains a comma (R18(c)).
    const cells: string[] = []
    let i = 0
    while (i <= dataRow.length) {
      if (dataRow[i] === '"') {
        let j = i + 1
        let value = ''
        while (j < dataRow.length) {
          if (dataRow[j] === '"') {
            if (dataRow[j + 1] === '"') {
              value += '"'
              j += 2
              continue
            }
            j += 1
            break
          }
          value += dataRow[j]
          j += 1
        }
        cells.push(value)
        i = j + 1
      } else {
        let j = dataRow.indexOf(',', i)
        if (j === -1) j = dataRow.length
        cells.push(dataRow.slice(i, j))
        i = j + 1
      }
    }

    expect(cells).toHaveLength(4)
    expect(cells[1]).toBe('{"a":1,"b":2}')

    createObjectURLSpy.mockRestore()
  })
})
