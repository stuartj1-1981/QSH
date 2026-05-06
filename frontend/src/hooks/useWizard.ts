import { useState, useCallback, useMemo } from 'react'
import { apiUrl } from '../lib/api'
import type {
  ValidationResponse,
  DeployResponse,
  DestructiveDeployError,
  QshConfigYaml,
} from '../types/config'

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
  validationWarnings: string[]
  isDeploying: boolean
}

export function useWizard() {
  const [state, setState] = useState<WizardState>({
    currentStep: 0,
    totalSteps: HA_STEPS.length,
    config: {},
    validationErrors: [],
    validationWarnings: [],
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
    setState((prev) => ({ ...prev, config }))
  }, [])

  const validateStep = useCallback(
    async (step: string, config: unknown): Promise<ValidationResponse> => {
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

  const next = useCallback(async () => {
    const currentStepName = steps[state.currentStep] as WizardStepName

    // Steps that skip server validation
    const skipValidation: WizardStepName[] = ['restore_backup', 'welcome', 'connection_method', 'schedules', 'hot_water']
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

    setState((prev) => ({
      ...prev,
      currentStep: prev.currentStep + 1,
      validationErrors: [],
      validationWarnings: result.warnings || [],
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
    async (force: boolean): Promise<DeployResponse | DestructiveDeployError | null> => {
      setState((prev) => ({ ...prev, isDeploying: true }))
      try {
        const resp = await fetch(apiUrl('api/wizard/deploy'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: state.config, force }),
        })
        if (resp.status === 409) {
          const body = await resp.json()
          const detail = (body?.detail ?? {}) as Record<string, unknown>
          return {
            kind: 'destructive',
            removed_sections: (detail.removed_sections as string[]) ?? [],
            existing_sections: (detail.existing_sections as string[]) ?? [],
            incoming_sections: (detail.incoming_sections as string[]) ?? [],
          }
        }
        return (await resp.json()) as DeployResponse
      } catch {
        return null
      } finally {
        setState((prev) => ({ ...prev, isDeploying: false }))
      }
    },
    [state.config]
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
  }
}
