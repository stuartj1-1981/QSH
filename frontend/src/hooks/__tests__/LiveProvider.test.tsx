import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LiveProvider } from '../LiveProvider'
import { useLive } from '../useLive'

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
}

beforeEach(() => {
  MockWebSocket.instances = []
  // @ts-expect-error — overriding the global WebSocket for this test scope.
  globalThis.WebSocket = MockWebSocket
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
    expect(MockWebSocket.instances.length).toBe(1)
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
    const ws = MockWebSocket.instances[0]
    act(() => { ws.triggerOpen() })
    expect(result.current.a.isConnected).toBe(true)
    expect(result.current.b.isConnected).toBe(true)
    expect(result.current.a).toBe(result.current.b)
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
    expect(MockWebSocket.instances.length).toBe(2)
  })

  it('closes the socket on provider unmount', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveProvider>{children}</LiveProvider>
    )
    const { unmount } = renderHook(() => useLive(), { wrapper })
    expect(MockWebSocket.instances.length).toBe(1)
    const ws = MockWebSocket.instances[0]
    expect(ws.readyState).not.toBe(3)
    unmount()
    expect(ws.readyState).toBe(3)
  })
})
