import { useEffect, useRef } from 'react'
import { Download, AlertTriangle, Check } from 'lucide-react'
import { useSysid } from '../../hooks/useSysid'
import { cadenceCopy, cadenceLabel } from '../../lib/sensorCadence'
import type {
  DeployOutcome,
  QshConfigYaml,
  RoomConfigYaml,
  WizardWarning,
} from '../../types/config'
import {
  assertNever,
  isAckOutstandingError,
  isDeployNetworkError,
  isDeployResponse,
  isDestructiveDeployError,
  isDeployValidationError,
} from '../../types/config'

interface StepReviewProps {
  config: Partial<QshConfigYaml>
  validationWarnings: WizardWarning[]
  /** INSTRUCTION-324 — instance-qualified rule ids already ticked. */
  acknowledgedRuleIds: string[]
  onAcknowledge: (ruleId: string, on: boolean) => void
  isDeploying: boolean
  /** INSTRUCTION-414 (D3) — the single deploy-outcome home, owned by
   *  useWizard. StepReview is a pure renderer over it; the deploy trigger is
   *  the footer button (WizardShell), not this component. */
  deployOutcome: DeployOutcome | null
  onForceDeploy: () => Promise<DeployOutcome | null>
}

export function StepReview({
  config,
  validationWarnings,
  acknowledgedRuleIds,
  onAcknowledge,
  isDeploying,
  deployOutcome,
  onForceDeploy,
}: StepReviewProps) {
  // INSTRUCTION-324 — acknowledged-class warnings (rule_id non-null) gate
  // the deploy button; legacy informational warnings (rule_id null) render
  // in the plain amber list as before.
  const ackWarnings = validationWarnings.filter(
    (w): w is WizardWarning & { rule_id: string } => w.rule_id !== null
  )
  const infoWarnings = validationWarnings.filter((w) => w.rule_id === null)
  const acked = new Set(acknowledgedRuleIds)
  const unacknowledgedCount = ackWarnings.filter(
    (w) => !acked.has(w.rule_id)
  ).length

  // INSTRUCTION-414 (D8/M3) — the deploy trigger lives in permanently-visible
  // chrome (the footer), but the outcome banners live inside the review page's
  // scroll pane. On a refusal, bring the outcome region to the operator's
  // viewport at the click site. Success replaces the page body (early return
  // below) and never scrolls; clearing (deployOutcome → null) never scrolls.
  const outcomeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!deployOutcome) return
    if (isDeployResponse(deployOutcome) && deployOutcome.deployed) return
    outcomeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [deployOutcome])

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

  // INSTRUCTION-414 (D3/M2) — render exactly one refusal banner from the typed
  // outcome via guard-chain narrowing, terminating in `assertNever`. The wire
  // shapes share no discriminant, so a literal switch cannot type-check; a
  // future sixth variant added without a branch fails the build at the floor.
  const renderOutcomeBanner = (outcome: DeployOutcome) => {
    if (isDeployResponse(outcome)) {
      // Success is a full-page replacement (early return above); a non-deployed
      // response has no banner.
      return null
    }
    if (isAckOutstandingError(outcome)) {
      // Acknowledgement refusal banner (INSTRUCTION-324). Normally unreachable —
      // the footer button is disabled until every item is ticked — but rendered
      // defensively for the race where warnings changed server-side between
      // validate and deploy. Ticking a confirmation self-heals it (D2/L1).
      return (
        <div
          className="p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30"
          data-testid="ack-outstanding-banner"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[var(--amber)]" />
            <p className="text-sm font-medium text-[var(--amber)]">
              Deploy blocked — unacknowledged warnings
            </p>
          </div>
          <p className="text-sm text-[var(--amber)]">
            The server requires explicit acknowledgement of:{' '}
            {outcome.outstanding.join(', ')}. Go back through the wizard if the
            configuration changed, or tick the confirmations above.
          </p>
        </div>
      )
    }
    if (isDeployValidationError(outcome)) {
      // INSTRUCTION-412 (R5) — deploy validation-error banner. Renders the
      // backend 422 detail verbatim (heat_sources boundary guard /
      // validate_config) so a rejected deploy is VISIBLE. Before 412 this
      // detail was swallowed; before 414 it rendered only on the inline button.
      return (
        <div
          className="p-4 rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/40"
          data-testid="deploy-error-banner"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[var(--red)]" />
            <p className="text-sm font-medium text-[var(--red)]">
              Deploy rejected
            </p>
          </div>
          <p className="text-sm text-[var(--text)]">{outcome.detail}</p>
        </div>
      )
    }
    if (isDestructiveDeployError(outcome)) {
      // Destructive-deploy refusal banner (INSTRUCTION-137 Task 3). Force Deploy
      // lives INSIDE this banner (INSTRUCTION-414 D4) — an escalation adjacent
      // to the explanation of what forcing overwrites, not a sibling start
      // button. The banner and its disabled Force button persist through the
      // force flight (D2/L2).
      return (
        <div
          className="p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30"
          data-testid="destructive-banner"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[var(--amber)]" />
            <p className="text-sm font-medium text-[var(--amber)]">
              Destructive deploy refused
            </p>
          </div>
          <p className="text-sm text-[var(--amber)] mb-3">
            This deploy would remove sections from your existing configuration.
            Removed sections: {outcome.removed_sections.join(', ')}. Click Back
            to load your existing config via Welcome → Edit Existing, or Force
            Deploy to overwrite.
          </p>
          <button
            onClick={() => {
              void onForceDeploy()
            }}
            disabled={isDeploying || unacknowledgedCount > 0}
            title={
              unacknowledgedCount > 0
                ? `${unacknowledgedCount} warning${unacknowledgedCount === 1 ? '' : 's'} awaiting confirmation`
                : undefined
            }
            className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[var(--amber)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            Force Deploy
          </button>
        </div>
      )
    }
    if (isDeployNetworkError(outcome)) {
      // INSTRUCTION-414 (D7) — the network-failure banner. Amber, not red: the
      // config may be fine and the deploy may even have landed. Advisory copy.
      return (
        <div
          className="p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30"
          data-testid="deploy-network-banner"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[var(--amber)]" />
            <p className="text-sm font-medium text-[var(--amber)]">
              Deploy did not complete
            </p>
          </div>
          <p className="text-sm text-[var(--amber)]">{outcome.detail}</p>
        </div>
      )
    }
    return assertNever(outcome)
  }

  if (isDeployResponse(deployOutcome) && deployOutcome.deployed) {
    return (
      <div className="text-center space-y-6 py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--green)]/10">
          <Check size={32} className="text-[var(--green)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text)]">
          Configuration Deployed!
        </h2>
        <p className="text-[var(--text-muted)] max-w-md mx-auto">
          {deployOutcome.message}
        </p>
        {deployOutcome.warnings.length > 0 && (
          <div className="max-w-md mx-auto p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30 text-left">
            <p className="text-sm font-medium text-[var(--amber)] mb-2">Warnings:</p>
            <ul className="text-sm text-[var(--amber)] space-y-1">
              {deployOutcome.warnings.map((w, i) => (
                <li key={i}>- {w.message}</li>
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

      {/* Informational warnings (rule_id null — never deploy-blocking) */}
      {infoWarnings.length > 0 && (
        <div className="p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[var(--amber)]" />
            <p className="text-sm font-medium text-[var(--amber)]">Warnings</p>
          </div>
          <ul className="text-sm text-[var(--amber)] space-y-1">
            {infoWarnings.map((w, i) => (
              <li key={i}>- {w.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* INSTRUCTION-324 — acknowledged-class warnings. Each item must be
          explicitly confirmed before deploy is enabled; the acknowledgement
          set is stamped into the deployed YAML as an audit trail. The tick
          controls are inert while a deploy/force flight is in progress
          (INSTRUCTION-414 R1 tick-seal) — no submission-changing mutation is
          reachable mid-flight, which is what makes the outcome always coherent
          with the submission it was computed against. */}
      {ackWarnings.length > 0 && (
        <div
          className="p-4 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30"
          data-testid="ack-warnings"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-[var(--amber)]" />
            <p className="text-sm font-medium text-[var(--amber)]">
              Confirm before deploying
            </p>
          </div>
          <p className="text-xs text-[var(--amber)] mb-3">
            These look unusual or assumed. Tick each one to confirm it is
            correct for this building — your confirmations are recorded in
            the deployed configuration.
          </p>
          <ul className="space-y-2">
            {ackWarnings.map((w) => (
              <li key={w.rule_id}>
                <label className="flex items-start gap-2 text-sm text-[var(--amber)] cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acked.has(w.rule_id)}
                    disabled={isDeploying}
                    onChange={(e) => onAcknowledge(w.rule_id, e.target.checked)}
                  />
                  <span>
                    {w.message}
                    <span className="block text-xs opacity-80">
                      I confirm this is correct for this building
                    </span>
                  </span>
                </label>
              </li>
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
              value={`${room.area_m2}m² | ${room.facing || 'interior'}${room.trv_entity ? ' | TRV' : ''}`}
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
              {/* Always surface flow_rate so the operator knows the capability
                  fallback is in effect when empty (INSTRUCTION-90D). */}
              {!((mqtt.inputs as Record<string, { topic?: string }> | undefined)?.flow_rate?.topic) && (
                <SummaryItem
                  label="Flow rate sensor"
                  value="Not configured (capability fallback)"
                />
              )}
            </>
          ) : (
            <>
              <SummaryItem
                label="Flow Temp"
                value={(typeof hs?.sensors?.flow_temp === 'string' ? hs.sensors.flow_temp : '') || 'Not set'}
              />
              <SummaryItem
                label="Power"
                value={(typeof hs?.sensors?.power_input === 'string' ? hs.sensors.power_input : '') || 'Not set'}
              />
              <SummaryItem
                label="Flow rate sensor"
                value={(typeof hs?.sensors?.flow_rate === 'string' ? hs.sensors.flow_rate : '') || 'Not configured (capability fallback)'}
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
            value={`${thermal?.peak_external_temp ?? -3.0}°C`}
          />
          <SummaryItem
            label="Thermal Mass"
            value={`${thermal?.thermal_mass_per_m2 ?? 0.03} kWh/m²/K`}
          />
        </SummarySection>

        {/* INSTRUCTION-420 D2 — sensor reporting ADVISORY. Informational by
            construction: it renders measured classes where the running
            system already has data, degrades honestly to a measuring note
            otherwise, and shares no code with deploy gating — it can never
            block a deploy, join the acknowledged-warning set, or create a
            refusal. */}
        <SensorCadenceAdvisory />
      </div>

      {/* INSTRUCTION-414 (D8/R3) — the single deploy-outcome region. One
          `role="alert"` home (alone — the role's implicit assertive live-region
          is the intended urgency for a refusal the operator just triggered and
          is waiting on). The scroll-into-view effect above brings it to the
          click site. Renders exactly one refusal banner via the guard chain. */}
      {deployOutcome && (
        <div ref={outcomeRef} role="alert" data-testid="deploy-outcome-region">
          {renderOutcomeBanner(deployOutcome)}
        </div>
      )}

      {/* Actions — Download Config only. The sole deploy trigger is the footer
          primary action (WizardShell), per INSTRUCTION-414 D1. */}
      <div className="flex items-center gap-3 pt-4 border-t border-[var(--border)]">
        <button
          onClick={downloadYaml}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text)] hover:bg-[var(--bg)]"
        >
          <Download size={16} />
          Download Config
        </button>
      </div>
    </div>
  )
}

// INSTRUCTION-420 T5 — per-room sensor reporting classes at the review
// step, where data exists; else the honest measuring state (a wizard scan
// window is usually too short for meaningful step statistics in a warm
// house — the classification accrues on the Engineering page instead).
function SensorCadenceAdvisory() {
  const { data } = useSysid()
  const rooms = data?.rooms ?? {}
  const classified = Object.entries(rooms).filter(
    ([, r]) =>
      r.sensor_cadence != null && r.sensor_cadence.class !== 'insufficient'
  )

  return (
    <div
      data-testid="sensor-cadence-advisory"
      className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]"
    >
      <h3 className="text-sm font-medium text-[var(--text)] mb-3">
        Sensor reporting (advisory)
      </h3>
      {classified.length > 0 ? (
        <div className="space-y-2">
          {classified.map(([name, r]) => (
            <div key={name} className="text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)] capitalize">
                  {name.replace(/_/g, ' ')}
                </span>
                <span className="text-[var(--text)] font-mono text-xs">
                  {cadenceLabel(r.sensor_cadence!.class)}
                </span>
              </div>
              {r.sensor_cadence!.class !== 'ok' && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {cadenceCopy(r.sensor_cadence!)}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Measuring — sensor reporting statistics accrue while QSH runs.
          Check the Engineering page after the first night.
        </p>
      )}
      <p className="text-xs text-[var(--text-muted)] mt-3">
        Informational only — a coarse sensor yields a slower-learning system,
        not an unsafe one. This never blocks deployment.
      </p>
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
