import '@testing-library/jest-dom'

// Web Storage shim (INSTRUCTION-314).
//
// Node >= 22.4 ships a `globalThis.localStorage` that is a non-functional
// placeholder unless the process is started with `--localstorage-file=<path>`
// (typeof is "object" but getItem/setItem/clear are undefined). On Node 25
// the global is present by default, and vitest 4.1.1's jsdom environment
// wiring lets it shadow jsdom's working Storage on both `globalThis` and
// `window`. Pure jsdom 29 is unaffected — remove this shim once the
// vitest/Node global population is fixed upstream (verify by deleting the
// shim and running src/__tests__/test-setup.storage.test.ts).
//
// Installed unconditionally so behaviour is identical on every Node/vitest
// combination. defineProperty with configurable+writable keeps test-level
// stubbing (vi.stubGlobal) working.
class MemoryStorage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    const k = String(key)
    return this.store.has(k) ? this.store.get(k)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(String(key))
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value))
  }
}

// jsdom does not implement Element.prototype.scrollIntoView. INSTRUCTION-414
// (D8) scrolls the deploy-outcome region into view on a refusal; without this
// stub the effect would throw "scrollIntoView is not a function". Tests that
// assert the scroll behaviour spy on this via vi.spyOn(Element.prototype,
// 'scrollIntoView').
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== 'undefined' && window[name] !== storage) {
    Object.defineProperty(window, name, {
      value: storage,
      configurable: true,
      writable: true,
    })
  }
}
