/**
 * INSTRUCTION-250 Task 7: render-count test for <App />.
 *
 * Asserts that App does NOT re-render on a WebSocket cycle message. The
 * test mocks every page component to render null so the only useLive
 * subscriber in the tree is App's own `useLiveConnection()` call. The
 * render counter is a spy on `useLiveConnection` — App calls it once per
 * function-component render, so spy call count equals App render count.
 *
 * (React.Profiler.onRender was tried first but did not reliably fire on
 * context-driven re-renders under React 19 + Vitest + jsdom; the
 * useLiveConnection spy is the alternative form named in the instruction.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import App from '../App'
import { LiveProvider } from '../hooks/LiveProvider'
import * as useLiveModule from '../hooks/useLive'
import {
  installMockWebSocket,
  MockLiveWebSocket,
} from '../__mocks__/mockLiveWebSocket'

// Stub every page component App may render. Each returns null so that
// useLive subscriptions inside the page subtree are eliminated for the
// purposes of this test — leaving App's own useLiveConnection() as the
// sole tree subscription.
vi.mock('../pages/Home', () => ({ Home: () => null }))
vi.mock('../pages/Rooms', () => ({ Rooms: () => null }))
vi.mock('../pages/Wizard', () => ({ Wizard: () => null }))
vi.mock('../pages/Settings', () => ({ Settings: () => null }))
vi.mock('../pages/Schedule', () => ({ Schedule: () => null }))
vi.mock('../pages/Away', () => ({ Away: () => null }))
vi.mock('../pages/Engineering', () => ({ Engineering: () => null }))
vi.mock('../pages/Historian', () => ({ Historian: () => null }))
vi.mock('../pages/Balancing', () => ({ Balancing: () => null }))
vi.mock('../pages/Statistics', () => ({ Statistics: () => null }))
vi.mock('../pages/LiveView', () => ({ LiveView: () => null }))
vi.mock('../pages/Scop', () => ({ Scop: () => null }))
vi.mock('../pages/Forecast', () => ({ Forecast: () => null }))
vi.mock('../pages/Valves', () => ({ Valves: () => null }))

const VALID_SNAPSHOT = JSON.stringify({
  type: 'cycle',
  cycle_number: 1,
  status: { operating_state: 'Heating' },
  tariff_providers_status: {
    electricity: {
      fuel: 'electricity',
      provider_kind: 'octopus_electricity',
      last_refresh_at: 0,
      stale: false,
      last_price: 0,
      source_url: null,
      last_error: null,
      tariff_label: 'X',
    },
  },
  available_provider_kinds: ['octopus_electricity'],
})

// Stub fetch so App's setup-mode routing useEffect resolves without
// touching the network. setup_mode=false leaves activePage='home', which
// is the default state, so the routing effect produces no state change.
beforeEach(() => {
  installMockWebSocket()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ setup_mode: false }),
    } as Response
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('App — render-count under LiveProvider (INSTRUCTION-250)', () => {
  it('does not re-render on cycle messages with no connection change', async () => {
    const spy = vi.spyOn(useLiveModule, 'useLiveConnection')
    render(
      <LiveProvider>
        <App />
      </LiveProvider>,
    )
    const ws = MockLiveWebSocket.instances[0]
    await act(async () => { ws.triggerOpen() })
    // Open flips isConnected — App re-renders once. Let the routing
    // fetch resolve, then snap the count. Subsequent cycle messages
    // change the data slice only; App does not subscribe to data.
    await act(async () => { await Promise.resolve() })
    const baseline = spy.mock.calls.length
    await act(async () => { ws.triggerMessage(VALID_SNAPSHOT) })
    await act(async () => { ws.triggerMessage(VALID_SNAPSHOT) })
    await act(async () => { ws.triggerMessage(VALID_SNAPSHOT) })
    expect(spy.mock.calls.length).toBe(baseline)
  })

  it('re-renders when the connection closes', async () => {
    const spy = vi.spyOn(useLiveModule, 'useLiveConnection')
    render(
      <LiveProvider>
        <App />
      </LiveProvider>,
    )
    const ws = MockLiveWebSocket.instances[0]
    await act(async () => { ws.triggerOpen() })
    await act(async () => { await Promise.resolve() })
    const baseline = spy.mock.calls.length
    await act(async () => { ws.close() })
    expect(spy.mock.calls.length).toBeGreaterThan(baseline)
  })

  it('re-renders again when the connection reopens', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const spy = vi.spyOn(useLiveModule, 'useLiveConnection')
    render(
      <LiveProvider>
        <App />
      </LiveProvider>,
    )
    const ws = MockLiveWebSocket.instances[0]
    await act(async () => { ws.triggerOpen() })
    await act(async () => { ws.close() })
    const afterClose = spy.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    const reconnectWs = MockLiveWebSocket.instances[1]
    await act(async () => { reconnectWs.triggerOpen() })
    expect(spy.mock.calls.length).toBeGreaterThan(afterClose)
    vi.useRealTimers()
  })
})
