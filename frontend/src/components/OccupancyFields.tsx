import type { ReactNode } from 'react'
import type { RoomConfigYaml } from '../types/config'
import { HelpTip } from './HelpTip'
import { OCCUPANCY } from '../lib/helpText'
import { suggestOccupancyClass } from '../lib/occupancy'

interface OccupancyFieldsProps {
  room: RoomConfigYaml
  onChange: (changes: Partial<RoomConfigYaml>) => void
  /** Driver-specific sensor selector — EntityField, EntityPicker,
   *  TopicField or TopicPicker. Rendered first, inside this block, so the
   *  operator reads selector-then-settings in one region on all four
   *  surfaces. */
  sensorSlot: ReactNode
  /** True when a sensor is configured on whichever driver applies. The
   *  caller decides: `!!room.occupancy_sensor` on HA,
   *  `!!room.mqtt_topics?.occupancy_sensor` on MQTT. This component must
   *  not read mqtt_topics — that is the caller's driver knowledge, not
   *  this component's. */
  sensorConfigured: boolean
  /** HA device_class of the selected sensor, when known. Drives the
   *  suggestion hint only — never written to config. */
  deviceClass?: string
  /** Optional id prefix so two instances on one page keep label/input
   *  associations unique. */
  idPrefix?: string
}

export function OccupancyFields({
  room,
  onChange,
  sensorSlot,
  sensorConfigured,
  deviceClass,
  idPrefix,
}: OccupancyFieldsProps) {
  const prefix = idPrefix ? `${idPrefix}-` : ''
  const effectiveClass = room.occupancy_class ?? 'motion'
  const suggested = suggestOccupancyClass(room.occupancy_sensor, deviceClass)
  const showHint = sensorConfigured && suggested !== null && suggested !== effectiveClass

  return (
    <div className="space-y-3">
      {sensorSlot}
      {sensorConfigured && (
        <>
          <div>
            <label
              htmlFor={`${prefix}occupancy-class`}
              className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1"
            >
              Sensor Type
              <HelpTip text={OCCUPANCY.sensorClass} size={12} />
            </label>
            <select
              id={`${prefix}occupancy-class`}
              value={effectiveClass}
              onChange={(e) =>
                onChange({ occupancy_class: e.target.value as RoomConfigYaml['occupancy_class'] })
              }
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            >
              <option value="motion">Motion (PIR)</option>
              <option value="presence">Presence (mmWave / radar)</option>
            </select>
            {showHint && (
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Looks like a {suggested} sensor.
              </p>
            )}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={room.predictive_occupancy ?? false}
              onChange={(e) => onChange({ predictive_occupancy: e.target.checked })}
            />
            Predictive occupancy
            <HelpTip text={OCCUPANCY.predictive} size={12} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${prefix}occupancy-debounce`}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1"
              >
                Debounce (s)
                <HelpTip text={OCCUPANCY.debounce} size={12} />
              </label>
              <input
                id={`${prefix}occupancy-debounce`}
                type="number"
                step="10"
                min="0"
                max="600"
                value={room.occupancy_debounce ?? ''}
                onChange={(e) => {
                  const raw = e.target.value ? parseInt(e.target.value, 10) : undefined
                  const clamped = raw !== undefined ? Math.min(600, Math.max(0, raw)) : undefined
                  onChange({ occupancy_debounce: clamped })
                }}
                placeholder="60"
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${prefix}occupancy-fallback`}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1"
              >
                Sensor Unavailable Behaviour
                <HelpTip text={OCCUPANCY.fallback} size={12} />
              </label>
              <select
                id={`${prefix}occupancy-fallback`}
                value={room.occupancy_fallback || 'schedule'}
                onChange={(e) =>
                  onChange({
                    occupancy_fallback: e.target.value as RoomConfigYaml['occupancy_fallback'],
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              >
                <option value="schedule">Use Schedule</option>
                <option value="occupied">Assume Occupied</option>
                <option value="last_known">Hold Last Known</option>
              </select>
            </div>
            {room.occupancy_fallback === 'last_known' && (
              <div>
                <label
                  htmlFor={`${prefix}occupancy-watchdog`}
                  className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1"
                >
                  Watchdog timeout (min)
                  <HelpTip text={OCCUPANCY.watchdog} size={12} />
                </label>
                <input
                  id={`${prefix}occupancy-watchdog`}
                  type="number"
                  step="5"
                  min="5"
                  max="480"
                  value={room.last_known_timeout_s != null ? Math.round(room.last_known_timeout_s / 60) : ''}
                  onChange={(e) => {
                    const mins = e.target.value ? parseInt(e.target.value, 10) : undefined
                    onChange({
                      last_known_timeout_s:
                        mins !== undefined ? Math.min(28800, Math.max(300, mins * 60)) : undefined,
                    })
                  }}
                  placeholder="60"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Degrade to &lsquo;occupied&rsquo; after this duration if sensor doesn&apos;t recover
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
