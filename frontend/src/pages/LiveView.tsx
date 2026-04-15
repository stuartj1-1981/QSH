import { useRef, useEffect } from 'react'
import { useLiveViewData } from '../hooks/useLiveViewData'
import { LiveViewEngine } from '../lib/liveViewEngine'

interface LiveViewProps {
  dark?: boolean
  engineering?: boolean
}

export function LiveView({ dark = true, engineering = false }: LiveViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<LiveViewEngine | null>(null)
  const { data, isConnected } = useLiveViewData()

  // Initialise engine on mount, destroy on unmount
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const engine = new LiveViewEngine(canvas)
    engineRef.current = engine
    engine.resize()
    engine.start()

    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  // Sync dark mode to engine
  useEffect(() => {
    engineRef.current?.setDark(dark)
  }, [dark])

  // Push data to engine on every cycle update
  useEffect(() => {
    if (data && engineRef.current) {
      engineRef.current.setData(data)
    }
  }, [data])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => engineRef.current?.resize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Pause animation when tab is hidden so RAF throttling/backgrounding does
  // not leave particles visually frozen mid-pipe. start() resets lastTime=0
  // so the first post-resume frame uses dt=16ms rather than a stale delta.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        engineRef.current?.stop()
      } else {
        engineRef.current?.start()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Toggle engineering FPS overlay on the engine
  useEffect(() => {
    engineRef.current?.setEngineering(engineering)
  }, [engineering])

  // Mobile offset: --header-h (60px: header 44px + mb-4 16px) + p-4 padding (32px) = 92px total.
  // Desktop: h-full fills the Layout main area.
  return (
    <div className="relative w-full h-[calc(100vh-var(--header-h,60px)-2rem)] lg:h-full min-h-0 -m-4 lg:-m-6">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Live system topology showing heat pump, rooms, and energy flow"
        className="absolute inset-0 w-full h-full"
      />
      <span className="sr-only">
        {data
          ? `System state: ${data.state.label}. ${data.rooms.length} rooms. Heat pump: ${data.hp.power_kw.toFixed(1)} kW.`
          : 'Waiting for system data.'}
      </span>
      {!isConnected && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2
                        bg-[var(--bg-card)] border border-[var(--border)]
                        rounded-xl px-4 py-2 text-sm text-[var(--text-muted)]">
          Connecting...
        </div>
      )}
    </div>
  )
}
