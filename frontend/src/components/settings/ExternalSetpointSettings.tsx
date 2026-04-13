import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2, AlertTriangle, CheckCircle } from 'lucide-react'
import { useExternalSetpoints } from '../../hooks/useExternalSetpoints'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { EntityField } from './EntityField'
import { SETPOINT_RANGES, type Driver } from '../../types/config'

interface ExternalSetpointSettingsProps {
  driver: Driver
  onRefetch: () => void
}

const TEMP_KEYS = ['comfort_temp', 'overtemp_protection'] as const
const FLOW_KEYS = ['flow_min_temp', 'flow_max_temp'] as const
const SEASONAL_KEYS = ['antifrost_oat_threshold', 'shoulder_threshold'] as const
const ALL_KEYS = [...TEMP_KEYS, ...FLOW_KEYS, ...SEASONAL_KEYS]

export function ExternalSetpointSettings({ driver, onRefetch }: ExternalSetpointSettingsProps) {
  const { data, loading, error, saving, save } = useExternalSetpoints()
  const [success, setSuccess] = useState(false)

  // Local state for the 6 entity ID fields
  const [local, setLocal] = useState<Record<string, string>>({
    comfort_temp: '',
    flow_min_temp: '',
    flow_max_temp: '',
    antifrost_oat_threshold: '',
    shoulder_threshold: '',
    overtemp_protection: '',
  })

  // Sync local state when data loads/changes
  useEffect(() => {
    if (data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from fetched data is intentional
      setLocal({
        comfort_temp: data.comfort_temp ?? '',
        flow_min_temp: data.flow_min_temp ?? '',
        flow_max_temp: data.flow_max_temp ?? '',
        antifrost_oat_threshold: data.antifrost_oat_threshold ?? '',
        shoulder_threshold: data.shoulder_threshold ?? '',
        overtemp_protection: data.overtemp_protection ?? '',
      })
    }
  }, [data])

  // Collect non-empty entity IDs for resolution
  const entityIds = useMemo(
    () => ALL_KEYS.map((k) => local[k]).filter(Boolean),
    [local]
  )
  const { resolved } = useEntityResolve(entityIds)

  const handleSave = async () => {
    setSuccess(false)
    // Diff against data (last-fetched state)
    const updates: Record<string, string> = {}
    for (const key of ALL_KEYS) {
      if (local[key] !== (data?.[key as keyof typeof data] ?? '')) {
        updates[key] = local[key]
      }
    }
    if (Object.keys(updates).length === 0) {
      setSuccess(true)
      return
    }
    await save(updates)
    if (!error) {
      setSuccess(true)
      onRefetch()
    }
  }

  if (driver === 'mqtt') {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-bold text-[var(--text)]">External Setpoints</h2>
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-sm text-[var(--text-muted)]">
          External setpoint entity binding is a Home Assistant driver feature. On MQTT driver,
          publish setpoint values directly to the corresponding command topics configured in
          Control and Heat Source settings. If you haven&apos;t configured those topics yet, do that
          first — there is no setpoint binding to do here until they exist.
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">External Setpoint Entities</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Bind a Home Assistant entity to override each setpoint. Leave blank to use the internal value.
      </p>

      {error && (
        <div className="px-3 py-2 rounded border border-red-500/30 bg-red-500/5 text-red-600 text-xs">
          {error}
        </div>
      )}

      {success && !error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-green-500/30 bg-green-500/5 text-green-600 text-xs">
          <CheckCircle size={14} />
          Settings saved successfully.
        </div>
      )}

      {/* Temperature Control group */}
      <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <h3 className="text-sm font-medium text-[var(--text)]">Temperature Control</h3>
        {TEMP_KEYS.map((key) => (
          <SetpointField
            key={key}
            fieldKey={key}
            value={local[key]}
            resolved={resolved}
            onChange={(v) => setLocal((prev) => ({ ...prev, [key]: v }))}
          />
        ))}
      </div>

      {/* Flow Temperature group */}
      <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <h3 className="text-sm font-medium text-[var(--text)]">Flow Temperature</h3>
        {FLOW_KEYS.map((key) => (
          <SetpointField
            key={key}
            fieldKey={key}
            value={local[key]}
            resolved={resolved}
            onChange={(v) => setLocal((prev) => ({ ...prev, [key]: v }))}
          />
        ))}
      </div>

      {/* Seasonal Thresholds group */}
      <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <h3 className="text-sm font-medium text-[var(--text)]">Seasonal Thresholds</h3>
        {SEASONAL_KEYS.map((key) => (
          <SetpointField
            key={key}
            fieldKey={key}
            value={local[key]}
            resolved={resolved}
            onChange={(v) => setLocal((prev) => ({ ...prev, [key]: v }))}
          />
        ))}
      </div>
    </div>
  )
}

interface SetpointFieldProps {
  fieldKey: string
  value: string
  resolved: Record<string, { friendly_name: string; state: string; unit: string }>
  onChange: (value: string) => void
}

function SetpointField({ fieldKey, value, resolved, onChange }: SetpointFieldProps) {
  const range = SETPOINT_RANGES[fieldKey]
  const entity = value ? resolved[value] : undefined
  const numericValue = entity?.state ? parseFloat(entity.state) : NaN
  const outOfRange = !isNaN(numericValue) && (numericValue < range.min || numericValue > range.max)

  return (
    <div>
      <EntityField
        label={`${range.label} (${range.unit})`}
        value={value}
        friendlyName={entity?.friendly_name}
        state={entity?.state}
        unit={entity?.unit}
        placeholder={range.placeholder}
        onChange={onChange}
      />
      {value && entity?.state && !isNaN(numericValue) && (
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          Current: {numericValue}{range.unit}
        </div>
      )}
      {!value && (
        <p className="mt-1 text-xs text-[var(--text-muted)]">(using internal value)</p>
      )}
      {outOfRange && (
        <div className="mt-1 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/5 text-amber-600 text-xs flex items-center gap-1.5">
          <AlertTriangle size={12} />
          Value {numericValue}{range.unit} is outside safe range ({range.min}–{range.max}{range.unit})
        </div>
      )}
    </div>
  )
}
