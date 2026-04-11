import { useWizard } from '../hooks/useWizard'
import { WizardShell } from '../components/wizard/WizardShell'
import { StepWelcome } from '../components/wizard/StepWelcome'
import { StepConnectionMethod } from '../components/wizard/StepConnectionMethod'
import { StepHeatSource } from '../components/wizard/StepHeatSource'
import { StepMqttBroker } from '../components/wizard/StepMqttBroker'
import { StepSensors } from '../components/wizard/StepSensors'
import { StepRooms } from '../components/wizard/StepRooms'
import { StepTariff } from '../components/wizard/StepTariff'
import { StepSchedules } from '../components/wizard/StepSchedules'
import { StepThermal } from '../components/wizard/StepThermal'
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

  const handleNext = async () => {
    if (wizard.stepName === 'review') {
      const result = await wizard.deploy()
      if (result?.deployed) {
        // Redirect to home after a brief delay to show success
        setTimeout(() => onComplete(), 3000)
      }
      return
    }
    await wizard.next()
  }

  const renderStep = () => {
    switch (wizard.stepName) {
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
            isDeploying={wizard.isDeploying}
            onDeploy={wizard.deploy}
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
      validationErrors={wizard.validationErrors}
      onExit={onExit}
    >
      {renderStep()}
    </WizardShell>
  )
}
