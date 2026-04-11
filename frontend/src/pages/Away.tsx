import { useState, useCallback, useRef, useEffect } from 'react'
import { useAwayState, useSetAway, useSetZoneAway } from '../hooks/useAway'
import { useRoomHistory } from '../hooks/useHistory'
import { AwayToggle } from '../components/away/AwayToggle'
import { DurationPicker } from '../components/away/DurationPicker'
import { ZoneSelector } from '../components/away/ZoneSelector'
import { SetbackCard } from '../components/away/SetbackCard'
import { RecoveryView } from '../components/away/RecoveryView'
import { OccupancyTimeline } from '../components/OccupancyTimeline'
import { formatTemp } from '../lib/utils'
import type { ZoneAwayState } from '../types/schedule'

export function Away() {
  const { data, loading, refetch } = useAwayState()
  const { setAway, loading: settingAway } = useSetAway()
  const { setZoneAway } = useSetZoneAway()

  // Local override for days; null means "use server value"
  const [daysOverride, setDaysOverride] = useState<number | null>(null)
  const days = daysOverride ?? data?.whole_house.days ?? 1

  // Optimistic active state — avoids toggle snap-back while pipeline catches up
  const [optimisticActive, setOptimisticActive] = useState<boolean | null>(null)
  const isActive = optimisticActive ?? data?.whole_house.active ?? false

  // Optimistic per-zone state — snaps zone toggles immediately
  const [optimisticZones, setOptimisticZones] = useState<Record<string, boolean>>({})

  // Polling interval ref — typed for setInterval return. null = no active poll.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Generation counter — stale polling callbacks self-cancel on mismatch
  const pollGenRef = useRef(0)

  // Derived: any unconfirmed optimistic state in flight
  const hasPendingOptimistic = optimisticActive !== null
    || daysOverride !== null
    || Object.keys(optimisticZones).length > 0

  // Clear optimistic state once server data confirms the change.
  useEffect(() => {
    if (optimisticActive !== null && data?.whole_house.active === optimisticActive) {
      setOptimisticActive(null)
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    // Clear days override when server confirms the new value
    if (daysOverride !== null && data?.whole_house.days === daysOverride) {
      setDaysOverride(null)
    }
  }, [data?.whole_house.active, optimisticActive, data?.whole_house.days, daysOverride])

  // Clear per-zone optimistic state once server confirms each room.
  useEffect(() => {
    if (Object.keys(optimisticZones).length === 0 || !data) return
    const confirmed: string[] = []
    for (const [room, expected] of Object.entries(optimisticZones)) {
      const serverActive = data.per_zone[room]?.active
      if (serverActive === expected) confirmed.push(room)
    }
    if (confirmed.length > 0) {
      setOptimisticZones((prev) => {
        const next = { ...prev }
        for (const room of confirmed) delete next[room]
        return next
      })
    }
  }, [data, optimisticZones])

  // Stop polling once all optimistic state has been confirmed
  useEffect(() => {
    if (!hasPendingOptimistic && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [hasPendingOptimistic])

  // Cleanup polling on unmount — prevents stale refetch calls.
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    const gen = ++pollGenRef.current
    let attempts = 0
    const id = setInterval(() => {
      if (pollGenRef.current !== gen) {
        // A newer polling session started — this one is stale, self-cancel
        clearInterval(id)
        return
      }
      attempts++
      refetch()
      if (attempts >= 12) {
        clearInterval(id)
        pollRef.current = null
        // Failsafe: clear stale optimistic state after 60s
        // State setters are stable refs — intentionally omitted from useCallback
        // deps per React convention (they never change identity)
        setOptimisticActive(null)
        setOptimisticZones({})
        setDaysOverride(null)
      }
    }, 5000)
    pollRef.current = id
  }, [refetch])

  const handleToggleAway = async (active: boolean) => {
    setOptimisticActive(active)
    await setAway({ active, days })
    startPolling()
  }

  const handleDaysChange = async (newDays: number) => {
    setDaysOverride(newDays)
    if (isActive) {
      await setAway({ active: true, days: newDays })
      // Do NOT clear daysOverride here — let confirmation effect clear it
      startPolling()
    }
  }

  const handleZoneToggle = async (room: string, active: boolean, zoneDays: number) => {
    setOptimisticZones((prev) => ({ ...prev, [room]: active }))
    await setZoneAway(room, active, zoneDays)
    startPolling()
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Away Mode</h1>
        <p className="text-[var(--text-muted)]">Loading...</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Away Mode</h1>
        <p className="text-[var(--text-muted)]">Unable to load away state.</p>
      </div>
    )
  }

  const zonesWithOptimistic = Object.fromEntries(
    Object.entries(data.per_zone).map(([room, zone]) => [
      room,
      room in optimisticZones ? { ...zone, active: optimisticZones[room] } : zone,
    ])
  )

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold mb-2">Away Mode</h1>

      {/* Recovery status — inline, non-blocking */}
      {data.recovery.active && Object.keys(data.recovery.rooms).length > 0 && (
        <RecoveryView rooms={data.recovery.rooms} />
      )}

      {/* Zone status summary */}
      {Object.keys(data.per_zone).length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-2">Zone Status</h3>
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="pb-2 pr-3">Room</th>
                <th className="pb-2 pr-3">State</th>
                <th className="pb-2 pr-3">Current</th>
                <th className="pb-2 pr-3">Target</th>
                <th className="pb-2">Setback</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.per_zone).map(([room, zone]: [string, ZoneAwayState]) => {
                const zoneIsAway = zone.active || isActive
                return (
                <tr key={room} className="border-b border-[var(--border)]/50">
                  <td className="py-1.5 pr-3 capitalize max-w-[100px] truncate">{room.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 pr-3">
                    <span className={zoneIsAway ? 'text-blue-500' : 'text-[var(--green)]'}>
                      {zoneIsAway ? 'Away' : 'Home'}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">{formatTemp(zone.current_temp)}</td>
                  <td className="py-1.5 pr-3">{zone.target_temp != null ? `${zone.target_temp}°C` : '—'}</td>
                  <td className="py-1.5">{zone.computed_depth_c != null ? `${zone.computed_depth_c}°C` : '—'}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Main toggle */}
      <AwayToggle
        active={isActive}
        onToggle={handleToggleAway}
        loading={settingAway || optimisticActive !== null}
      />

      {/* Duration picker — always visible so user can set days before toggling */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
        <DurationPicker days={days} onChange={handleDaysChange} />
      </div>

      {/* Setback summary */}
      {isActive && (
        <SetbackCard zones={zonesWithOptimistic} days={days} />
      )}

      {/* Per-zone controls */}
      <ZoneSelector zones={zonesWithOptimistic} onToggleZone={handleZoneToggle} />

      {/* Occupancy timeline */}
      <OccupancyTimelineSection />
    </div>
  )
}

function OccupancyTimelineSection() {
  const { data: roomHistory, loading } = useRoomHistory(['occupancy'], 24)

  if (loading || Object.keys(roomHistory).length === 0) return null

  return (
    <div className="mt-2">
      <OccupancyTimeline roomHistory={roomHistory} hours={24} />
    </div>
  )
}
