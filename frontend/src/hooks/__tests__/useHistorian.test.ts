import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHistorianMeasurements, useHistorianQuery, useHistorianFields } from '../useHistorian'
import { apiUrl } from '../../lib/api'

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
