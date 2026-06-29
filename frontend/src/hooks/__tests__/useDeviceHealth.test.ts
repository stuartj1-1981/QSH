import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDeviceHealth } from '../useDeviceHealth'

const MOCK_RESPONSE = {
  devices: {
    'sensor.living_trv_battery': { room: 'living', soc: 82, status: 'ok' as const, weeks_remaining: '>12w' },
    'sensor.hall_trv_battery': { room: 'hall', soc: 14, status: 'low' as const, weeks_remaining: '<4w' },
  },
  low_count: 1,
}

describe('useDeviceHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useDeviceHealth())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).not.toBeNull()
    expect(result.current.data?.low_count).toBe(1)
    expect(result.current.data?.devices['sensor.hall_trv_battery'].status).toBe('low')
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useDeviceHealth())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
  })

  it('fetches the ingress-aware devices/health URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useDeviceHealth())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(fetchSpy.mock.calls[0][0] as string).toContain('api/devices/health')
  })
})
