/**
 * INSTRUCTION-150E V3 150E-V2-M3:
 *
 * useLive() runtime-parse integration tests. Asserts that
 * cycleSnapshotSchema.safeParse() gates every WebSocket payload, and that
 * malformed payloads keep the last-known-good snapshot rather than
 * propagating untyped data to component consumers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useLive } from '../useLive'

// MockWebSocket lets us drive onmessage / onopen / onclose from tests.
class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  readyState = 0
  url: string
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  close() {
    this.readyState = 3
    if (this.onclose) this.onclose({} as CloseEvent)
  }
  send() {}
  triggerOpen() {
    this.readyState = 1
    if (this.onopen) this.onopen({} as Event)
  }
  triggerMessage(data: string) {
    if (this.onmessage) this.onmessage({ data } as MessageEvent)
  }
}

const VALID_SNAPSHOT = {
  type: 'cycle',
  cycle_number: 42,
  status: { operating_state: 'Heating' },
  tariff_providers_status: {
    electricity: {
      fuel: 'electricity',
      provider_kind: 'octopus_electricity',
      last_refresh_at: 1745236800,
      stale: false,
      last_price: 0.245,
      source_url: null,
      last_error: null,
      tariff_label: 'Octopus Agile',
    },
  },
  available_provider_kinds: ['octopus_electricity', 'fixed', 'fallback'],
}

beforeEach(() => {
  MockWebSocket.instances = []
  // @ts-expect-error — overriding the global WebSocket for this test scope.
  globalThis.WebSocket = MockWebSocket
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLive — runtime parse integration', () => {
  it('propagates a valid CycleSnapshot to consumers', async () => {
    const { result } = renderHook(() => useLive())
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.triggerOpen()
      ws.triggerMessage(JSON.stringify(VALID_SNAPSHOT))
    })
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.data?.cycle_number).toBe(42)
    expect(result.current.data?.tariff_providers_status?.electricity?.tariff_label).toBe('Octopus Agile')
  })

  it('keeps last-known-good snapshot when WebSocket sends invalid JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useLive())
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.triggerOpen()
      ws.triggerMessage(JSON.stringify(VALID_SNAPSHOT))
    })
    await waitFor(() => expect(result.current.data?.cycle_number).toBe(42))

    // Now send garbage JSON. The hook must keep the prior snapshot.
    act(() => {
      ws.triggerMessage('{ this is not valid json')
    })
    expect(result.current.data?.cycle_number).toBe(42)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('was not valid JSON'),
    )
    warnSpy.mockRestore()
  })

  it('keeps last-known-good snapshot when payload fails schema validation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useLive())
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.triggerOpen()
      ws.triggerMessage(JSON.stringify(VALID_SNAPSHOT))
    })
    await waitFor(() => expect(result.current.data?.cycle_number).toBe(42))

    // Send a payload with a bogus provider_kind enum value — Zod must reject.
    const malformed = {
      ...VALID_SNAPSHOT,
      cycle_number: 99,
      tariff_providers_status: {
        electricity: {
          ...VALID_SNAPSHOT.tariff_providers_status.electricity,
          provider_kind: 'mystery_provider_v9',
        },
      },
    }
    act(() => {
      ws.triggerMessage(JSON.stringify(malformed))
    })
    // Cycle number stays at 42 — malformed payload was rejected.
    expect(result.current.data?.cycle_number).toBe(42)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed schema validation'),
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it('console.warn fires once per malformed payload', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHook(() => useLive())
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.triggerOpen()
      ws.triggerMessage('garbage')
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})
