/**
 * Shared MockWebSocket for tests that drive the LiveProvider WebSocket
 * lifecycle (open / message / close). Extracted at INSTRUCTION-250 so the
 * LiveProvider tests and the App render-count tests can share one
 * implementation rather than maintaining two near-identical copies.
 *
 * Install with `installMockWebSocket()` in beforeEach; the constructor
 * pushes every instance into the static `instances` array so tests can
 * drive them. Each instance exposes `triggerOpen()` and `triggerMessage()`
 * helpers that fire the corresponding handlers synchronously.
 */
export class MockLiveWebSocket {
  static instances: MockLiveWebSocket[] = []
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  readyState = 0
  url: string

  constructor(url: string) {
    this.url = url
    MockLiveWebSocket.instances.push(this)
  }

  close() {
    this.readyState = 3
    if (this.onclose) this.onclose({} as CloseEvent)
  }

  send() {
    /* no-op */
  }

  triggerOpen() {
    this.readyState = 1
    if (this.onopen) this.onopen({} as Event)
  }

  triggerMessage(data: string) {
    if (this.onmessage) this.onmessage({ data } as MessageEvent)
  }
}

/**
 * Replace the global WebSocket with MockLiveWebSocket and reset the
 * instance array. Call from a vitest `beforeEach`.
 */
export function installMockWebSocket(): void {
  MockLiveWebSocket.instances = []
  // @ts-expect-error — overriding the global WebSocket for the test scope.
  globalThis.WebSocket = MockLiveWebSocket
}
