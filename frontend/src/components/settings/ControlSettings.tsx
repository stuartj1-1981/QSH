import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { apiUrl } from '../../lib/api'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import type { ControlYaml, QshConfigYaml, Driver } from '../../types/config'

interface ControlSettingsProps {
  control: ControlYaml
  rootConfig?: QshConfigYaml
  driver: Driver
  onRefetch: () => void
}

export function ControlSettings({ control: initial, rootConfig, driver: _driver, onRefetch }: ControlSettingsProps) {
  const [ctrl, setCtrl] = useState<ControlYaml>(initial)
  const { patch, saving } = usePatchConfig()

  useEffect(() => { setCtrl(initial) }, [initial])

  const effectiveDriver = rootConfig?.driver ?? 'ha'
  const publishShadow = rootConfig?.publish_mqtt_shadow ?? true

  const entityIds = useMemo(
    () => effectiveDriver === 'mqtt' ? [] : [ctrl.dfan_control_entity, ctrl.pid_target_entity].filter(Boolean) as string[],
    [ctrl.dfan_control_entity, ctrl.pid_target_entity, effectiveDriver]
  )
  const { resolved } = useEntityResolve(entityIds)

  const save = async () => {
    const result = await patch('control', ctrl)
    if (result) onRefetch()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Control</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        {/* Active Control */}
        <div>
          {effectiveDriver === 'ha' ? (
            <EntityField
              label="Active Control"
              value={ctrl.dfan_control_entity ?? ''}
              friendlyName={resolved[ctrl.dfan_control_entity ?? '']?.friendly_name}
              state={resolved[ctrl.dfan_control_entity ?? '']?.state}
              unit={resolved[ctrl.dfan_control_entity ?? '']?.unit}
              placeholder="input_boolean.dfan_control"
              onChange={(v) => setCtrl(prev => ({ ...prev, dfan_control_entity: v }))}
            />
          ) : (
            <TopicField
              label="Active Control Topic"
              value={ctrl.dfan_control_topic ?? ''}
              onChange={(v) => setCtrl(prev => ({ ...prev, dfan_control_topic: v }))}
              placeholder="control/dfan_control"
            />
          )}
          {effectiveDriver === 'ha' && !ctrl.dfan_control_entity && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">(using internal value)</p>
          )}
          {effectiveDriver === 'mqtt' && !ctrl.dfan_control_topic && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">(using internal value)</p>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-2">
            {effectiveDriver === 'ha'
              ? (ctrl.dfan_control_entity
                  ? 'QSH reads the bound entity state each cycle. ON = active control, OFF = shadow mode.'
                  : 'When ON, QSH controls your heat source. When OFF, QSH monitors only (shadow mode). Can also be toggled from HA dashboard or MQTT.')
              : 'Boolean topic. Publish true/on to enable active control, false/off for shadow mode.'}
          </p>
        </div>

        {/* PID Target Temperature */}
        <div>
          {effectiveDriver === 'ha' ? (
            <EntityField
              label="PID Target Temperature (°C)"
              value={ctrl.pid_target_entity ?? ''}
              friendlyName={resolved[ctrl.pid_target_entity ?? '']?.friendly_name}
              state={resolved[ctrl.pid_target_entity ?? '']?.state}
              unit={resolved[ctrl.pid_target_entity ?? '']?.unit}
              placeholder="input_number.pid_target_temperature"
              onChange={(v) => setCtrl(prev => ({ ...prev, pid_target_entity: v }))}
            />
          ) : (
            <TopicField
              label="PID Target Temperature Topic (°C)"
              value={ctrl.pid_target_topic ?? ''}
              onChange={(v) => setCtrl(prev => ({ ...prev, pid_target_topic: v }))}
              placeholder="control/pid_target"
            />
          )}
          {effectiveDriver === 'ha' && !ctrl.pid_target_entity && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">(using internal value)</p>
          )}
          {effectiveDriver === 'mqtt' && !ctrl.pid_target_topic && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">(using internal value)</p>
          )}
        </div>

        {/* Nudge Budget */}
        <div>
          <label className="block text-xs font-medium text-[var(--text)] mb-1">
            Nudge Budget
          </label>
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="5.0"
            value={ctrl.nudge_budget ?? 3.0}
            onChange={(e) =>
              setCtrl(prev => ({ ...prev, nudge_budget: parseFloat(e.target.value) || 3.0 }))
            }
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">Range: 0.5 to 5.0</p>
        </div>
      </div>

      {effectiveDriver === 'mqtt' && (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-[var(--text)]">
                Publish MQTT Shadow Topics
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                When enabled, QSH publishes shadow metrics and state to MQTT topics.
                Disable if you only use the QSH Web interface.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await fetch(apiUrl('api/config/root'), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: { publish_mqtt_shadow: !publishShadow } }),
                  })
                  onRefetch()
                } catch {
                  // Ignore — will retry on next save
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${
                publishShadow ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  publishShadow ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
