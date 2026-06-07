import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useQuarantine } from '../useQuarantine'

const _quarantined = {
  quarantined: true,
  reason: 'flagged: anomalous fabrication pattern',
  contact: 'https://support.example.com',
}

describe('useQuarantine', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the typed shape on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _quarantined,
    } as Response)
    const { result } = renderHook(() => useQuarantine())
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.data?.quarantined).toBe(true)
    expect(result.current.data?.reason).toBe('flagged: anomalous fabrication pattern')
    expect(result.current.data?.contact).toBe('https://support.example.com')
    expect(result.current.error).toBeNull()
  })

  it('sets error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useQuarantine())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toContain('boom')
  })

  it('builds the request URL via apiUrl (ingress-relative)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _quarantined,
    } as Response)
    renderHook(() => useQuarantine())
    await waitFor(() => expect(spy).toHaveBeenCalled())
    // apiUrl('api/swarm/quarantine') resolves to './api/swarm/quarantine' (lib/api.ts).
    expect(spy).toHaveBeenCalledWith('./api/swarm/quarantine')
  })
})
