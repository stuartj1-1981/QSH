import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSnapshots } from '../useSnapshots'

const SNAP1 = {
  snapshot_id: '2026-05-07T10:00:00.000000Z',
  captured_at: 1746619200,
  size_bytes: 1234,
  trigger_path: 'settings_patch',
}

const SNAP2 = {
  snapshot_id: '2026-05-07T11:00:00.000000Z',
  captured_at: 1746622800,
  size_bytes: 1240,
  trigger_path: 'wizard_deploy',
}

const LIST_RESPONSE = {
  retention_count: 5,
  snapshots: [SNAP2, SNAP1],
}

describe('useSnapshots', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape after initial fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => LIST_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useSnapshots())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data?.retention_count).toBe(5)
    expect(result.current.data?.snapshots).toHaveLength(2)
    expect(result.current.data?.snapshots[0].snapshot_id).toBe(
      SNAP2.snapshot_id,
    )
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useSnapshots())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
  })

  it('fetchDiff calls correct endpoint and returns entries', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          snapshot_id: SNAP1.snapshot_id,
          entries: [
            {
              path: 'energy.electricity.octopus_api_key',
              old: 'sk_a',
              new: 'sk_b',
              is_secret: true,
            },
          ],
        }),
      } as Response)

    const { result } = renderHook(() => useSnapshots())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let entries
    await act(async () => {
      entries = await result.current.fetchDiff(SNAP1.snapshot_id)
    })

    const diffCall = fetchSpy.mock.calls[1]
    expect((diffCall[0] as string)).toContain(
      `api/config/snapshots/${encodeURIComponent(SNAP1.snapshot_id)}/diff`,
    )
    expect(entries).toEqual([
      {
        path: 'energy.electricity.octopus_api_key',
        old: 'sk_a',
        new: 'sk_b',
        is_secret: true,
      },
    ])
  })

  it('revert calls correct endpoint with confirm_timestamp body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reverted_to: SNAP1,
          pre_revert_snapshot: SNAP2,
          restart_required: true,
          message: 'ok',
        }),
      } as Response)
      // refetch after success
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)

    const { result } = renderHook(() => useSnapshots())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.revert(SNAP1.snapshot_id, SNAP1.snapshot_id)
    })

    const revertCall = fetchSpy.mock.calls[1]
    expect((revertCall[0] as string)).toContain(
      `api/config/snapshots/${encodeURIComponent(SNAP1.snapshot_id)}/revert`,
    )
    const opts = revertCall[1] as RequestInit
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({
      confirm_timestamp: SNAP1.snapshot_id,
    })
  })

  it('purge calls correct endpoint with PURGE_ALL body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)

    const { result } = renderHook(() => useSnapshots())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let count
    await act(async () => {
      count = await result.current.purge()
    })
    expect(count).toBe(3)

    const purgeCall = fetchSpy.mock.calls[1]
    expect((purgeCall[0] as string)).toContain('api/config/snapshots/purge')
    const opts = purgeCall[1] as RequestInit
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ confirm: 'PURGE_ALL' })
  })

  it('revert error surfaces detail string', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => LIST_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'confirm_timestamp must exactly match' }),
      } as Response)

    const { result } = renderHook(() => useSnapshots())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let captured: unknown = null
    await act(async () => {
      try {
        await result.current.revert(SNAP1.snapshot_id, 'wrong')
      } catch (e) {
        captured = e
      }
    })
    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).message).toContain('confirm_timestamp')
  })
})
