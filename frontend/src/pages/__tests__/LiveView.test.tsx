import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LiveView } from '../LiveView'

type EngineSpy = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  setData: ReturnType<typeof vi.fn>
  setDark: ReturnType<typeof vi.fn>
  setEngineering: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

type BuildingEngineSpy = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  setLayout: ReturnType<typeof vi.fn>
  setData: ReturnType<typeof vi.fn>
  setView: ReturnType<typeof vi.fn>
  setDark: ReturnType<typeof vi.fn>
  onRoomSelect: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

let lastEngine: EngineSpy | null = null
let lastBuildingEngine: BuildingEngineSpy | null = null

vi.mock('../../lib/liveViewEngine', () => {
  return {
    LiveViewEngine: class {
      start = vi.fn()
      stop = vi.fn()
      setData = vi.fn()
      setDark = vi.fn()
      setEngineering = vi.fn()
      resize = vi.fn()
      destroy = vi.fn()
      constructor() {
        lastEngine = this as unknown as EngineSpy
      }
    },
  }
})

vi.mock('../../lib/buildingEngine', () => {
  return {
    BuildingEngine: class {
      start = vi.fn()
      stop = vi.fn()
      setLayout = vi.fn()
      setData = vi.fn()
      setView = vi.fn()
      setDark = vi.fn()
      onRoomSelect = vi.fn()
      resize = vi.fn()
      destroy = vi.fn()
      constructor() {
        lastBuildingEngine = this as unknown as BuildingEngineSpy
      }
    },
  }
})

const mockUseLiveViewData = vi.fn()
vi.mock('../../hooks/useLiveViewData', () => ({
  useLiveViewData: () => mockUseLiveViewData(),
}))

const mockUseBuildingLayout = vi.fn()
vi.mock('../../hooks/useBuildingLayout', () => ({
  useBuildingLayout: () => mockUseBuildingLayout(),
}))

const mockUseLive = vi.fn()
vi.mock('../../hooks/useLive', () => ({
  useLive: () => mockUseLive(),
}))

function setVisibility(value: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('LiveView', () => {
  beforeEach(() => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    mockUseBuildingLayout.mockReturnValue({
      layout: null,
      rooms: null,
      layoutRooms: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: false,
    })
    mockUseLive.mockReturnValue({ data: null, isConnected: true, lastUpdate: 0 })
  })

  afterEach(() => {
    vi.clearAllMocks()
    lastEngine = null
    lastBuildingEngine = null
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  // ──────────────────────────────────────────────────────────
  // Preserved 2D behaviour
  // ──────────────────────────────────────────────────────────

  it('renders 2D canvas with role="img" and live-topology aria-label', () => {
    render(<LiveView />)
    const canvas = document.querySelectorAll('canvas')[0]
    expect(canvas).toBeDefined()
    expect(canvas.getAttribute('role')).toBe('img')
    expect(canvas.getAttribute('aria-label')).toContain('Live system topology')
  })

  it('shows connecting overlay when isConnected is false', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: false })
    render(<LiveView />)
    expect(screen.getByText('Connecting...')).toBeInTheDocument()
  })

  it('calls engine2d.start() once on mount (via viewMode effect)', () => {
    render(<LiveView />)
    expect(lastEngine).not.toBeNull()
    expect(lastEngine!.start).toHaveBeenCalledTimes(1)
  })

  it('stops the 2D engine when tab becomes hidden in 2D mode', () => {
    render(<LiveView />)
    lastEngine!.stop.mockClear()
    setVisibility('hidden')
    expect(lastEngine!.stop).toHaveBeenCalledTimes(1)
  })

  it('forwards engineering prop to 2D engine.setEngineering', () => {
    render(<LiveView engineering={true} />)
    expect(lastEngine!.setEngineering).toHaveBeenCalledWith(true)
  })

  // ──────────────────────────────────────────────────────────
  // New 2D/3D toggle tests (Task 6)
  // ──────────────────────────────────────────────────────────

  it('hides the 2D/3D toggle when no envelope data is available', () => {
    mockUseBuildingLayout.mockReturnValue({
      layout: null,
      rooms: null,
      layoutRooms: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: false,
    })
    render(<LiveView />)
    expect(screen.queryByRole('button', { name: '3D' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '2D' })).not.toBeInTheDocument()
  })

  it('shows the 2D/3D toggle when envelope data is available', () => {
    mockUseBuildingLayout.mockReturnValue({
      layout: { rooms: {}, centroid: { x: 0, z: 0 }, buildingWidth: 0, floorCount: 1, log: [] },
      rooms: {},
      layoutRooms: {},
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: true,
    })
    render(<LiveView />)
    expect(screen.getByRole('button', { name: '2D' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3D' })).toBeInTheDocument()
  })

  it('defaults to 2D — 2D canvas visible, 3D canvas hidden', () => {
    mockUseBuildingLayout.mockReturnValue({
      layout: null,
      rooms: null,
      layoutRooms: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: true,
    })
    render(<LiveView />)
    const canvases = document.querySelectorAll('canvas')
    expect(canvases.length).toBe(2)
    expect(canvases[0].hidden).toBe(false) // 2D
    expect(canvases[1].hidden).toBe(true)  // 3D
  })

  it('switches to 3D on click — 3D canvas visible, 2D canvas hidden, engines toggled', () => {
    mockUseBuildingLayout.mockReturnValue({
      layout: null,
      rooms: null,
      layoutRooms: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: true,
    })
    render(<LiveView />)
    expect(lastEngine).not.toBeNull()
    expect(lastBuildingEngine).not.toBeNull()

    // Clear to observe toggle-driven calls only.
    lastEngine!.start.mockClear()
    lastEngine!.stop.mockClear()
    lastBuildingEngine!.start.mockClear()
    lastBuildingEngine!.stop.mockClear()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '3D' }))
    })

    const canvases = document.querySelectorAll('canvas')
    expect(canvases[0].hidden).toBe(true)  // 2D hidden
    expect(canvases[1].hidden).toBe(false) // 3D visible
    expect(lastEngine!.stop).toHaveBeenCalledTimes(1)
    expect(lastBuildingEngine!.start).toHaveBeenCalledTimes(1)
  })

  it('switches back to 2D — 2D canvas visible, 3D canvas hidden', () => {
    mockUseBuildingLayout.mockReturnValue({
      layout: null,
      rooms: null,
      layoutRooms: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: true,
    })
    render(<LiveView />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '3D' }))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '2D' }))
    })
    const canvases = document.querySelectorAll('canvas')
    expect(canvases[0].hidden).toBe(false) // 2D visible
    expect(canvases[1].hidden).toBe(true)  // 3D hidden
  })

  it('keeps both canvases in the DOM regardless of toggle state (dual-mount)', () => {
    mockUseBuildingLayout.mockReturnValue({
      layout: null,
      rooms: null,
      layoutRooms: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
      hasEnvelopeData: true,
    })
    render(<LiveView />)
    expect(document.querySelectorAll('canvas').length).toBe(2)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '3D' }))
    })
    expect(document.querySelectorAll('canvas').length).toBe(2)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '2D' }))
    })
    expect(document.querySelectorAll('canvas').length).toBe(2)
  })
})
