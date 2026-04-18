import { useRef, useEffect, useState } from 'react'
import { useLiveViewData } from '../hooks/useLiveViewData'
import { useBuildingLayout } from '../hooks/useBuildingLayout'
import { LiveViewEngine } from '../lib/liveViewEngine'
import { BuildingEngine } from '../lib/buildingEngine'
import { Building3DView } from '../components/Building3DView'
import { cn } from '../lib/utils'

interface LiveViewProps {
  dark?: boolean
  engineering?: boolean
}

type ViewMode = '2d' | '3d'

export function LiveView({ dark = true, engineering = false }: LiveViewProps) {
  const canvas2dRef = useRef<HTMLCanvasElement>(null)
  const canvas3dRef = useRef<HTMLCanvasElement>(null)
  const engine2dRef = useRef<LiveViewEngine | null>(null)
  const engine3dRef = useRef<BuildingEngine | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const { data, isConnected } = useLiveViewData()
  const { hasEnvelopeData } = useBuildingLayout()

  // Initialise both engines on mount, destroy both on unmount.
  useEffect(() => {
    const c2d = canvas2dRef.current
    const c3d = canvas3dRef.current
    if (!c2d || !c3d) return

    const e2d = new LiveViewEngine(c2d)
    engine2dRef.current = e2d
    e2d.resize()

    const e3d = new BuildingEngine(c3d)
    engine3dRef.current = e3d
    e3d.resize()
    // Both engines start stopped here — the viewMode effect below
    // runs immediately after mount and starts whichever engine matches
    // the current viewMode (default '2d').

    return () => {
      e2d.destroy()
      e3d.destroy()
      engine2dRef.current = null
      engine3dRef.current = null
    }
  }, [])

  // Sync dark mode to both engines.
  useEffect(() => {
    engine2dRef.current?.setDark(dark)
    engine3dRef.current?.setDark(dark)
  }, [dark])

  // Push 2D data to 2D engine on every cycle update.
  useEffect(() => {
    if (data && engine2dRef.current) {
      engine2dRef.current.setData(data)
    }
  }, [data])

  // Handle window resize — resize the active engine.
  useEffect(() => {
    const handleResize = () => {
      engine2dRef.current?.resize()
      engine3dRef.current?.resize()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Tab visibility — pause only the currently active engine.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (viewMode === '2d') engine2dRef.current?.stop()
        else engine3dRef.current?.stop()
      } else {
        if (viewMode === '2d') engine2dRef.current?.start()
        else engine3dRef.current?.start()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [viewMode])

  // Toggle engineering FPS overlay on the 2D engine.
  useEffect(() => {
    engine2dRef.current?.setEngineering(engineering)
  }, [engineering])

  // Toggle between 2D and 3D: start the active engine, stop the inactive one.
  // Resize the newly-active engine since its canvas may have been hidden when
  // the window was last resized.
  useEffect(() => {
    const e2d = engine2dRef.current
    const e3d = engine3dRef.current
    if (!e2d || !e3d) return
    if (viewMode === '2d') {
      e3d.stop()
      e2d.start()
      e2d.resize()
    } else {
      e2d.stop()
      e3d.start()
      e3d.resize()
    }
  }, [viewMode])

  return (
    <div className="relative w-full h-[calc(100vh-var(--header-h,60px)-2rem)] lg:h-full min-h-0 -m-4 lg:-m-6">
      <canvas
        ref={canvas2dRef}
        role="img"
        aria-label="Live system topology showing heat pump, rooms, and energy flow"
        className="absolute inset-0 w-full h-full"
        hidden={viewMode !== '2d'}
      />
      <canvas
        ref={canvas3dRef}
        role="img"
        aria-label="Live 3D building view showing room temperatures and thermal envelope"
        className="absolute inset-0 w-full h-full"
        hidden={viewMode !== '3d'}
      />

      {viewMode === '3d' && (
        <>
          <div
            role="note"
            aria-label="3D view limitations"
            className="absolute top-16 lg:top-4 left-4 right-4 lg:right-[320px] z-20
                       px-4 py-2 rounded-lg shadow-lg
                       bg-amber-500/15 border border-amber-500/40
                       text-amber-900 dark:text-amber-200 text-sm"
          >
            <p>
              <strong>Experimental — topology approximation only.</strong>{' '}
              Room positions are inferred from wall adjacencies, not measured
              geometry, so shape and orientation may not match your actual
              floor plan. Open for contributions: see{' '}
              <code>CONTRIBUTING</code> §3D View.
            </p>
          </div>
          <Building3DView engineRef={engine3dRef} dark={dark} />
        </>
      )}

      {hasEnvelopeData && (
        <div className="absolute top-4 right-4 z-10 flex gap-1
                        bg-[var(--bg-card)] border border-[var(--border)]
                        rounded-lg p-0.5 shadow-lg">
          <button
            onClick={() => setViewMode('2d')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              viewMode === '2d'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
            aria-pressed={viewMode === '2d'}
          >
            2D
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              viewMode === '3d'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
            aria-pressed={viewMode === '3d'}
          >
            3D
          </button>
        </div>
      )}

      {!isConnected && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2
                        bg-[var(--bg-card)] border border-[var(--border)]
                        rounded-xl px-4 py-2 text-sm text-[var(--text-muted)]">
          Connecting...
        </div>
      )}

      <span className="sr-only">
        {viewMode === '2d'
          ? data
            ? `System state: ${data.state.label}. ${data.rooms.length} rooms. Heat pump: ${data.hp.power_kw.toFixed(1)} kW.`
            : 'Waiting for system data.'
          : 'Live 3D building view showing room temperatures and thermal envelope'}
      </span>
    </div>
  )
}
