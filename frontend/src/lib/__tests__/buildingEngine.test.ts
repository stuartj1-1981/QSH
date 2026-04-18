import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BuildingEngine } from '../buildingEngine'
import type { SolvedLayout, LayoutRoom } from '../buildingLayout'
import type { BuildingLiveData, BuildingViewMode } from '../buildingTypes'

function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const ctx = {
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'top' as CanvasTextBaseline,
    lineWidth: 1,
  }
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true })
  canvas.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0,
    toJSON: () => ({}),
  })) as unknown as () => DOMRect
  return canvas
}

function makeLayout(): SolvedLayout {
  return {
    rooms: {
      lounge: { x: 0, z: 0, w: 5, d: 4, floor: 0, col: 0, row: 0 },
      kitchen: { x: 5, z: 0, w: 4, d: 4, floor: 0, col: 1, row: 0 },
    },
    centroid: { x: 4.5, z: 2 },
    buildingWidth: 9,
    floorCount: 1,
    log: [],
  }
}

function makeLayoutRooms(): Record<string, LayoutRoom> {
  return {
    lounge: {
      area_m2: 20,
      ceiling_m: 2.5,
      floor: 0,
      envelope: {
        north_wall: 'external',
        south_wall: 'external',
        east_wall: { room: 'kitchen' },
        west_wall: 'external',
        floor: 'ground',
        ceiling: 'roof',
      },
    },
    kitchen: {
      area_m2: 16,
      ceiling_m: 2.5,
      floor: 0,
      envelope: {
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: { room: 'lounge' },
        floor: 'ground',
        ceiling: 'roof',
      },
    },
  }
}

function makeLiveData(): BuildingLiveData {
  return {
    rooms: {
      lounge: { temp: 20.5, target: 21, valve: 60, status: 'heating' },
      kitchen: { temp: 19.0, target: 20, valve: 40, status: 'heating' },
    },
    system: {
      outdoor_temp: 5,
      flow_temp: 35,
      return_temp: 30,
      delta_t: 5,
      power_kw: 4,
      cop: 3.2,
      mode: 'heating',
    },
    cycle_number: 42,
  }
}

describe('BuildingEngine', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs without throwing when given a canvas element', () => {
    const canvas = createMockCanvas()
    expect(() => new BuildingEngine(canvas)).not.toThrow()
  })

  it('accepts setLayout then setData without throwing', () => {
    const canvas = createMockCanvas()
    const engine = new BuildingEngine(canvas)
    expect(() => {
      engine.setLayout(makeLayout(), makeLayoutRooms())
      engine.setData(makeLiveData())
    }).not.toThrow()
    engine.destroy()
  })

  it('setView accepts each of the 4 view modes', () => {
    const canvas = createMockCanvas()
    const engine = new BuildingEngine(canvas)
    engine.setLayout(makeLayout(), makeLayoutRooms())
    const modes: BuildingViewMode[] = ['3d', 'exploded', 'thermal', 'envelope']
    for (const mode of modes) {
      expect(() => engine.setView(mode)).not.toThrow()
    }
    engine.destroy()
  })

  it('destroy is idempotent — second call does not throw', () => {
    const canvas = createMockCanvas()
    const engine = new BuildingEngine(canvas)
    engine.setLayout(makeLayout(), makeLayoutRooms())
    expect(() => engine.destroy()).not.toThrow()
    expect(() => engine.destroy()).not.toThrow()
  })

  it('handleClick dispatches callback with null for background click on empty scene', () => {
    const canvas = createMockCanvas()
    const engine = new BuildingEngine(canvas)
    const cb = vi.fn()
    engine.onRoomSelect(cb)
    engine.handleClick({ x: 0, y: 0 })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(null)
    engine.destroy()
  })
})
