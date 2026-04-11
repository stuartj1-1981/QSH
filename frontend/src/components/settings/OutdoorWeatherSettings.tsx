import { useState, useMemo } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { patchOrDelete } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { EntityField } from './EntityField'
import type { OutdoorYaml } from '../../types/config'

interface OutdoorWeatherSettingsProps {
  outdoor?: OutdoorYaml
  onRefetch: () => void
}

export function OutdoorWeatherSettings({
  outdoor: initialOutdoor,
  onRefetch,
}: OutdoorWeatherSettingsProps) {
  const [outdoor, setOutdoor] = useState<OutdoorYaml>(initialOutdoor || {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entityIds = useMemo(
    () =>
      [outdoor.temperature, outdoor.weather_forecast].filter(Boolean) as string[],
    [outdoor.temperature, outdoor.weather_forecast]
  )
  const { resolved } = useEntityResolve(entityIds)

  const hasAnyField = !!(outdoor.temperature || outdoor.weather_forecast)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await patchOrDelete('outdoor', hasAnyField, outdoor)
      onRefetch()
    } catch {
      setError('Failed to save outdoor settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Outdoor & Weather</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[var(--red)]/10 text-[var(--red)] text-sm">
          {error}
        </div>
      )}

      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <EntityField
          label="Outdoor Temperature Sensor"
          value={outdoor.temperature || ''}
          friendlyName={resolved[outdoor.temperature || '']?.friendly_name}
          state={resolved[outdoor.temperature || '']?.state}
          unit={resolved[outdoor.temperature || '']?.unit}
          onChange={(v) => setOutdoor({ ...outdoor, temperature: v || undefined })}
          placeholder="sensor.outdoor_temperature"
          helpText="Used for weather compensation — adjusts flow temperature based on how cold it is outside."
        />

        <EntityField
          label="Weather Forecast Entity"
          value={outdoor.weather_forecast || ''}
          friendlyName={resolved[outdoor.weather_forecast || '']?.friendly_name}
          state={resolved[outdoor.weather_forecast || '']?.state}
          unit={resolved[outdoor.weather_forecast || '']?.unit}
          onChange={(v) => setOutdoor({ ...outdoor, weather_forecast: v || undefined })}
          placeholder="weather.forecast_home"
          helpText="Provides forecast data for predictive pre-heating and shoulder season detection."
        />
      </div>
    </div>
  )
}
