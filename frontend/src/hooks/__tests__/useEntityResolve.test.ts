import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useEntityResolve } from '../useEntityResolve'

describe('useEntityResolve', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches entity resolution for HA driver (default)', async () => {
    const mockEntities = {
      'sensor.temp': { friendly_name: 'Temperature', state: '21.5', unit: '°C' },
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entities: mockEntities }),
    } as Response)

    const { result } = renderHook(() =>
      useEntityResolve(['sensor.temp'])
    )

    await waitFor(() => {
      expect(result.current.resolved).toEqual(mockEntities)
    })
  })

  it('fetches when driver is undefined (backwards compatible)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entities: {} }),
    } as Response)

    renderHook(() => useEntityResolve(['sensor.temp'], undefined))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('fetches when driver is ha', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entities: {} }),
    } as Response)

    renderHook(() => useEntityResolve(['sensor.temp'], 'ha'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('does NOT fetch when driver is mqtt', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entities: {} }),
    } as Response)

    const { result } = renderHook(() =>
      useEntityResolve(['sensor.temp'], 'mqtt')
    )

    // Give the effect a chance to fire
    await new Promise((r) => setTimeout(r, 50))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.resolved).toEqual({})
    expect(result.current.loading).toBe(false)
  })

  it('returns empty resolved when entityIds is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { result } = renderHook(() => useEntityResolve([]))

    await new Promise((r) => setTimeout(r, 50))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.resolved).toEqual({})
  })
})
