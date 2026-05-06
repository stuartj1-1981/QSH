import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { LiveProvider } from '../hooks/LiveProvider'

// jsdom does not implement WebSocket. useLive constructs one on mount; stub
// the global so the constructor and its handlers exist as no-ops, otherwise
// rendering <App /> in normal mode throws on the WebSocket reference.
class StubWebSocket {
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  close() { /* no-op */ }
  send() { /* no-op */ }
}

beforeEach(() => {
  ;(globalThis as unknown as { WebSocket: typeof StubWebSocket }).WebSocket = StubWebSocket
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

const NORMAL_STATUS_BODY = {
  setup_mode: false,
  cycle_number: 0,
  operating_state: 'Heating',
  control_enabled: false,
}

const SETUP_STATUS_BODY = {
  setup_mode: true,
  cycle_number: 0,
  operating_state: 'Setup',
  control_enabled: false,
}

const VALID_CONFIG_BODY = {
  rooms: {},
  heat_source: { type: 'heat_pump' },
}

// Route fetch by URL substring. Unknown URLs resolve to an empty 200 so
// secondary hooks (useVersion, useHistory, useRawConfig, etc.) do not crash
// the App-level routing test under jsdom.
function makeFetchSpy(statusBody: object, configBody: object) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('api/status')) {
      return { ok: true, status: 200, json: async () => statusBody } as Response
    }
    if (url.includes('api/config')) {
      return { ok: true, status: 200, json: async () => configBody } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  })
}

describe('App — INSTRUCTION-142 setup-mode routing', () => {
  it('routes to Wizard when /api/status reports setup_mode=true', async () => {
    makeFetchSpy(SETUP_STATUS_BODY, VALID_CONFIG_BODY)

    render(<App />, { wrapper: LiveProvider })

    await waitFor(() => {
      expect(screen.getByText('QSH Setup Wizard')).toBeDefined()
    })
  })

  it('does not redirect to Wizard when setup_mode=false and config is valid', async () => {
    makeFetchSpy(NORMAL_STATUS_BODY, VALID_CONFIG_BODY)

    render(<App />, { wrapper: LiveProvider })

    // Home renders the connection indicator with "Reconnecting..." until the
    // WebSocket connects (the stubbed ws never invokes onopen).
    await waitFor(() => {
      expect(screen.getByText('Reconnecting...')).toBeDefined()
    })

    expect(screen.queryByText('QSH Setup Wizard')).toBeNull()
  })
})
