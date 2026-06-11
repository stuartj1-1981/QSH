import { describe, it, expect, beforeEach } from 'vitest'

// Regression lock for the Web Storage shim in test-setup.ts
// (INSTRUCTION-314). If a Node/vitest/jsdom upgrade re-breaks the storage
// globals, this file fails by name instead of surfacing as dozens of
// scattered component-test failures (the 10 June 2026 shape: Node 25's
// non-functional placeholder storage shadowing jsdom's Storage).

const storages = [
  ['localStorage', () => localStorage],
  ['sessionStorage', () => sessionStorage],
] as const

describe.each(storages)('%s contract', (name, get) => {
  beforeEach(() => {
    get().clear()
  })

  it('is the same object on window and globalThis', () => {
    expect(window[name]).toBe(get())
  })

  it('round-trips setItem/getItem and returns null for absent keys', () => {
    expect(get().getItem('missing')).toBeNull()
    get().setItem('k', 'v')
    expect(get().getItem('k')).toBe('v')
  })

  it('string-coerces values', () => {
    get().setItem('n', 42 as unknown as string)
    expect(get().getItem('n')).toBe('42')
  })

  it('removeItem deletes a single key', () => {
    get().setItem('a', '1')
    get().setItem('b', '2')
    get().removeItem('a')
    expect(get().getItem('a')).toBeNull()
    expect(get().getItem('b')).toBe('2')
  })

  it('clear empties and length/key reflect contents', () => {
    expect(get().length).toBe(0)
    get().setItem('a', '1')
    get().setItem('b', '2')
    expect(get().length).toBe(2)
    expect(get().key(0)).toBe('a')
    expect(get().key(5)).toBeNull()
    get().clear()
    expect(get().length).toBe(0)
    expect(get().key(0)).toBeNull()
  })
})
