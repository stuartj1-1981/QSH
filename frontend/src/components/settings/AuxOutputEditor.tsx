import { useEffect } from 'react'
import { cn } from '../../lib/utils'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import type { AuxiliaryOutputYaml, Driver } from '../../types/config'
import type { useEntityResolve } from '../../hooks/useEntityResolve'

const DEFAULT_BLOCK: Required<Omit<AuxiliaryOutputYaml, 'ha_entity' | 'mqtt_topic'>> = {
  enabled: true,
  rated_kw: 0,
  min_on_time_s: 60,
  min_off_time_s: 60,
  max_cycles_per_hour: 6,
}

interface AuxOutputEditorProps {
  value: AuxiliaryOutputYaml | null | undefined
  onChange: (next: AuxiliaryOutputYaml | null) => void
  /** Reports the editor's current validity to the parent so Save can be
   *  disabled until the target field is filled. Called on every onChange
   *  via an effect so the parent always sees the latest state. */
  onValidityChange?: (valid: boolean) => void
  driver: Driver
  controlMode: 'indirect' | 'direct' | 'none' | undefined
  /** When undefined, EntityField degrades to a plain-text input — no
   *  resolver-driven autocomplete or status badge. The wizard step in 162B
   *  may not always thread the resolver; this contract lets the editor
   *  render correctly in both contexts. */
  resolved?: ReturnType<typeof useEntityResolve>['resolved']
}

/** Mirror server's validate_auxiliary_output_block validity rules.
 *  Returns true when the form is in a save-able state. */
function isValid(value: AuxiliaryOutputYaml | null | undefined, driver: Driver): boolean {
  if (!value) return true
  if (value.enabled !== true) {
    // Disabled blocks are always valid regardless of other fields.
    if ((value.rated_kw ?? 0) < 0) return false
    return true
  }
  if (driver === 'ha' && !value.ha_entity) return false
  if (driver === 'mqtt' && !value.mqtt_topic) return false
  if ((value.rated_kw ?? 0) < 0) return false
  return true
}

export function AuxOutputEditor({
  value,
  onChange,
  onValidityChange,
  driver,
  controlMode,
  resolved,
}: AuxOutputEditorProps) {
  const enabled = value?.enabled === true
  const ratedKw = value?.rated_kw ?? 0

  useEffect(() => {
    onValidityChange?.(isValid(value, driver))
  }, [value, driver, onValidityChange])

  const toggleEnabled = (next: boolean) => {
    if (!next) {
      onChange(null)
      return
    }
    onChange({ ...DEFAULT_BLOCK })
  }

  const setField = <K extends keyof AuxiliaryOutputYaml>(
    key: K,
    next: AuxiliaryOutputYaml[K]
  ) => {
    onChange({ ...DEFAULT_BLOCK, ...(value || {}), [key]: next, enabled: true })
  }

  // Warning text mirroring server-side warnings — surfaced inline next to
  // the offending field so the user can see what triggered the warning
  // without waiting for a 200-with-warnings round-trip.
  const ratedKwWarning =
    enabled && ratedKw > 10
      ? 'Rated kW > 10 — verify nameplate (typical: 0.3–3.0)'
      : null
  const sysidWarning =
    enabled && controlMode === 'none' && ratedKw === 0
      ? 'control_mode: none with rated_kw: 0 — sysid will not learn U/C for this room'
      : null
  const haPrefixWarning =
    enabled &&
    driver === 'ha' &&
    value?.ha_entity &&
    !(
      value.ha_entity.startsWith('switch.') ||
      value.ha_entity.startsWith('input_boolean.')
    )
      ? 'Entity should start with switch. or input_boolean.'
      : null

  const targetMissing =
    enabled &&
    ((driver === 'ha' && !value?.ha_entity) ||
      (driver === 'mqtt' && !value?.mqtt_topic))

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggleEnabled(e.target.checked)}
          className="rounded border-[var(--border)]"
        />
        Enable auxiliary output
      </label>

      {enabled && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              {driver === 'ha' ? (
                resolved !== undefined ? (
                  <EntityField
                    label="HA entity"
                    value={value?.ha_entity || ''}
                    friendlyName={resolved[value?.ha_entity || '']?.friendly_name}
                    state={resolved[value?.ha_entity || '']?.state}
                    unit={resolved[value?.ha_entity || '']?.unit}
                    placeholder="switch.lounge_panel_heater"
                    onChange={(v) => setField('ha_entity', v || null)}
                  />
                ) : (
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      HA entity
                    </label>
                    <input
                      type="text"
                      value={value?.ha_entity || ''}
                      onChange={(e) =>
                        setField('ha_entity', e.target.value.trim() || null)
                      }
                      placeholder="switch.lounge_panel_heater"
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                )
              ) : (
                <TopicField
                  label="MQTT topic"
                  value={value?.mqtt_topic || ''}
                  onChange={(v) => setField('mqtt_topic', v || null)}
                  placeholder="control/lounge/aux"
                />
              )}
              {targetMissing && (
                <p className="text-xs text-[var(--red)] mt-1">
                  Required when auxiliary output is enabled.
                </p>
              )}
              {haPrefixWarning && (
                <p className="text-xs text-[var(--amber)] mt-1">{haPrefixWarning}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                Rated kW
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={value?.rated_kw ?? 0}
                onChange={(e) =>
                  setField('rated_kw', parseFloat(e.target.value) || 0)
                }
                className={cn(
                  'w-full px-2 py-1.5 rounded border border-[var(--border)]',
                  'bg-[var(--bg)] text-xs text-[var(--text)]'
                )}
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Nameplate rated power. Required for sysid heat-balance accounting; leave 0 for monitor-only.
              </p>
              {ratedKwWarning && (
                <p className="text-xs text-[var(--amber)] mt-1">{ratedKwWarning}</p>
              )}
              {sysidWarning && (
                <p className="text-xs text-[var(--amber)] mt-1">{sysidWarning}</p>
              )}
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)] select-none">
              Engineering: protection numerics
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Min on time (s)
                </label>
                <input
                  type="number"
                  step="1"
                  min="10"
                  max="1800"
                  value={value?.min_on_time_s ?? 60}
                  onChange={(e) =>
                    setField('min_on_time_s', parseInt(e.target.value, 10) || 60)
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Min off time (s)
                </label>
                <input
                  type="number"
                  step="1"
                  min="10"
                  max="1800"
                  value={value?.min_off_time_s ?? 60}
                  onChange={(e) =>
                    setField('min_off_time_s', parseInt(e.target.value, 10) || 60)
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Max cycles per hour
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="30"
                  value={value?.max_cycles_per_hour ?? 6}
                  onChange={(e) =>
                    setField(
                      'max_cycles_per_hour',
                      parseInt(e.target.value, 10) || 6
                    )
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)]"
                />
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
