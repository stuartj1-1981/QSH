import { useState } from 'react'
import { Download, AlertTriangle, Check, Loader2 } from 'lucide-react'
import type { DeployResponse, QshConfigYaml, RoomConfigYaml } from '../../types/config'

interface StepReviewProps {
  config: Partial<QshConfigYaml>
  validationWarnings: string[]
  isDeploying: boolean
  onDeploy: () => Promise<DeployResponse | null>
}

export function StepReview({
  config,
  validationWarnings,
  isDeploying,
  onDeploy,
}: StepReviewProps) {
  const [deployResult, setDeployResult] = useState<DeployResponse | null>(null)

  const rooms = config.rooms ?? {}
  const hs = config.heat_source
  const outdoor = config.outdoor
  const energy = config.energy
  const thermal = config.thermal
  const isMqtt = config.driver === 'mqtt'
  const mqtt = (config.mqtt || {}) as Record<string, unknown>

  const downloadYaml = () => {
    const yaml = JSON.stringify(config, null, 2)
    const blob = new Blob([yaml], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'qsh_config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDeploy = async () => {
    const result = await onDeploy()
    if (result) setDeployResult(result)
  }

  if (deployResult?.deployed) {
    return (
      <div className="text-center space-y-6 py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--green)]/10">
          <Check size={32} className="text-[var(--green)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text)]">
          Configuration Deployed!
        </h2>
        <p className="text-[var(--text-muted)] max-w-md mx-auto">
          {deployResult.message}
        </p>
        {deployResult.warnings.length > 0 && (
          <div className="max-w-md mx-auto p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30 text-left">
            <p className="text-sm font-medium text-[var(--amber)] mb-2">Warnings:</p>
            <ul className="text-sm text-[var(--amber)] space-y-1">
              {deployResult.warnings.map((w, i) => (
                <li key={i}>- {w}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-[var(--text-muted)]">
          The pipeline is restarting. You'll be redirected to the dashboard shortly.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Review & Deploy</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Review your configuration before deploying it.
        </p>
      </div>

      {/* Warnings */}
      {validationWarnings.length > 0 && (
        <div className="p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[var(--amber)]" />
            <p className="text-sm font-medium text-[var(--amber)]">Warnings</p>
          </div>
          <ul className="text-sm text-[var(--amber)] space-y-1">
            {validationWarnings.map((w, i) => (
              <li key={i}>- {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary sections */}
      <div className="space-y-4">
        <SummarySection title="Connection">
          <SummaryItem label="Method" value={isMqtt ? 'MQTT' : 'Home Assistant'} />
          {isMqtt && (
            <>
              <SummaryItem
                label="Broker"
                value={`${mqtt.broker || 'Not set'}:${mqtt.port || 1883}${mqtt.tls ? ' (TLS)' : ''}`}
              />
              <SummaryItem
                label="Topic Prefix"
                value={String(mqtt.topic_prefix || 'None')}
              />
              <SummaryItem
                label="Output: Flow"
                value={String((mqtt.outputs as Record<string, string> | undefined)?.flow_temp || 'Not set')}
              />
              <SummaryItem
                label="Output: Mode"
                value={String((mqtt.outputs as Record<string, string> | undefined)?.mode || 'Not set')}
              />
            </>
          )}
        </SummarySection>

        <SummarySection title="Heat Source">
          <SummaryItem label="Type" value={hs?.type || 'Not set'} />
          <SummaryItem label="Efficiency" value={String(hs?.efficiency ?? 'Default')} />
          <SummaryItem
            label="Control"
            value={hs?.flow_control?.method || 'Not configured'}
          />
        </SummarySection>

        <SummarySection title={`Rooms (${Object.keys(rooms).length})`}>
          {Object.entries(rooms as Record<string, RoomConfigYaml>).map(([name, room]) => (
            <SummaryItem
              key={name}
              label={name.replace(/_/g, ' ')}
              value={`${room.area_m2}m\u00b2 | ${room.facing || 'interior'}${room.trv_entity ? ' | TRV' : ''}`}
            />
          ))}
          {Object.keys(rooms).length === 0 && (
            <p className="text-sm text-[var(--red)]">No rooms defined!</p>
          )}
        </SummarySection>

        <SummarySection title="Sensors">
          {isMqtt ? (
            <>
              {Object.entries((mqtt.inputs || {}) as Record<string, { topic?: string }>).map(([key, val]) => (
                <SummaryItem key={key} label={key} value={val?.topic || 'Not set'} />
              ))}
              {Object.keys((mqtt.inputs || {}) as Record<string, unknown>).length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No sensor topics configured</p>
              )}
            </>
          ) : (
            <>
              <SummaryItem
                label="Flow Temp"
                value={hs?.sensors?.flow_temp || 'Not set'}
              />
              <SummaryItem
                label="Power"
                value={hs?.sensors?.power_input || 'Not set'}
              />
              <SummaryItem
                label="Outdoor"
                value={outdoor?.temperature || 'Not set'}
              />
              <SummaryItem
                label="Weather"
                value={outdoor?.weather_forecast || 'Not set'}
              />
            </>
          )}
        </SummarySection>

        <SummarySection title="Energy">
          <SummaryItem
            label="Tariff"
            value={
              energy?.octopus?.api_key
                ? 'Octopus Smart'
                : energy?.fixed_rates
                  ? 'Fixed Rate'
                  : 'Fallback rates'
            }
          />
        </SummarySection>

        <SummarySection title="Thermal">
          <SummaryItem
            label="Peak Loss"
            value={`${thermal?.peak_loss_kw ?? 5.0} kW`}
          />
          <SummaryItem
            label="Design Temp"
            value={`${thermal?.peak_external_temp ?? -3.0}\u00b0C`}
          />
          <SummaryItem
            label="Thermal Mass"
            value={`${thermal?.thermal_mass_per_m2 ?? 0.03} kWh/m\u00b2/K`}
          />
        </SummarySection>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-[var(--border)]">
        <button
          onClick={downloadYaml}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text)] hover:bg-[var(--bg)]"
        >
          <Download size={16} />
          Download Config
        </button>
        <button
          onClick={handleDeploy}
          disabled={isDeploying}
          className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {isDeploying ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Deploying...
            </>
          ) : (
            'Deploy Configuration'
          )}
        </button>
      </div>
    </div>
  )
}

function SummarySection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <h3 className="text-sm font-medium text-[var(--text)] mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text)] font-mono text-xs">{value}</span>
    </div>
  )
}
