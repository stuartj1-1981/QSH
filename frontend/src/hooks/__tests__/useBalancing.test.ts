import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBalancing } from '../useBalancing'

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
      balance_offset: 0,
      control_mode: 'direct' as const,
      balance_status: 'automatic' as const,
      notification_disabled: false,
    },
    bedroom: {
      normalised_rate: 0.004,
      imbalance_ratio: -0.05,
      consecutive_imbalanced: 0,
      observations: 6,
      stability: 0.15,
      recommendation_pending: false,
      recommendation_text: '',
      recommendations_given: 0,
      balance_offset: 0,
      control_mode: 'indirect' as const,
      balance_status: 'balanced' as const,
      notification_disabled: false,
    },
  },
  imbalanced_count: 0,
  total_observations: 14,
}

describe('useBalancing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useBalancing())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).not.toBeNull()
    expect(result.current.data?.rooms.lounge.balance_status).toBe('automatic')
    expect(result.current.data?.rooms.bedroom.balance_status).toBe('balanced')
    expect(result.current.data?.total_observations).toBe(14)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useBalancing())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
  })

  it('setNotificationDisabled calls correct endpoint', async () => {
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

    const { result } = renderHook(() => useBalancing())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.setNotificationDisabled('bedroom', true)
    })

    // Second call is the PATCH
    const patchCall = fetchSpy.mock.calls[1]
    expect((patchCall[0] as string)).toContain('api/balancing/bedroom/notifications')
    const opts = patchCall[1] as RequestInit
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body as string)).toEqual({ disabled: true })
  })
})
