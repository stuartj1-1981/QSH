import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, render } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { LiveProvider } from '../LiveProvider'
import { useLive, useLiveData, useLiveConnection } from '../useLive'
import {
  MockLiveWebSocket,
  installMockWebSocket,
} from '../../__mocks__/mockLiveWebSocket'

const VALID_SNAPSHOT = {
  type: 'cycle',
  cycle_number: 7,
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
  installMockWebSocket()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LiveProvider — singleton invariants', () => {
  it('opens exactly one WebSocket regardless of consumer count', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveProvider>{children}</LiveProvider>
    )
    renderHook(() => {
      useLive()
      useLive()
      useLive()
    }, { wrapper })
    expect(MockLiveWebSocket.instances.length).toBe(1)
  })

  it('all consumers receive the same data reference on update', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveProvider>{children}</LiveProvider>
    )
    const { result } = renderHook(() => {
      const a = useLive()
      const b = useLive()
      return { a, b }
    }, { wrapper })
    const ws = MockLiveWebSocket.instances[0]
    act(() => { ws.triggerOpen() })
    expect(result.current.a.isConnected).toBe(true)
    expect(result.current.b.isConnected).toBe(true)
    expect(result.current.a).toEqual(result.current.b)
  })

  it('throws a clear error when useLive is called outside a provider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useLive())).toThrow(
      /must be called inside a <LiveProvider>/,
    )
    errSpy.mockRestore()
  })

  it('opens a separate socket per provider mount (provider IS the singleton boundary)', () => {
    const Tree = () => (
      <>
        <LiveProvider><div>tree A</div></LiveProvider>
        <LiveProvider><div>tree B</div></LiveProvider>
      </>
    )
    render(<Tree />)
    expect(MockLiveWebSocket.instances.length).toBe(2)
  })

  it('closes the socket on provider unmount', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveProvider>{children}</LiveProvider>
    )
    const { unmount } = renderHook(() => useLive(), { wrapper })
    expect(MockLiveWebSocket.instances.length).toBe(1)
    const ws = MockLiveWebSocket.instances[0]
    expect(ws.readyState).not.toBe(3)
    unmount()
    expect(ws.readyState).toBe(3)
  })
})

// INSTRUCTION-250 Task 6: render-isolation and stable-reference tests for
// the split LiveDataContext / LiveConnectionContext.
describe('LiveProvider — context split (INSTRUCTION-250)', () => {
  it('does not re-render useLiveConnection consumers when only data changes', () => {
    const renderCount = { count: 0 }
    function ConnectionOnly() {
      useLiveConnection()
      useEffect(() => {
        renderCount.count++
      })
      return null
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveProvider>{children}</LiveProvider>
    )
    render(<ConnectionOnly />, { wrapper })
    const ws = MockLiveWebSocket.instances[0]
    // Open the socket so isConnected flips false -> true. This is the
    // baseline connection change; record it then fire two cycle messages
    // and assert no further renders.
    act(() => { ws.triggerOpen() })
    const afterOpen = renderCount.count
    act(() => { ws.triggerMessage(JSON.stringify({ ...VALID_SNAPSHOT, cycle_number: 1 })) })
    act(() => { ws.triggerMessage(JSON.stringify({ ...VALID_SNAPSHOT, cycle_number: 2 })) })
    expect(renderCount.count).toBe(afterOpen)
  })

  it('does re-render useLiveData consumers when a new cycle message arrives', () => {
    const renderCount = { count: 0 }
    const seenCycles: Array<number | null | undefined> = []
    function DataOnly() {
      const { data } = useLiveData()
      const cycleNumber = data?.cycle_number
      useEffect(() => {
        renderCount.count++
        seenCycles.push(cycleNumber)
      })
      return null
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveProvider>{children}</LiveProvider>
    )
    render(<DataOnly />, { wrapper })
    const ws = MockLiveWebSocket.instances[0]
    act(() => { ws.triggerOpen() })
    const baseline = renderCount.count
    act(() => { ws.triggerMessage(JSON.stringify({ ...VALID_SNAPSHOT, cycle_number: 11 })) })
    act(() => { ws.triggerMessage(JSON.stringify({ ...VALID_SNAPSHOT, cycle_number: 12 })) })
    // Each new cycle message must produce at least one render with the
    // new value visible. Strict equality on a delta would over-constrain
    // (React may batch or split renders), so we assert (a) the count
    // strictly increased and (b) the new cycle numbers were observed.
    expect(renderCount.count).toBeGreaterThan(baseline)
    expect(seenCycles).toContain(11)
    expect(seenCycles).toContain(12)
  })

  it('returns a stable connection value reference across cycle messages', () => {
    const captures: Array<ReturnType<typeof useLiveConnection>> = []
    function ConnectionCapture() {
      const v = useLiveConnection()
      useEffect(() => {
        captures.push(v)
      })
      return null
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveProvider>{children}</LiveProvider>
    )
    render(<ConnectionCapture />, { wrapper })
    const ws = MockLiveWebSocket.instances[0]
    act(() => { ws.triggerOpen() })
    const afterOpenRef = captures[captures.length - 1]
    act(() => { ws.triggerMessage(JSON.stringify({ ...VALID_SNAPSHOT, cycle_number: 1 })) })
    act(() => { ws.triggerMessage(JSON.stringify({ ...VALID_SNAPSHOT, cycle_number: 2 })) })
    // Component does not re-render because connection slice did not change,
    // so the capture array length is unchanged and the last captured value
    // is reference-equal to the post-open value.
    expect(captures[captures.length - 1]).toBe(afterOpenRef)
  })
})
