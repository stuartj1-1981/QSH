import { useState, useCallback, useMemo } from 'react'
import { apiUrl } from '../lib/api'
import type {
  ValidationResponse,
  DeployResponse,
  DestructiveDeployError,
  AckOutstandingError,
  DeployValidationError,
  WizardWarning,
  QshConfigYaml,
  HeatSourceYaml,
  MqttTopicInput,
} from '../types/config'

// INSTRUCTION-241B Task 4b — legacy mqtt.inputs.hp_* → heat_sources[0].sensors.*
// migration helper. Runs once on wizard config bootstrap; idempotent.
// Mirrors backend topic_map.py de-dup table at qsh/drivers/mqtt/topic_map.py.
const LEGACY_TO_PER_SOURCE_SLOT_REMAP: Record<string, string> = {
  hp_flow_temp:   'flow_temp',
  hp_return_temp: 'return_temp',
  flow_rate:      'flow_rate',
  hp_power:       'power_input',
  hp_cop:         'cop',
  hp_heat_output: 'heat_output',
  // hp_mode_state intentionally NOT remapped — parent §D-8 V2 retains as global.
}

export function migrateLegacyMqttInputsToPerSource(
  config: Partial<QshConfigYaml>,
): Partial<QshConfigYaml> {
  if (config.driver !== 'mqtt') return config
  const sources: HeatSourceYaml[] = Array.isArray(config.heat_sources)
    ? [...config.heat_sources]
    : (config.heat_source ? [config.heat_source] : [])
  if (sources.length === 0) return config

  const primary: HeatSourceYaml = {
    ...sources[0],
    sensors: { ...(sources[0].sensors ?? {}) },
  }
  const legacyInputs = (config.mqtt?.inputs ?? {}) as Record<string, MqttTopicInput>

  let migrated = false
  for (const [legacyKey, perSourceKey] of Object.entries(LEGACY_TO_PER_SOURCE_SLOT_REMAP)) {
    const legacyEntry = legacyInputs[legacyKey]
    const existing = (primary.sensors as Record<string, unknown> | undefined)?.[perSourceKey]
    if (legacyEntry && !existing) {
      (primary.sensors as Record<string, MqttTopicInput | string>)[perSourceKey] = legacyEntry
      migrated = true
    }
  }
  if (!migrated) return config

  sources[0] = primary
  // Legacy mqtt.inputs.hp_* keys are LEFT IN PLACE in the in-memory config —
  // backend 241A V2 Task 4 L1 de-dup skips them when the per-source equivalent
  // exists. Wizard never re-writes them after migration (F5(b) no-double-write).
  return {
    ...config,
    heat_sources: sources,
  }
}

const HA_STEPS = [
  'restore_backup',
  'welcome',
  'telemetry_agreement',
  'connection_method',
  'heat_source',
  'sensors',
  'rooms',
  'aux_outputs',
  'tariff',
  'schedules',
  'thermal',
  'building',
  'hot_water',
  'disclaimer',
  'review',
] as const

const MQTT_STEPS = [
  'restore_backup',
  'welcome',
  'telemetry_agreement',
  'connection_method',
  'heat_source',
  'mqtt_broker',
  'sensors',
  'rooms',
  'aux_outputs',
  'tariff',
  'schedules',
  'thermal',
  'building',
  'hot_water',
  'disclaimer',
  'review',
] as const

export type WizardStepName = (typeof HA_STEPS)[number] | 'mqtt_broker' | 'restore_backup'

/** Legacy export for WizardShell step label lookup. */
export const WIZARD_STEPS = HA_STEPS

export interface WizardState {
  currentStep: number
  totalSteps: number
  config: Partial<QshConfigYaml>
  validationErrors: string[]
  validationWarnings: WizardWarning[]
  /** INSTRUCTION-324 — instance-qualified rule ids the user has ticked on
   *  the review step. Sent with deploy; deploy 409s while any fired
   *  acknowledged-class warning is missing from this list. */
  acknowledgedRuleIds: string[]
  isDeploying: boolean
}

export function useWizard() {
  const [state, setState] = useState<WizardState>({
    currentStep: 0,
    totalSteps: HA_STEPS.length,
    config: {},
    validationErrors: [],
    validationWarnings: [],
    acknowledgedRuleIds: [],
    isDeploying: false,
  })

  const isMqtt = state.config.driver === 'mqtt'
  const steps = isMqtt ? MQTT_STEPS : HA_STEPS

  const stepName = steps[state.currentStep] as WizardStepName

  const effectiveTotalSteps = steps.length

  const updateConfig = useCallback((section: string, data: unknown) => {
    setState((prev) => {
      if (data === undefined) {
        const next = { ...prev.config }
        delete (next as Record<string, unknown>)[section]
        return { ...prev, config: next }
      }
      return {
        ...prev,
        config: { ...prev.config, [section]: data } as Partial<QshConfigYaml>,
      }
    })
  }, [])

  const setConfig = useCallback((config: Partial<QshConfigYaml>) => {
    // INSTRUCTION-241B Task 4b — migrate legacy mqtt.inputs.hp_* to
    // heat_sources[0].sensors.* on config load. Idempotent.
    const migrated = migrateLegacyMqttInputsToPerSource(config)
    setState((prev) => ({ ...prev, config: migrated }))
  }, [])

  const validateStep = useCallback(
    async (step: string | null, config: unknown): Promise<ValidationResponse> => {
      try {
        const resp = await fetch(apiUrl('api/wizard/validate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, step }),
        })
        return resp.json()
      } catch {
        return { valid: false, errors: ['Network error'], warnings: [] }
      }
    },
    []
  )

  /** INSTRUCTION-324 — tick/untick an acknowledged-class warning on the
   *  review step. */
  const toggleAcknowledgement = useCallback((ruleId: string, on: boolean) => {
    setState((prev) => {
      const current = new Set(prev.acknowledgedRuleIds)
      if (on) current.add(ruleId)
      else current.delete(ruleId)
      return { ...prev, acknowledgedRuleIds: [...current] }
    })
  }, [])

  const next = useCallback(async () => {
    const currentStepName = steps[state.currentStep] as WizardStepName

    // Steps that skip server validation
    const skipValidation: WizardStepName[] = ['restore_backup', 'welcome', 'connection_method', 'schedules', 'building', 'hot_water']
    if (skipValidation.includes(currentStepName)) {
      setState((prev) => ({
        ...prev,
        currentStep: prev.currentStep + 1,
        validationErrors: [],
        validationWarnings: [],
      }))
      return true
    }

    const result = await validateStep(currentStepName, state.config)
    if (!result.valid) {
      setState((prev) => ({ ...prev, validationErrors: result.errors }))
      return false
    }

    // INSTRUCTION-324: entering the review step runs a FULL validation
    // (step=null) so the acknowledgement checklist shows every fired
    // warning, not just the last step's. Stale acknowledgements (e.g. a
    // room renamed after ticking) are pruned to the currently-fired ids.
    let warnings = result.warnings || []
    const nextStepName = steps[state.currentStep + 1] as WizardStepName | undefined
    if (nextStepName === 'review') {
      const full = await validateStep(null, state.config)
      warnings = full.warnings || []
    }
    const firedIds = new Set(
      warnings.map((w) => w.rule_id).filter((r): r is string => r !== null)
    )

    setState((prev) => ({
      ...prev,
      currentStep: prev.currentStep + 1,
      validationErrors: [],
      validationWarnings: warnings,
      acknowledgedRuleIds: prev.acknowledgedRuleIds.filter((r) => firedIds.has(r)),
    }))
    return true
  }, [state.currentStep, state.config, steps, validateStep])

  const back = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(0, prev.currentStep - 1),
      validationErrors: [],
    }))
  }, [])

  const goToStep = useCallback((step: number) => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(0, Math.min(step, steps.length - 1)),
      validationErrors: [],
    }))
  }, [steps.length])

  const _post = useCallback(
    async (
      force: boolean
    ): Promise<
      | DeployResponse
      | DestructiveDeployError
      | AckOutstandingError
      | DeployValidationError
      | null
    > => {
      setState((prev) => ({ ...prev, isDeploying: true }))
      try {
        const resp = await fetch(apiUrl('api/wizard/deploy'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: state.config,
            force,
            acknowledged_rule_ids: state.acknowledgedRuleIds,
          }),
        })
        if (resp.status === 409) {
          const body = await resp.json()
          const detail = (body?.detail ?? {}) as Record<string, unknown>
          // INSTRUCTION-324: two 409 shapes — the acknowledgement refusal
          // carries `outstanding`, the section-preservation refusal carries
          // `removed_sections`.
          if (Array.isArray(detail.outstanding)) {
            return {
              kind: 'ack_outstanding',
              outstanding: detail.outstanding as string[],
            }
          }
          return {
            kind: 'destructive',
            removed_sections: (detail.removed_sections as string[]) ?? [],
            existing_sections: (detail.existing_sections as string[]) ?? [],
            incoming_sections: (detail.incoming_sections as string[]) ?? [],
          }
        }
        // INSTRUCTION-412 (R5) — capture any other non-OK status (notably the 422
        // the heat_sources boundary guard and validate_config raise) into a typed
        // error carrying the backend detail prose. Before 412 this body was cast to
        // DeployResponse uninspected and StepReview rendered only the success
        // branch, so a failed deploy's detail was silently swallowed.
        if (!resp.ok) {
          let detail = `Deploy failed (HTTP ${resp.status}).`
          try {
            const body = await resp.json()
            const d = body?.detail
            if (typeof d === 'string') {
              detail = d
            } else if (d && typeof d === 'object') {
              // validate_config's 422 shape: { message, errors: string[] }.
              const msg = typeof d.message === 'string' ? d.message : ''
              const errs = Array.isArray(d.errors) ? d.errors.join('; ') : ''
              detail = [msg, errs].filter(Boolean).join(': ') || detail
            }
          } catch {
            // body not JSON — keep the HTTP status fallback.
          }
          return { kind: 'validation', status: resp.status, detail }
        }
        return (await resp.json()) as DeployResponse
      } catch {
        return null
      } finally {
        setState((prev) => ({ ...prev, isDeploying: false }))
      }
    },
    [state.config, state.acknowledgedRuleIds]
  )

  const deploy = useCallback(
    () => _post(false),
    [_post]
  )

  const forceDeploy = useCallback(
    () => _post(true),
    [_post]
  )

  const stepLabels = useMemo(() => {
    const labels: Record<string, string> = {
      restore_backup: 'Restore',
      welcome: 'Welcome',
      telemetry_agreement: 'Data Sharing',
      connection_method: 'Connection',
      heat_source: 'Heat Source',
      mqtt_broker: 'MQTT Broker',
      sensors: 'Sensors',
      rooms: 'Rooms',
      aux_outputs: 'Auxiliary outputs',
      tariff: 'Tariff',
      schedules: 'Schedules',
      thermal: 'Thermal',
      building: 'Building',
      hot_water: 'Hot Water',
      disclaimer: 'Disclaimer',
      review: 'Review',
    }
    return steps.map((s) => labels[s] || s)
  }, [steps])

  return {
    ...state,
    totalSteps: effectiveTotalSteps,
    stepName,
    steps,
    stepLabels,
    updateConfig,
    setConfig,
    next,
    back,
    goToStep,
    deploy,
    forceDeploy,
    toggleAcknowledgement,
  }
}
