import { useState, useEffect } from 'react'
import { useRawConfig, useConfig } from '../hooks/useConfig'
import { apiUrl } from '../lib/api'
import { SettingsLayout, type SettingsSection } from '../components/settings/SettingsLayout'
import { RoomSettings } from '../components/settings/RoomSettings'
import { BuildingLayout } from '../components/settings/BuildingLayout'
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
import { SnapshotsPanel } from '../components/settings/SnapshotsPanel'
import { SystemSettings } from '../components/settings/SystemSettings'
import { Loader2 } from 'lucide-react'
import type { Driver } from '../types/config'

interface SettingsProps {
  onRunWizard: () => void
}

export function Settings({ onRunWizard }: SettingsProps) {
  const [section, setSection] = useState<SettingsSection>('rooms')
  const { data, loading, refetch } = useRawConfig()
  // INSTRUCTION-544B T10(a)/T11(b) — antifrost, shoulder and overtemp now
  // read from the processed config (defaults merged) rather than from the
  // WebSocket engineering block or a bespoke control-API fetch, so the
  // screen self-corrects within the round trip after a write (P19, P35).
  const { data: procConfig, refetch: refetchProcConfig } = useConfig()

  // INSTRUCTION-351B — octopus_dhw_signal_available is a derived runtime flag on
  // the PROCESSED /api/config (351A Task 4), not a raw-YAML key, so it is absent
  // from useRawConfig's data. Fetch it directly — a non-YAML derived value.
  // Re-read whenever the raw config reloads (i.e. after any Save → refetch),
  // so configuring the Octopus API in Tariff settings flips the flag without
  // a manual page reload. Gates the Hot Water → Schedule Source "Octopus" radio.
  const [octopusDhwAvailable, setOctopusDhwAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch(apiUrl('api/config'))
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((json) => {
        if (!cancelled && json) setOctopusDhwAvailable(json.octopus_dhw_signal_available === true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [data])

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

    const driver: Driver = data.driver ?? 'ha'

    switch (section) {
      case 'rooms':
        return (
          <RoomSettings
            rooms={data.rooms || {}}
            property={data.property || {}}
            construction_year={data.construction_year}
            fabric_class={data.fabric_class}
            batteryDevices={data.battery_devices ?? []}
            driver={driver}
            onRefetch={refetch}
          />
        )
      case 'building-layout':
        return <BuildingLayout onRefetch={refetch} />
      case 'heat_source':
        return (
          <HeatSourceSettings
            heatSource={data.heat_source || { type: 'heat_pump' }}
            heatSources={data.heat_sources}
            sourceSelection={data.source_selection}
            rootConfig={data}
            mqtt={data.mqtt}
            driver={driver}
            onRefetch={refetch}
          />
        )
      case 'tariff':
        return <TariffSettings energy={data.energy || {}} heatSource={data.heat_source} heatSources={data.heat_sources} driver={driver} onRefetch={refetch} />
      case 'thermal':
        return (
          <ThermalSettings
            thermal={data.thermal || {}}
            shoulder={data.shoulder || {}}
            summer={data.summer || {}}
            rooms={Object.keys(data.rooms || {})}
            driver={driver}
            onRefetch={refetch}
            heatSources={data.heat_sources}
            overtempThreshold={procConfig?.overtemp_protection_internal ?? null}
            onRefetchProcessed={refetchProcConfig}
          />
        )
      case 'control':
        return <ControlSettings control={data.control || {}} rootConfig={data} driver={driver} onRefetch={refetch} />
      case 'external_setpoints':
        return <ExternalSetpointSettings driver={driver} onRefetch={refetch} />
      case 'seasonal_tuning':
        return (
          <SeasonalTuningSettings
            antifrostThreshold={procConfig?.antifrost_oat_threshold_internal ?? null}
            shoulderThreshold={procConfig?.hp_min_output_kw_internal ?? null}
            heatSources={data.heat_sources}
            driver={driver}
            onRefetch={refetch}
            onRefetchProcessed={refetchProcConfig}
          />
        )
      case 'outdoor_weather':
        return <OutdoorWeatherSettings outdoor={data.outdoor} mqtt={data.mqtt} driver={driver} onRefetch={refetch} />
      case 'solar_battery':
        return (
          <SolarBatterySettings
            solar={data.solar}
            battery={data.battery}
            grid={data.grid}
            inverter={data.inverter}
            mqtt={data.mqtt}
            driver={driver}
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
            heatSource={data.heat_source}
            mqtt={data.mqtt}
            driver={driver}
            octopusDhwAvailable={octopusDhwAvailable}
            onRefetch={refetch}
          />
        )
      case 'historian':
        return <HistorianSettings historian={data.historian} driver={driver} onRefetch={refetch} />
      case 'data_sharing':
        return (
          <DataSharingSettings
            telemetry={data.telemetry}
            disclaimerAccepted={data.disclaimer_accepted}
            driver={driver}
            onRefetch={refetch}
          />
        )
      case 'backup':
        return (
          <div className="space-y-6">
            <BackupRestore driver={driver} />
            <SnapshotsPanel />
          </div>
        )
      case 'system':
        return (
          <SystemSettings
            driver={driver}
            scheduleTimezone={data.schedule_timezone}
            onRefetch={refetch}
            onRunWizard={onRunWizard}
          />
        )
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
