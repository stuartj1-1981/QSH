import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useComfortSchedule, useUpdateComfortSchedule } from '../useComfortSchedule'

const mockSchedule = {
  enabled: true,
  periods: [
    { from: '07:00', to: '22:00', temp: 20.0 },
    { from: '22:00', to: '07:00', temp: 17.0 },
  ],
  active_temp: 20.0,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useComfortSchedule', () => {
  it('fetches schedule data on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSchedule),
    } as Response)

    const { result } = renderHook(() => useComfortSchedule())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(mockSchedule)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useComfortSchedule())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Network error')
  })
})

describe('useUpdateComfortSchedule', () => {
  it('calls PUT with correct endpoint and body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSchedule),
    } as Response)

    const { result } = renderHook(() => useUpdateComfortSchedule())

    await result.current.update(true, mockSchedule.periods)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api/comfort-schedule'),
      expect.objectContaining({
        method: 'PUT',
        body: expect.any(String),
      })
    )
  })

  it('calls PATCH enabled with correct endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ enabled: false, periods: [] }),
    } as Response)

    const { result } = renderHook(() => useUpdateComfortSchedule())

    await result.current.setEnabled(false)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api/comfort-schedule/enabled'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      })
    )
  })
})
