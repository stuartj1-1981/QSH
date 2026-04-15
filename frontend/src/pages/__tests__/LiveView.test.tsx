import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveView } from '../LiveView'

// Track the most recently constructed engine instance so tests can assert
// on the spies (start/stop/setEngineering).
type EngineSpy = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  setData: ReturnType<typeof vi.fn>
  setDark: ReturnType<typeof vi.fn>
  setEngineering: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}
let lastEngine: EngineSpy | null = null

// Mock the engine — avoid Canvas 2D context issues in jsdom
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

// Mock useLiveViewData — control return values per test
const mockUseLiveViewData = vi.fn()
vi.mock('../../hooks/useLiveViewData', () => ({
  useLiveViewData: () => mockUseLiveViewData(),
}))

function setVisibility(value: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('LiveView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockUseLiveViewData.mockReset()
    lastEngine = null
    // Reset visibility to visible for test isolation.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  it('renders canvas element with role="img" and aria-label', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    const canvas = document.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.getAttribute('role')).toBe('img')
    expect(canvas!.getAttribute('aria-label')).toContain('Live system topology')
  })

  it('renders without crashing when useLiveViewData returns null', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: false })
    expect(() => render(<LiveView />)).not.toThrow()
  })

  it('shows connecting overlay when isConnected is false', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: false })
    render(<LiveView />)
    expect(screen.getByText('Connecting...')).toBeInTheDocument()
  })

  it('hides connecting overlay when isConnected is true', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument()
  })

  it('renders sr-only state summary when data is present', () => {
    mockUseLiveViewData.mockReturnValue({
      data: {
        rooms: [{ id: 'lounge', name: 'lounge', temp: 20, target: 21, valve: 50, area: 15, u: 0.15, status: 'ok' }],
        hp: { power_kw: 4.2, capacity_kw: 8, cop: 3.5, flow_temp: 35, return_temp: 30, outdoor_temp: 5 },
        state: { season: 'winter', strategy: 'heating', hwState: null, cyclePause: null, label: 'Winter (Heating)' },
        source: { type: 'heat_pump', name: 'heat_pump', isMultiSource: false },
        dhw: { hwPlan: 'W', hasCylinder: true },
      },
      isConnected: true,
    })
    render(<LiveView />)
    const srText = screen.getByText(/System state: Winter \(Heating\)/)
    expect(srText).toBeInTheDocument()
    expect(srText.textContent).toContain('1 rooms')
    expect(srText.textContent).toContain('4.2 kW')
  })

  it('renders sr-only "Waiting for system data" when data is null', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    expect(screen.getByText('Waiting for system data.')).toBeInTheDocument()
  })

  it('calls engine.start() once on mount', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    expect(lastEngine).not.toBeNull()
    expect(lastEngine!.start).toHaveBeenCalledTimes(1)
  })

  it('stops the engine when tab becomes hidden', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    lastEngine!.stop.mockClear()
    setVisibility('hidden')
    expect(lastEngine!.stop).toHaveBeenCalledTimes(1)
  })

  it('starts the engine when tab becomes visible', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView />)
    setVisibility('hidden')
    lastEngine!.start.mockClear()
    setVisibility('visible')
    expect(lastEngine!.start).toHaveBeenCalledTimes(1)
  })

  it('removes visibilitychange listener on unmount', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    const { unmount } = render(<LiveView />)
    unmount()
    const stopCount = lastEngine!.stop.mock.calls.length
    const startCount = lastEngine!.start.mock.calls.length
    setVisibility('hidden')
    setVisibility('visible')
    // No additional start/stop after unmount — listener was removed.
    expect(lastEngine!.stop.mock.calls.length).toBe(stopCount)
    expect(lastEngine!.start.mock.calls.length).toBe(startCount)
  })

  it('forwards engineering prop to engine.setEngineering', () => {
    mockUseLiveViewData.mockReturnValue({ data: null, isConnected: true })
    render(<LiveView engineering={true} />)
    expect(lastEngine!.setEngineering).toHaveBeenCalledWith(true)
  })
})
