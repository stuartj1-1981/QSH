import { useEffect, useRef } from 'react'
import { useWizard } from '../hooks/useWizard'
import { isDeployResponse } from '../types/config'
import { WizardShell } from '../components/wizard/WizardShell'
import { StepRestoreBackup } from '../components/wizard/StepRestoreBackup'
import { StepWelcome } from '../components/wizard/StepWelcome'
import { StepConnectionMethod } from '../components/wizard/StepConnectionMethod'
import { StepHeatSource } from '../components/wizard/StepHeatSource'
import { StepMqttBroker } from '../components/wizard/StepMqttBroker'
import { StepSensors } from '../components/wizard/StepSensors'
import { StepRooms } from '../components/wizard/StepRooms'
import { StepAuxOutputs } from '../components/wizard/StepAuxOutputs'
import { StepTariff } from '../components/wizard/StepTariff'
import { StepSchedules } from '../components/wizard/StepSchedules'
import { StepThermal } from '../components/wizard/StepThermal'
import { StepBuilding } from '../components/wizard/StepBuilding'
import { StepHotWater } from '../components/wizard/StepHotWater'
import { StepReview } from '../components/wizard/StepReview'
import { StepTelemetryAgreement } from '../components/wizard/StepTelemetryAgreement'
import { StepDisclaimer } from '../components/wizard/StepDisclaimer'

interface WizardProps {
  onComplete: () => void
  onExit?: () => void
}

export function Wizard({ onComplete, onExit }: WizardProps) {
  const wizard = useWizard()

  // INSTRUCTION-324 — fired acknowledged-class warnings (rule_id non-null)
  // not yet ticked. Gates the footer Deploy button (INSTRUCTION-414 D1 — now
  // the sole deploy affordance) so the server-side 409 is never the first line
  // of defence the user meets.
  const ackedIds = new Set(wizard.acknowledgedRuleIds)
  const unacknowledgedCount = wizard.validationWarnings.filter(
    (w) => w.rule_id !== null && !ackedIds.has(w.rule_id)
  ).length
  const hasUnacknowledged = unacknowledgedCount > 0

  // INSTRUCTION-414 (D6) — a successful deploy seals the egress channels and
  // schedules the redirect. Watch the single outcome home for the success
  // shape rather than inspecting the deploy() return in handleNext.
  const deploySucceeded =
    isDeployResponse(wizard.deployOutcome) && wizard.deployOutcome.deployed

  // INSTRUCTION-414 (D6) — the redirect fires 3 s after a success. A ref keeps
  // the callback current without re-arming the timer on every parent re-render
  // (App re-renders on WebSocket ticks; a bare dep would reset the countdown).
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])
  useEffect(() => {
    if (!deploySucceeded) return
    const t = setTimeout(() => onCompleteRef.current(), 3000)
    return () => clearTimeout(t)
  }, [deploySucceeded])

  const handleNext = async () => {
    if (wizard.stepName === 'review') {
      // INSTRUCTION-414 (D1/D3) — the footer button is the sole deploy trigger.
      // The outcome is single-homed in useWizard and rendered by StepReview;
      // handleNext does not inspect the result (the success effect above owns
      // the redirect).
      await wizard.deploy()
      return
    }
    await wizard.next()
  }

  const renderStep = () => {
    switch (wizard.stepName) {
      case 'restore_backup':
        return (
          <StepRestoreBackup
            onSkip={() => wizard.next()}
          />
        )
      case 'welcome':
        return (
          <StepWelcome
            config={wizard.config}
            onSetConfig={wizard.setConfig}
          />
        )
      case 'telemetry_agreement':
        return (
          <StepTelemetryAgreement
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'connection_method':
        return (
          <StepConnectionMethod
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'heat_source':
        return (
          <StepHeatSource
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'mqtt_broker':
        return (
          <StepMqttBroker
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'sensors':
        return (
          <StepSensors
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'rooms':
        return (
          <StepRooms
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'aux_outputs':
        return (
          <StepAuxOutputs
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'tariff':
        return (
          <StepTariff
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'schedules':
        return (
          <StepSchedules
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'thermal':
        return (
          <StepThermal
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'building':
        return (
          <StepBuilding
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'hot_water':
        return (
          <StepHotWater
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'disclaimer':
        return (
          <StepDisclaimer
            config={wizard.config}
            onUpdate={wizard.updateConfig}
          />
        )
      case 'review':
        return (
          <StepReview
            config={wizard.config}
            validationWarnings={wizard.validationWarnings}
            acknowledgedRuleIds={wizard.acknowledgedRuleIds}
            onAcknowledge={wizard.toggleAcknowledgement}
            isDeploying={wizard.isDeploying}
            deployOutcome={wizard.deployOutcome}
            onForceDeploy={wizard.forceDeploy}
          />
        )
    }
  }

  return (
    <WizardShell
      currentStep={wizard.currentStep}
      totalSteps={wizard.totalSteps}
      stepLabels={wizard.stepLabels}
      onBack={wizard.back}
      onNext={handleNext}
      isFirstStep={wizard.currentStep === 0}
      isLastStep={wizard.stepName === 'review'}
      isDeploying={wizard.isDeploying}
      // INSTRUCTION-414 (D6) — the footer primary stays inert after a success
      // (as well as while acknowledgements are outstanding on the review step);
      // Back is inert during a flight and after success; Exit is withheld the
      // same way. All three egress channels are sealed, so an outcome can only
      // ever exist while the review step is mounted.
      nextDisabled={
        (wizard.stepName === 'review' && hasUnacknowledged) || deploySucceeded
      }
      nextDisabledReason={
        wizard.stepName === 'review' && hasUnacknowledged
          ? `${unacknowledgedCount} warning${unacknowledgedCount === 1 ? '' : 's'} awaiting confirmation`
          : undefined
      }
      backDisabled={wizard.isDeploying || deploySucceeded}
      validationErrors={wizard.validationErrors}
      onExit={wizard.isDeploying || deploySucceeded ? undefined : onExit}
    >
      {renderStep()}
    </WizardShell>
  )
}
