import { useState, useCallback, useReducer } from 'react'
import { useSchedules, useUpdateSchedule, useApplyPreset, useCopySchedule } from '../hooks/useSchedule'
import type { WeekSchedule, PresetName, DayName } from '../types/schedule'
import { ALL_DAYS } from '../types/schedule'
import { WeeklyGrid } from '../components/schedule/WeeklyGrid'
import { ScheduleToolbar } from '../components/schedule/ScheduleToolbar'
import { ComfortScheduleEditor } from '../components/schedule/ComfortScheduleEditor'

interface LocalState {
  schedule: WeekSchedule | null
  enabled: boolean
  dirty: boolean
  /** Tracks which room+data snapshot we synced from */
  syncKey: string
}

type LocalAction =
  | { type: 'sync'; schedule: WeekSchedule; enabled: boolean; syncKey: string }
  | { type: 'setSchedule'; schedule: WeekSchedule }
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'clearDirty' }

function localReducer(state: LocalState, action: LocalAction): LocalState {
  switch (action.type) {
    case 'sync':
      if (action.syncKey === state.syncKey) return state
      return { schedule: action.schedule, enabled: action.enabled, dirty: false, syncKey: action.syncKey }
    case 'setSchedule':
      return { ...state, schedule: action.schedule, dirty: true }
    case 'setEnabled':
      return { ...state, enabled: action.enabled, dirty: true }
    case 'clearDirty':
      return { ...state, dirty: false }
  }
}

export function Schedule() {
  const { data, loading, refetch } = useSchedules()
  const { update, loading: saving } = useUpdateSchedule()
  const { apply, loading: applyingPreset } = useApplyPreset()
  const { copy, loading: copying } = useCopySchedule()

  const rooms = data ? Object.keys(data.rooms) : []

  // selectedRoom defaults to first available room; user can override
  const [selectedRoomOverride, setSelectedRoom] = useState('')
  const selectedRoom = selectedRoomOverride || (rooms.length > 0 ? rooms[0] : '')

  const [sourceDay, setSourceDay] = useState<DayName>('monday')

  // Derive sync key from current room + data snapshot
  const syncKey = data && selectedRoom && data.rooms[selectedRoom]
    ? `${selectedRoom}:${JSON.stringify(data.rooms[selectedRoom].schedule)}`
    : ''

  const [local, dispatch] = useReducer(localReducer, {
    schedule: null,
    enabled: true,
    dirty: false,
    syncKey: '',
  })

  // Sync local state from server data via reducer (pure — no refs, no effects)
  if (syncKey && syncKey !== local.syncKey && data && data.rooms[selectedRoom]) {
    dispatch({
      type: 'sync',
      schedule: data.rooms[selectedRoom].schedule,
      enabled: data.rooms[selectedRoom].enabled,
      syncKey,
    })
  }

  const localSchedule = local.schedule
  const localEnabled = local.enabled
  const dirty = local.dirty

  const handleScheduleChange = useCallback((schedule: WeekSchedule) => {
    dispatch({ type: 'setSchedule', schedule })
  }, [])

  const handleSave = async () => {
    if (!localSchedule || !selectedRoom) return
    await update(selectedRoom, localSchedule, localEnabled)
    dispatch({ type: 'clearDirty' })
    refetch()
  }

  const handlePreset = async (preset: PresetName) => {
    await apply(selectedRoom, preset)
    refetch()
  }

  const handleCopy = async (targets: string[]) => {
    await copy(selectedRoom, targets)
    refetch()
  }

  const WEEKDAYS: DayName[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
  const WEEKENDS: DayName[] = ['saturday', 'sunday']

  const handleApplyToWeekdays = () => {
    if (!localSchedule) return
    const sourceBlocks = localSchedule[sourceDay] || []
    const updated = { ...localSchedule }
    for (const day of WEEKDAYS) {
      if (day !== sourceDay) {
        updated[day] = [...sourceBlocks]
      }
    }
    dispatch({ type: 'setSchedule', schedule: updated })
  }

  const handleApplyToWeekend = () => {
    if (!localSchedule) return
    const sourceBlocks = localSchedule[sourceDay] || []
    const updated = { ...localSchedule }
    for (const day of WEEKENDS) {
      if (day !== sourceDay) {
        updated[day] = [...sourceBlocks]
      }
    }
    dispatch({ type: 'setSchedule', schedule: updated })
  }

  const handleApplyToAll = () => {
    if (!localSchedule) return
    const sourceBlocks = localSchedule[sourceDay] || []
    const updated = { ...localSchedule }
    for (const day of ALL_DAYS) {
      if (day !== sourceDay) {
        updated[day] = [...sourceBlocks]
      }
    }
    dispatch({ type: 'setSchedule', schedule: updated })
  }

  const handleCopyToDay = (targetDay: DayName) => {
    if (!localSchedule || targetDay === sourceDay) return
    const sourceBlocks = localSchedule[sourceDay] || []
    dispatch({ type: 'setSchedule', schedule: { ...localSchedule, [targetDay]: [...sourceBlocks] } })
  }

  const handleToggleEnabled = (enabled: boolean) => {
    dispatch({ type: 'setEnabled', enabled })
  }

  if (loading) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">Schedule</h1>
        <ComfortScheduleEditor />
        <p className="text-[var(--text-muted)]">Loading schedules...</p>
      </div>
    )
  }

  if (!data || rooms.length === 0) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">Schedule</h1>
        <ComfortScheduleEditor />
        <p className="text-[var(--text-muted)]">No rooms configured.</p>
      </div>
    )
  }

  // Check if selected room has an occupancy sensor (schedule is sensor-driven, not editable)
  const roomData = data?.rooms[selectedRoom]
  const hasSensor = roomData?.has_occupancy_sensor ?? false

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Schedule</h1>

      {/* Global comfort schedule (time-of-day temperature targets) */}
      <ComfortScheduleEditor />

      {/* Per-room occupancy schedules */}
      <ScheduleToolbar
        rooms={rooms}
        selectedRoom={selectedRoom}
        onRoomChange={setSelectedRoom}
        onPreset={hasSensor ? undefined : handlePreset}
        onCopy={hasSensor ? undefined : handleCopy}
        sourceDay={sourceDay}
        onApplyToWeekdays={hasSensor ? undefined : handleApplyToWeekdays}
        onApplyToWeekend={hasSensor ? undefined : handleApplyToWeekend}
        onApplyToAll={hasSensor ? undefined : handleApplyToAll}
        onCopyToDay={hasSensor ? undefined : handleCopyToDay}
        enabled={localEnabled}
        onToggleEnabled={hasSensor ? undefined : handleToggleEnabled}
        presetLoading={applyingPreset}
        copyLoading={copying}
        disabled={hasSensor}
      />

      {/* Stale schedule warning: no sensor AND schedule disabled */}
      {roomData && !roomData.has_occupancy_sensor && !roomData.enabled && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>{selectedRoom.replace(/_/g, ' ')}</strong> has no occupancy sensor and the schedule is currently disabled.
            If you previously relied on a sensor for this room, enable and review the schedule
            to make sure it reflects your routine.
          </p>
        </div>
      )}

      {hasSensor ? (
        <div className="mt-6 p-6 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-center">
          <div className="text-sm font-medium text-[var(--text)] mb-2">
            Occupancy sensor active
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            This room uses a presence sensor ({roomData?.occupancy_sensor_entity}) for occupancy detection.
            The schedule editor is disabled because occupancy is determined by the sensor, not a fixed timetable.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">
            <span className="w-2 h-2 rounded-full bg-current" />
            Sensor: {roomData?.current_state === 'occupied' ? 'Occupied' : 'Unoccupied'}
          </div>
        </div>
      ) : (
        <>
          {localSchedule && (
            <WeeklyGrid
              schedule={localSchedule}
              onChange={handleScheduleChange}
              selectedDay={sourceDay}
              onSelectDay={setSourceDay}
            />
          )}

          <div className="mt-2 text-xs text-[var(--text-muted)]">
            Setback depth is calculated automatically from absence duration and building thermal properties.
          </div>

          {/* Save button */}
          <div className="mt-4">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-6 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {dirty && (
              <span className="ml-3 text-xs text-amber-500">Unsaved changes</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
