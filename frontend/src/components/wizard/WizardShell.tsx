import { type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface WizardShellProps {
  currentStep: number
  totalSteps: number
  stepLabels: string[]
  children: ReactNode
  onBack: () => void
  onNext: () => void
  isFirstStep: boolean
  isLastStep: boolean
  isDeploying?: boolean
  validationErrors: string[]
  onExit?: () => void
}

export function WizardShell({
  currentStep,
  totalSteps,
  stepLabels,
  children,
  onBack,
  onNext,
  isFirstStep,
  isLastStep,
  isDeploying,
  validationErrors,
  onExit,
}: WizardShellProps) {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      {/* Header */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-[var(--accent)]">QSH Setup Wizard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--text-muted)]">
              Step {currentStep + 1} of {totalSteps}
            </span>
            {onExit && (
              <button
                onClick={onExit}
                className="p-1 rounded hover:bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                title="Exit wizard"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Progress bar */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-3">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-1">
            {stepLabels.map((label, i) => (
              <div
                key={label + i}
                className={cn(
                  'flex-1 h-2 rounded-full transition-colors',
                  i < currentStep
                    ? 'bg-[var(--accent)]'
                    : i === currentStep
                      ? 'bg-[var(--accent)]/60'
                      : 'bg-[var(--border)]'
                )}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2">
            {stepLabels.map((label, i) => (
              <span
                key={label + i}
                className={cn(
                  'text-xs hidden sm:block',
                  i <= currentStep ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                )}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {validationErrors.length > 0 && (
            <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-sm font-medium text-[var(--red)] mb-2">
                Please fix the following errors:
              </p>
              <ul className="text-sm text-[var(--red)] space-y-1">
                {validationErrors.map((err, i) => (
                  <li key={i}>- {err}</li>
                ))}
              </ul>
            </div>
          )}
          {children}
        </div>
      </main>

      {/* Footer navigation */}
      <footer className="bg-[var(--bg-card)] border-t border-[var(--border)] px-6 py-4">
        <div className="max-w-4xl mx-auto flex justify-between">
          <button
            onClick={onBack}
            disabled={isFirstStep}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              isFirstStep
                ? 'text-[var(--text-muted)] cursor-not-allowed'
                : 'text-[var(--text)] hover:bg-[var(--bg)] border border-[var(--border)]'
            )}
          >
            <ChevronLeft size={16} />
            Back
          </button>
          <button
            onClick={onNext}
            disabled={isDeploying}
            className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {isDeploying ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Deploying...
              </>
            ) : isLastStep ? (
              'Deploy'
            ) : (
              <>
                Next
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  )
}
