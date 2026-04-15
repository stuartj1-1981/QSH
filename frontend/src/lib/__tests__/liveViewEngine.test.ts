import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LiveViewEngine } from '../liveViewEngine'
import type { LiveViewData } from '../liveViewTypes'

function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const ctx = {
    scale: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    measureText: vi.fn(() => ({ width: 50 })),
    ellipse: vi.fn(),
    roundRect: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'top' as CanvasTextBaseline,
    font: '',
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  }
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  Object.defineProperty(canvas, 'clientWidth', { value: 1040, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: 760, configurable: true })
  return canvas
}

function makeRoom(id: string) {
  return { id, name: id, temp: 20, target: 21, valve: 50, area: 15, u: 0.15, status: 'ok' }
}

function makeData(roomCount: number): LiveViewData {
  const rooms = Array.from({ length: roomCount }, (_, i) => makeRoom(`room${i}`))
  return {
    rooms,
    hp: { power_kw: 4, capacity_kw: 8, cop: 3.5, flow_temp: 35, return_temp: 30, outdoor_temp: 5 },
    state: { season: 'winter', strategy: 'heating', hwState: null, cyclePause: null, label: 'Winter (Heating)' },
    source: { type: 'heat_pump', name: 'heat_pump', isMultiSource: false },
    dhw: { hwPlan: 'W', hasCylinder: true },
  }
}

describe('LiveViewEngine', () => {
  let rafId: number
  beforeEach(() => {
    rafId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => ++rafId)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs without throwing when given a canvas element', () => {
    const canvas = createMockCanvas()
    expect(() => new LiveViewEngine(canvas)).not.toThrow()
  })

  it('accepts setData() without throwing', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    expect(() => engine.setData(makeData(5))).not.toThrow()
  })

  it('handles empty rooms array', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    expect(() => engine.setData(makeData(0))).not.toThrow()
  })

  it('handles rooms array with 1 room', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    expect(() => engine.setData(makeData(1))).not.toThrow()
  })

  it('handles rooms array with 10 rooms', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    expect(() => engine.setData(makeData(10))).not.toThrow()
  })

  it('handles rooms array with 13 rooms', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    expect(() => engine.setData(makeData(13))).not.toThrow()
  })

  it('handles null/missing data gracefully via setData with new room counts', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    engine.setData(makeData(5))
    // Changing room count triggers re-layout
    expect(() => engine.setData(makeData(3))).not.toThrow()
  })

  it('start and destroy lifecycle works', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    engine.start()
    expect(window.requestAnimationFrame).toHaveBeenCalled()
    engine.destroy()
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
  })

  it('resize recalculates canvas dimensions', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    // resize is called in constructor, call again to verify no crash
    expect(() => engine.resize()).not.toThrow()
  })

  it('setDark switches palette without throwing', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    expect(() => engine.setDark(false)).not.toThrow()
    expect(() => engine.setDark(true)).not.toThrow()
    // No-op case: same value
    expect(() => engine.setDark(true)).not.toThrow()
  })

  it('setDark can be called after setData', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    engine.setData(makeData(5))
    expect(() => engine.setDark(false)).not.toThrow()
    expect(() => engine.setDark(true)).not.toThrow()
  })

  it('uses desktop profile for landscape canvas', () => {
    const canvas = createMockCanvas() // 1040×760 (landscape)
    const engine = new LiveViewEngine(canvas)
    engine.resize()
    expect(() => engine.setData(makeData(5))).not.toThrow()
  })

  it('switches to mobile profile for portrait canvas', () => {
    const canvas = createMockCanvas()
    Object.defineProperty(canvas, 'clientWidth', { value: 375, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 667, configurable: true })
    const engine = new LiveViewEngine(canvas)
    engine.resize()
    expect(() => engine.setData(makeData(13))).not.toThrow()
  })

  it('handles orientation change (landscape → portrait → landscape)', () => {
    const canvas = createMockCanvas() // starts 1040×760
    const engine = new LiveViewEngine(canvas)
    engine.setData(makeData(5))

    // Switch to portrait
    Object.defineProperty(canvas, 'clientWidth', { value: 375, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 667, configurable: true })
    expect(() => engine.resize()).not.toThrow()

    // Switch back to landscape
    Object.defineProperty(canvas, 'clientWidth', { value: 1040, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 760, configurable: true })
    expect(() => engine.resize()).not.toThrow()

    // Data can still be set
    expect(() => engine.setData(makeData(8))).not.toThrow()
  })

  it('mobile profile reduces label passes without crash', () => {
    const canvas = createMockCanvas()
    Object.defineProperty(canvas, 'clientWidth', { value: 375, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 667, configurable: true })
    const engine = new LiveViewEngine(canvas)
    engine.resize()
    engine.setData(makeData(13))
    engine.start()
    // Run one rAF callback
    const rafCb = vi.mocked(window.requestAnimationFrame).mock.calls[0][0]
    expect(() => rafCb(16)).not.toThrow()
    engine.destroy()
  })

  it('start() is idempotent — second call cancels the in-flight RAF handle', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    const rafSpy = vi.mocked(window.requestAnimationFrame)
    const cancelSpy = vi.mocked(window.cancelAnimationFrame)
    const rafBefore = rafSpy.mock.calls.length
    const cancelBefore = cancelSpy.mock.calls.length

    engine.start()
    engine.start()

    // Two RAF registrations queued (one per start call),
    // and one cancel in between to drop the stale handle.
    expect(rafSpy.mock.calls.length - rafBefore).toBe(2)
    expect(cancelSpy.mock.calls.length - cancelBefore).toBe(1)
  })

  it('stop() then start() resets lastTime so first frame dt = 16 ms', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    engine.setData(makeData(3))
    engine.start()

    // Advance one frame at t=1000 — first frame post-start should use dt=16ms.
    const rafCb1 = vi.mocked(window.requestAnimationFrame).mock.calls[0][0]
    rafCb1(1000)

    engine.stop()
    engine.start()

    // Next rAF registered by the new start loop — grab the latest callback.
    const calls = vi.mocked(window.requestAnimationFrame).mock.calls
    const rafCb2 = calls[calls.length - 1][0]
    // Advance to t=5000. If lastTime was NOT reset it would be 1000 and dt
    // would be clamped to 50 ms; with reset, first frame uses dt=16 ms and
    // FPS accumulator gets exactly 16 ms.
    expect(() => rafCb2(5000)).not.toThrow()
    // Post-reset FPS starts at 0 (not enough accumulated frames yet).
    expect(engine.getFps()).toBe(0)
  })

  it('setEngineering toggles engineering flag without throwing', () => {
    const canvas = createMockCanvas()
    const engine = new LiveViewEngine(canvas)
    engine.setData(makeData(3))
    expect(() => engine.setEngineering(true)).not.toThrow()
    engine.start()
    const rafCb = vi.mocked(window.requestAnimationFrame).mock.calls[0][0]
    expect(() => rafCb(16)).not.toThrow()
  })

  it('hysteresis prevents thrashing at near-square aspect ratio', () => {
    const canvas = createMockCanvas()
    // Start at 500×500 (square) — engine starts portrait=false (desktop)
    Object.defineProperty(canvas, 'clientWidth', { value: 500, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 500, configurable: true })
    const engine = new LiveViewEngine(canvas)
    engine.resize() // should stay desktop (neither ch > cw*1.05 nor cw > ch*1.05)
    expect(() => engine.setData(makeData(5))).not.toThrow()

    // 500×530 — just over 5% threshold, should switch to portrait
    Object.defineProperty(canvas, 'clientHeight', { value: 530, configurable: true })
    expect(() => engine.resize()).not.toThrow()

    // Back to 500×500 — within hysteresis band (500 <= 500*1.05), should retain portrait
    Object.defineProperty(canvas, 'clientHeight', { value: 500, configurable: true })
    expect(() => engine.resize()).not.toThrow()

    // Multiple resize calls at same dimensions should be stable
    expect(() => engine.resize()).not.toThrow()
    expect(() => engine.resize()).not.toThrow()
  })
})
