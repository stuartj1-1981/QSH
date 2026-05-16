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

const CONFIG_NOT_LOADED_BODY = {
  error: 'Config not yet loaded',
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

// V1.5 finding 4 / Task 4: per-branch overrides for the /api/status response
// so the new cases below can simulate a throw, a 500, or a null body without
// rewriting the helper for every shape.
type StatusOverride = 'throw' | 'non-ok' | 'null-body'

function makeFetchSpyV2(
  statusBody: object | null,
  configBody: object,
  statusOverride?: StatusOverride,
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('api/status')) {
      if (statusOverride === 'throw') {
        throw new Error('network error')
      }
      if (statusOverride === 'non-ok') {
        return { ok: false, status: 500, json: async () => ({ detail: 'error' }) } as Response
      }
      if (statusOverride === 'null-body') {
        return { ok: true, status: 200, json: async () => null } as unknown as Response
      }
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

describe('App — INSTRUCTION-240 wizard redirect tightening', () => {
  it('does NOT redirect to Wizard when /api/status reports setup_mode=false even if /api/config returns "Config not yet loaded"', async () => {
    // The exact regression case: backend cycle 1 has not yet published
    // HOUSE_CONFIG to shared_state, so /api/config returns the "not yet
    // loaded" sentinel. /api/status correctly reports setup_mode=false.
    // Pre-240 the App fell through to /api/config and routed to the wizard.
    // Post-240 the /api/status answer is authoritative and the redirect
    // logic terminates without consulting /api/config.
    makeFetchSpy(NORMAL_STATUS_BODY, CONFIG_NOT_LOADED_BODY)

    render(<App />, { wrapper: LiveProvider })

    await waitFor(() => {
      expect(screen.getByText('Reconnecting...')).toBeDefined()
    })

    expect(screen.queryByText('QSH Setup Wizard')).toBeNull()
  })

  it('DOES redirect to Wizard when /api/status throws AND /api/config returns "Config not yet loaded"', async () => {
    // Confirms the fallback still works when /api/status is genuinely
    // unreachable (network error / fetch threw).
    makeFetchSpyV2(null, CONFIG_NOT_LOADED_BODY, 'throw')

    render(<App />, { wrapper: LiveProvider })

    await waitFor(() => {
      expect(screen.getByText('QSH Setup Wizard')).toBeDefined()
    })
  })

  it('does NOT redirect to Wizard when /api/status returns 500 AND /api/config returns valid config', async () => {
    // Confirms the fallback is conservative: a /api/status failure alone
    // is not enough — it requires the explicit "Config not yet loaded"
    // error string from /api/config to redirect.
    makeFetchSpyV2(null, VALID_CONFIG_BODY, 'non-ok')

    render(<App />, { wrapper: LiveProvider })

    await waitFor(() => {
      expect(screen.getByText('Reconnecting...')).toBeDefined()
    })

    expect(screen.queryByText('QSH Setup Wizard')).toBeNull()
  })

  it('does NOT redirect to Wizard when /api/status returns 200 with body=null AND /api/config returns valid config', async () => {
    // V1.5 finding 4: malformed status body (null) falls through to the
    // /api/config block (the conservative branch named in App.tsx's
    // comment). With valid config, no redirect fires.
    makeFetchSpyV2(null, VALID_CONFIG_BODY, 'null-body')

    render(<App />, { wrapper: LiveProvider })

    await waitFor(() => {
      expect(screen.getByText('Reconnecting...')).toBeDefined()
    })

    expect(screen.queryByText('QSH Setup Wizard')).toBeNull()
  })
})
