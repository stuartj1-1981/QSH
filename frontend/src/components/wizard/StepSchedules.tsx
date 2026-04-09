import { cn } from '../../lib/utils'
import type { OccupancyScheduleYaml, QshConfigYaml } from '../../types/config'

interface StepSchedulesProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

const PRESETS = [
  { id: 'always', label: 'Always Home', schedule: 'always' },
  { id: 'weekday_9to5', label: '9-to-5 Weekdays', schedule: { weekday: '06:30-08:30,17:00-22:30', weekend: 'always' } },
  { id: 'bedrooms', label: 'Bedrooms Overnight', schedule: { weekday: '21:00-07:30', weekend: '21:00-09:00' } },
  { id: 'custom', label: 'Custom', schedule: null },
] as const

export function StepSchedules({ config, onUpdate }: StepSchedulesProps) {
  const rooms = config.rooms || {}
  const occupancy = (config.occupancy || {}) as Record<string, OccupancyScheduleYaml>
  const roomNames = Object.keys(rooms)

  const getPresetId = (roomOcc: OccupancyScheduleYaml | undefined): string => {
    if (!roomOcc || !roomOcc.schedule) return 'always'
    const sched = roomOcc.schedule
    if (sched === 'always') return 'always'
    if (typeof sched === 'object') {
      if (sched.weekday === '06:30-08:30,17:00-22:30' && sched.weekend === 'always') return 'weekday_9to5'
      if (sched.weekday === '21:00-07:30' && sched.weekend === '21:00-09:00') return 'bedrooms'
    }
    return 'custom'
  }

  const setPreset = (roomName: string, presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const sched = preset.schedule ?? occupancy[roomName]?.schedule ?? 'always'
    onUpdate('occupancy', { ...occupancy, [roomName]: { schedule: sched } })
  }

  const setCustomSchedule = (roomName: string, value: string) => {
    onUpdate('occupancy', { ...occupancy, [roomName]: { schedule: value } })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Schedules</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Set initial occupancy schedules for each room.
          {config.driver !== 'mqtt' && ' These can be refined later via HA schedule helpers.'}
        </p>
      </div>

      {roomNames.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No rooms defined. Go back to add rooms first.
        </p>
      ) : (
        <div className="space-y-4">
          {roomNames.map((name) => {
            const currentPreset = getPresetId(occupancy[name])
            const isCustom = currentPreset === 'custom'
            const sched = occupancy[name]?.schedule

            return (
              <div
                key={name}
                className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]"
              >
                <h3 className="text-sm font-medium text-[var(--text)] mb-3">
                  {name.replace(/_/g, ' ')}
                </h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setPreset(name, preset.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                        currentPreset === preset.id
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:border-[var(--accent)]/50'
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {isCustom && (
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      Format: "HH:MM-HH:MM,HH:MM-HH:MM" or "always"
                    </label>
                    <input
                      type="text"
                      value={typeof sched === 'string' ? sched : JSON.stringify(sched)}
                      onChange={(e) => setCustomSchedule(name, e.target.value)}
                      placeholder="07:00-09:00,17:00-23:00"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                )}

                {!isCustom && sched && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {typeof sched === 'string'
                      ? sched
                      : `Weekday: ${sched.weekday || 'always'} | Weekend: ${sched.weekend || 'always'}`}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
