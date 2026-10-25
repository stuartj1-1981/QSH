import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSwarmUnitId } from '../useSwarmUnitId'
import { apiUrl } from '../../lib/api'

function stubFetch(body: unknown) {
  const stub = vi.fn().mockResolvedValue({ json: () => Promise.resolve(body) })
  vi.stubGlobal('fetch', stub)
  return stub
}

describe('useSwarmUnitId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with no ID and no failure', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { result } = renderHook(() => useSwarmUnitId())
    expect(result.current).toEqual({ unitId: null, failed: false })
  })

  it('reads the unit ID from the local swarm status, once', async () => {
    const stub = stubFetch({ enabled: true, unit_id: 'unit-zz99-0001' })
    const { result } = renderHook(() => useSwarmUnitId())
    await waitFor(() => expect(result.current.unitId).toBe('unit-zz99-0001'))
    expect(result.current.failed).toBe(false)
    expect(stub).toHaveBeenCalledTimes(1)
    expect(stub.mock.calls[0][0]).toBe(apiUrl('api/swarm/status'))
  })

  it('gives no ID and no failure when the unit has no swarm identity', async () => {
    const json = vi.fn().mockResolvedValue({ enabled: false, unit_id: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json }))
    const { result } = renderHook(() => useSwarmUnitId())
    await waitFor(() => expect(json).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current).toEqual({ unitId: null, failed: false }))
  })

  it('reports a failure when the read is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
    const { result } = renderHook(() => useSwarmUnitId())
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.unitId).toBeNull()
  })

  it('reports a failure when the payload holds no unit_id field', async () => {
    stubFetch({ enabled: true })
    const { result } = renderHook(() => useSwarmUnitId())
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.unitId).toBeNull()
  })

  it('reports a failure when unit_id is not a string or null', async () => {
    stubFetch({ unit_id: 42 })
    const { result } = renderHook(() => useSwarmUnitId())
    await waitFor(() => expect(result.current.failed).toBe(true))
  })
})
