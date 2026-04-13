import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { patchOrDelete } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { useMqttTopicScan } from '../../hooks/useMqttTopicScan'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import type { OutdoorYaml, MqttConfig, Driver } from '../../types/config'
import { apiUrl } from '../../lib/api'

interface OutdoorWeatherSettingsProps {
  outdoor?: OutdoorYaml
  mqtt?: MqttConfig
  driver: Driver
  onRefetch: () => void
}

export function OutdoorWeatherSettings({
  outdoor: initialOutdoor,
  mqtt,
  driver,
  onRefetch,
}: OutdoorWeatherSettingsProps) {
  const [outdoor, setOutdoor] = useState<OutdoorYaml>(initialOutdoor || {})
  const [mqttOutdoorTopic, setMqttOutdoorTopic] = useState(
    mqtt?.inputs?.outdoor_temp?.topic ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setOutdoor(initialOutdoor || {}) }, [initialOutdoor])
  useEffect(() => {
    setMqttOutdoorTopic(mqtt?.inputs?.outdoor_temp?.topic ?? '')
  }, [mqtt])

  const entityIds = useMemo(
    () =>
      [outdoor.temperature, outdoor.weather_forecast].filter(Boolean) as string[],
    [outdoor.temperature, outdoor.weather_forecast]
  )
  const { resolved } = useEntityResolve(entityIds, driver)

  const { topics: scannedTopics, scan } = useMqttTopicScan()

  const hasAnyField = driver === 'mqtt'
    ? !!mqttOutdoorTopic
    : !!(outdoor.temperature || outdoor.weather_forecast)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (driver === 'mqtt') {
        // PATCH the full mqtt object with the outdoor_temp topic mutated.
        // The PATCH endpoint does full-section replacement, so we must send
        // the complete mqtt subtree to avoid wiping broker/port/credentials.
        const updatedMqtt = {
          ...mqtt,
          inputs: {
            ...mqtt?.inputs,
            outdoor_temp: mqttOutdoorTopic
              ? { ...mqtt?.inputs?.outdoor_temp, topic: mqttOutdoorTopic }
              : undefined,
          },
        }
        // Clean up undefined input
        if (!updatedMqtt.inputs.outdoor_temp) {
          delete (updatedMqtt.inputs as Record<string, unknown>).outdoor_temp
        }
        const resp = await fetch(apiUrl('api/config/mqtt'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: updatedMqtt }),
        })
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
          throw new Error(err.detail || `HTTP ${resp.status}`)
        }
      } else {
        await patchOrDelete('outdoor', hasAnyField, outdoor)
      }
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
        {driver === 'mqtt' ? (
          <>
            <TopicField
              label="Outdoor Temperature Topic"
              value={mqttOutdoorTopic}
              onChange={setMqttOutdoorTopic}
              placeholder="temps/outsideTemp"
              helpText="MQTT topic publishing the outdoor temperature. Used for weather compensation."
              onDiscover={() => void scan()}
              lastPayload={scannedTopics.includes(mqttOutdoorTopic) ? 'seen in scan' : undefined}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Weather forecast integration is HA-driver-only. MQTT installs use shoulder-mode detection from outdoor topic history.
            </p>
          </>
        ) : (
          <>
            <EntityField
              label="Outdoor Temperature Sensor"
              value={outdoor.temperature || ''}
              friendlyName={resolved[outdoor.temperature || '']?.friendly_name}
              state={resolved[outdoor.temperature || '']?.state}
              unit={resolved[outdoor.temperature || '']?.unit}
              onChange={(v) => setOutdoor(prev => ({ ...prev, temperature: v || undefined }))}
              placeholder="sensor.outdoor_temperature"
              helpText="Used for weather compensation — adjusts flow temperature based on how cold it is outside."
            />

            <EntityField
              label="Weather Forecast Entity"
              value={outdoor.weather_forecast || ''}
              friendlyName={resolved[outdoor.weather_forecast || '']?.friendly_name}
              state={resolved[outdoor.weather_forecast || '']?.state}
              unit={resolved[outdoor.weather_forecast || '']?.unit}
              onChange={(v) => setOutdoor(prev => ({ ...prev, weather_forecast: v || undefined }))}
              placeholder="weather.forecast_home"
              helpText="Provides forecast data for predictive pre-heating and shoulder season detection."
            />
          </>
        )}
      </div>
    </div>
  )
}
