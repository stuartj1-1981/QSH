import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHistorianMeasurements, useHistorianQuery, useHistorianFields, useHistorianEvents } from '../useHistorian'
import { apiUrl } from '../../lib/api'
import type { HistorianEventsResponse } from '../../types/api'

describe('useHistorianMeasurements', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['outdoor_temp', 'hp_power_kw'] },
          { name: 'qsh_room', fields: ['temperature', 'target'] },
        ],
      }),
    } as Response)

    const { result } = renderHook(() => useHistorianMeasurements())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data?.available).toBe(true)
    expect(result.current.data?.measurements).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'))

    const { result } = renderHook(() => useHistorianMeasurements())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Connection refused')
  })

  it('handles not-configured state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: false,
        message: 'Historian not configured.',
        measurements: [],
      }),
    } as Response)

    const { result } = renderHook(() => useHistorianMeasurements())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data?.available).toBe(false)
  })
})

describe('useHistorianQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns query data when measurement and fields provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        measurement: 'qsh_system',
        fields: ['outdoor_temp'],
        tags: {},
        points: [{ t: 1700000000, outdoor_temp: 10.5 }],
        aggregation: 'mean',
        interval: '5m',
      }),
    } as Response)

    const { result } = renderHook(() =>
      useHistorianQuery('qsh_system', ['outdoor_temp']),
    )

    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    expect(result.current.data?.points).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Timeout'))

    const { result } = renderHook(() =>
      useHistorianQuery('qsh_system', ['outdoor_temp']),
    )

    await waitFor(() => {
      expect(result.current.error).toBe('Timeout')
    })
  })

  it('does not fetch when measurement is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    renderHook(() => useHistorianQuery('', []))

    // Give time for any potential async operations
    await new Promise((r) => setTimeout(r, 50))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('constructs URL with room parameter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ points: [] }),
    } as Response)

    renderHook(() =>
      useHistorianQuery('qsh_room', ['temperature'], { room: 'lounge' }),
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('room=lounge')
    expect(calledUrl).toContain('measurement=qsh_room')
  })

  it('includes hw_active query param when hwActive option is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ points: [] }),
    } as Response)

    renderHook(() =>
      useHistorianQuery('qsh_system', ['cop'], { hwActive: 'false' }),
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('hw_active=false')
  })

  it('omits hw_active query param when hwActive option is not set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ points: [] }),
    } as Response)

    renderHook(() => useHistorianQuery('qsh_system', ['cop']))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).not.toContain('hw_active')
  })
})

// INSTRUCTION-541B — this hook's first coverage (§2.1: no prior test named it).
describe('useHistorianFields', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // H1
  it('carries field_types alongside fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        fields: ['temperature', 'fabric_loss_basis'],
        field_types: { temperature: 'numeric', fabric_loss_basis: 'text' },
      }),
    } as Response)

    const { result } = renderHook(() => useHistorianFields('qsh_room'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.fields).toEqual(['temperature', 'fabric_loss_basis'])
    expect(result.current.fieldTypes).toEqual({
      temperature: 'numeric',
      fabric_loss_basis: 'text',
    })
  })

  // H2 — D1's evidence, and OB-01's.
  it('defaults fieldTypes to {} when the backend reports no classes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        fields: ['outdoor_temp'],
      }),
    } as Response)

    const { result } = renderHook(() => useHistorianFields('qsh_system'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.fields).toEqual(['outdoor_temp'])
    expect(result.current.fieldTypes).toEqual({})
  })

  // H3 — the AbortError guard must discriminate: an abort must not clear
  // loading, a real rejection must. Asserting the two independently (as V3
  // did) is satisfied by an implementation with the `.catch` body deleted.
  it('discriminates an aborted fetch from a real rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError'),
    )
    const { result: aborted } = renderHook(() => useHistorianFields('qsh_system'))
    await new Promise((r) => setTimeout(r, 20))
    expect(aborted.current.loading).toBe(true)
    expect(aborted.current.fieldTypes).toEqual({})

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'))
    const { result: rejected } = renderHook(() => useHistorianFields('qsh_system'))
    await waitFor(() => {
      expect(rejected.current.loading).toBe(false)
    })
    expect(rejected.current.fieldTypes).toEqual({})
  })

  // H4 — CLAUDE.md mandates a URL assertion for every hook.
  it('fetches the URL built by apiUrl with the measurement interpolated', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ available: true, fields: [] }),
    } as Response)

    renderHook(() => useHistorianFields('qsh_room'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    expect(fetchSpy.mock.calls[0][0]).toBe(apiUrl('api/historian/fields?measurement=qsh_room'))
  })
})

// INSTRUCTION-565D — the event-record read. The fixtures are typed as the
// response contract in types/api.ts, so the tsc gate checks them against it.
describe('useHistorianEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // As the route returns them: newest first, every row with its tag values;
  // `t` is the row time and `timestamp` the event time.
  const alarmEvents: HistorianEventsResponse = {
    measurement: 'qsh_alarm_event',
    rows: [
      {
        t: 1790000300,
        timestamp: 1790000150.4,
        payload_json: '{"room_temp": 16.2}',
        alarm_id: 'A',
        severity: 'notification',
        room: 'lounge',
        comparator_mode: '_none',
      },
      {
        t: 1789990300,
        timestamp: 1789990150.9,
        payload_json: '{}',
        alarm_id: 'B',
        severity: 'notification',
        room: '_installation',
        comparator_mode: '_none',
      },
    ],
    truncated: false,
  }

  const reconciliationEvents: HistorianEventsResponse = {
    measurement: 'qsh_forecast_reconciliation',
    rows: [
      {
        t: 1790000300,
        predicted: 20.4,
        actual: 20.1,
        error_c: 0.3,
        prediction_target_ts: 1790000100,
        basis_summary: 'oat=4.0',
        basis_hash: '9f2c1a',
        controller: 'valve_controller',
        room: 'lounge',
        oat_class: 'cold',
        solar_class: 'low',
        wind_class: 'calm',
      },
    ],
    truncated: false,
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('returns the rows of the response as data, with error null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(alarmEvents))

    const { result } = renderHook(() => useHistorianEvents('qsh_alarm_event'))

    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    expect(result.current.data).toEqual(alarmEvents)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('is loading while the request is in flight, and not after', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { result } = renderHook(() => useHistorianEvents('qsh_alarm_event'))

    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })
    expect(result.current.data).toBeNull()

    resolveFetch(jsonResponse(alarmEvents))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.data?.rows).toEqual(alarmEvents.rows)
  })

  it('requests measurement and from=-7d through apiUrl, with no room or controller when not given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(alarmEvents))

    const { result } = renderHook(() => useHistorianEvents('qsh_alarm_event'))

    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    const prefix = apiUrl('api/historian/events?')
    const calledUrl = String(fetchSpy.mock.calls[0][0])
    expect(calledUrl.slice(0, prefix.length)).toBe(prefix)
    const params = new URLSearchParams(calledUrl.slice(prefix.length))
    expect(params.get('measurement')).toBe('qsh_alarm_event')
    expect(params.get('from')).toBe('-7d')
    expect(params.has('room')).toBe(false)
    expect(params.has('controller')).toBe(false)
  })

  it('adds room and controller to the request when given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(reconciliationEvents))

    const { result } = renderHook(() =>
      useHistorianEvents('qsh_forecast_reconciliation', {
        room: 'lounge',
        controller: 'valve_controller',
        timeFrom: '-24h',
      }),
    )

    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    const prefix = apiUrl('api/historian/events?')
    const calledUrl = String(fetchSpy.mock.calls[0][0])
    expect(calledUrl.slice(0, prefix.length)).toBe(prefix)
    const params = new URLSearchParams(calledUrl.slice(prefix.length))
    expect(params.get('measurement')).toBe('qsh_forecast_reconciliation')
    expect(params.get('from')).toBe('-24h')
    expect(params.get('room')).toBe('lounge')
    expect(params.get('controller')).toBe('valve_controller')
  })

  it('reports the error a 200 response carries in its body', async () => {
    const notConfigured: HistorianEventsResponse = {
      error: 'Historian not configured. Enable in qsh.yaml historian section.',
      rows: [],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(notConfigured))

    const { result } = renderHook(() => useHistorianEvents('qsh_alarm_event'))

    await waitFor(() => {
      expect(result.current.error).toBe(
        'Historian not configured. Enable in qsh.yaml historian section.',
      )
    })
    expect(result.current.data).toEqual(notConfigured)
    expect(result.current.loading).toBe(false)
  })

  it('reports the detail of a 400 and sets data to null', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(alarmEvents))
      // FastAPI's body for a request the route refuses.
      .mockResolvedValueOnce(jsonResponse({ detail: "malformed room: 'living room'" }, 400))

    const initialProps: { room: string | undefined } = { room: undefined }
    const { result, rerender } = renderHook(
      ({ room }) => useHistorianEvents('qsh_alarm_event', { room }),
      { initialProps },
    )

    // A first, accepted request leaves data set, so the null asserted below
    // is the refusal's doing and not the initial state.
    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    rerender({ room: 'living room' })

    await waitFor(() => {
      expect(result.current.error).toBe("malformed room: 'living room'")
    })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it("reports 'HTTP 502' for a 502 whose body is not JSON", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const { result } = renderHook(() => useHistorianEvents('qsh_alarm_event'))

    await waitFor(() => {
      expect(result.current.error).toBe('HTTP 502')
    })
    expect(result.current.loading).toBe(false)
  })

  it('reports the message of a rejected fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { result } = renderHook(() => useHistorianEvents('qsh_alarm_event'))

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to fetch')
    })
    expect(result.current.loading).toBe(false)
  })

  it('does not fetch when measurement is empty', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no request expected'))

    const { result } = renderHook(() => useHistorianEvents(''))

    // Give any request the hook might start time to be made.
    await new Promise((r) => setTimeout(r, 50))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
  })
})
