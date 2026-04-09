import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useExternalSetpoints } from '../useExternalSetpoints'

const MOCK_DATA = {
  comfort_temp: 'input_number.comfort_temp',
  flow_min_temp: 'input_number.flow_min',
  flow_max_temp: 'input_number.flow_max',
  antifrost_oat_threshold: '',
  shoulder_threshold: 'input_number.shoulder',
  overtemp_protection: '',
}

describe('useExternalSetpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches external setpoints on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_DATA,
    } as Response)

    const { result } = renderHook(() => useExternalSetpoints())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual(MOCK_DATA)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    const { result } = renderHook(() => useExternalSetpoints())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('HTTP 500')
    expect(result.current.data).toBeNull()
  })

  it('save sends PATCH with partial updates', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_DATA,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...MOCK_DATA, comfort_temp: 'input_number.x' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...MOCK_DATA, comfort_temp: 'input_number.x' }),
      } as Response)

    const { result } = renderHook(() => useExternalSetpoints())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.save({ comfort_temp: 'input_number.x' })
    })

    const patchCall = fetchSpy.mock.calls[1]
    expect((patchCall[0] as string)).toContain('api/control/external-setpoints')
    const opts = patchCall[1] as RequestInit
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body as string)).toEqual({ comfort_temp: 'input_number.x' })
  })

  it('save refetches after success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_DATA,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_DATA,
      } as Response)

    const { result } = renderHook(() => useExternalSetpoints())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.save({ comfort_temp: 'input_number.x' })
    })

    // Initial GET + PATCH + refetch GET = 3 calls
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('save sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_DATA,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'No fields' }),
      } as Response)

    const { result } = renderHook(() => useExternalSetpoints())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.save({ comfort_temp: '' })
    })

    expect(result.current.error).toBe('No fields')
  })

  it('loading states', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_DATA,
    } as Response)

    const { result } = renderHook(() => useExternalSetpoints())

    // Initially loading
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Saving state
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_DATA,
      } as Response)

    let savePromise: Promise<void>
    act(() => {
      savePromise = result.current.save({ comfort_temp: 'x' })
    })

    // saving should be true during the save
    expect(result.current.saving).toBe(true)

    await act(async () => {
      await savePromise!
    })

    expect(result.current.saving).toBe(false)
  })
})
