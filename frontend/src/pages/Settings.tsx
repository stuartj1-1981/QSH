import { useState, useEffect, useCallback } from 'react'
import { useRawConfig } from '../hooks/useConfig'
import { useLive } from '../hooks/useLive'
import { apiUrl } from '../lib/api'
import { SettingsLayout, type SettingsSection } from '../components/settings/SettingsLayout'
import { RoomSettings } from '../components/settings/RoomSettings'
import { HeatSourceSettings } from '../components/settings/HeatSourceSettings'
import { TariffSettings } from '../components/settings/TariffSettings'
import { ThermalSettings } from '../components/settings/ThermalSettings'
import { ControlSettings } from '../components/settings/ControlSettings'
import { ExternalSetpointSettings } from '../components/settings/ExternalSetpointSettings'
import { SeasonalTuningSettings } from '../components/settings/SeasonalTuningSettings'
import { OutdoorWeatherSettings } from '../components/settings/OutdoorWeatherSettings'
import { SolarBatterySettings } from '../components/settings/SolarBatterySettings'
import { HotWaterSettings } from '../components/settings/HotWaterSettings'
import { HistorianSettings } from '../components/settings/HistorianSettings'
import { DataSharingSettings } from '../components/settings/DataSharingSettings'
import { BackupRestore } from '../components/settings/BackupRestore'
import { SystemSettings } from '../components/settings/SystemSettings'
import { Loader2 } from 'lucide-react'

interface SettingsProps {
  onRunWizard: () => void
}

export function Settings({ onRunWizard }: SettingsProps) {
  const [section, setSection] = useState<SettingsSection>('rooms')
  const { data, loading, refetch } = useRawConfig()
  const { data: live } = useLive()

  // Shoulder threshold — not in YAML raw config, fetch from control API
  const [shoulderThreshold, setShoulderThreshold] = useState<number | null>(null)
  const [shoulderTick, setShoulderTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    fetch(apiUrl('api/control/shoulder-threshold'))
      .then((resp) => resp.ok ? resp.json() : null)
      .then((json) => {
        if (!cancelled && json) setShoulderThreshold(json.hp_min_output_kw ?? null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [shoulderTick])

  const handleSeasonalRefetch = useCallback(() => {
    setShoulderTick((t) => t + 1)
    refetch()
  }, [refetch])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
      </div>
    )
  }

  const renderSection = () => {
    if (!data) {
      return (
        <p className="text-sm text-[var(--text-muted)]">
          Unable to load configuration.
        </p>
      )
    }

    switch (section) {
      case 'rooms':
        return <RoomSettings rooms={data.rooms || {}} onRefetch={refetch} />
      case 'heat_source':
        return (
          <HeatSourceSettings
            heatSource={data.heat_source || { type: 'heat_pump' }}
            heatSources={data.heat_sources}
            sourceSelection={data.source_selection}
            rootConfig={data}
            onRefetch={refetch}
          />
        )
      case 'tariff':
        return <TariffSettings energy={data.energy || {}} heatSource={data.heat_source} onRefetch={refetch} />
      case 'thermal':
        return (
          <ThermalSettings
            thermal={data.thermal || {}}
            rooms={Object.keys(data.rooms || {})}
            onRefetch={refetch}
          />
        )
      case 'control':
        return <ControlSettings control={data.control || {}} rootConfig={data} onRefetch={refetch} />
      case 'external_setpoints':
        return <ExternalSetpointSettings onRefetch={refetch} />
      case 'seasonal_tuning':
        return (
          <SeasonalTuningSettings
            antifrostThreshold={live?.engineering?.antifrost_threshold ?? null}
            shoulderThreshold={shoulderThreshold}
            onRefetch={handleSeasonalRefetch}
          />
        )
      case 'outdoor_weather':
        return <OutdoorWeatherSettings outdoor={data.outdoor} onRefetch={refetch} />
      case 'solar_battery':
        return (
          <SolarBatterySettings
            solar={data.solar}
            battery={data.battery}
            grid={data.grid}
            inverter={data.inverter}
            onRefetch={refetch}
          />
        )
      case 'hot_water':
        return (
          <HotWaterSettings
            hwPlan={data.hw_plan}
            hwSchedule={data.hw_schedule}
            hwTank={data.hw_tank}
            hwPrecharge={data.hw_precharge}
            onRefetch={refetch}
          />
        )
      case 'historian':
        return <HistorianSettings historian={data.historian} onRefetch={refetch} />
      case 'data_sharing':
        return (
          <DataSharingSettings
            telemetry={data.telemetry}
            disclaimerAccepted={data.disclaimer_accepted}
            onRefetch={refetch}
          />
        )
      case 'backup':
        return <BackupRestore />
      case 'system':
        return <SystemSettings onRunWizard={onRunWizard} />
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-[var(--text)] mb-6">Settings</h1>
      <SettingsLayout activeSection={section} onSectionChange={setSection}>
        {renderSection()}
      </SettingsLayout>
    </div>
  )
}
