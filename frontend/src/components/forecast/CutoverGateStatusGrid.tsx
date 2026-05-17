import { Check, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { HelpTip } from '../HelpTip'
import type { CutoverGatesResponse } from '../../types/api'

interface CutoverGateStatusGridProps {
  data: CutoverGatesResponse | null
  loading: boolean
  error: string | null
}

function GateDot({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-7 h-5 rounded text-xs',
        pass ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500',
      )}
      title={label}
    >
      {pass ? <Check size={12} /> : <X size={12} />}
    </span>
  )
}

export function CutoverGateStatusGrid({
  data, loading, error,
}: CutoverGateStatusGridProps) {
  if (loading) return <div className="p-4 text-[var(--text-muted)]">Loading cutover gates...</div>
  if (error) return <div className="p-4 text-red-500" role="alert">{error}</div>
  if (!data) return null

  return (
    <div className="p-4 bg-[var(--bg-card)] rounded-lg">
      <h3 className="font-semibold mb-3">Cutover Gate Status</h3>
      <p className="text-sm text-[var(--text-muted)] mb-2">
        Each forecast-using controller has to prove its decisions are safe before
        it is allowed to act on the forecast. Four gates (forecast accuracy,
        comfort outcome, composite confidence, twin agreement) must all pass for
        a sustained number of cycles. While a controller is still holding short
        of those gates the forecast feeds in as observation only — the
        deterministic answer is what runs the system. Once a controller's row
        shows ELIGIBLE, forecast influence is permitted on that controller's
        decisions, including the occupancy and away-mode setbacks that route
        through it.
      </p>
      <div className="text-xs text-[var(--text-muted)] mb-2">
        Window: {data.window_cycles} cycles. Required hold: {data.cycles_required} cycles.
      </div>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[480px]">
          {Object.entries(data.gates).map(([controller, scopes]) => (
            <div key={controller} className="mb-4">
              <h4 className="font-medium mb-2">{controller}</h4>
              <div className="flex items-center gap-2 py-1 text-xs text-[var(--text-muted)] border-t border-[var(--border)]">
                <span className="w-32"></span>
                <span className="w-7 inline-flex items-center gap-0.5">
                  err <HelpTip size={11} text="Forecast accuracy: the controller's forecast prediction error stayed below the configured P95 threshold for the measurement window." />
                </span>
                <span className="w-7 inline-flex items-center gap-0.5">
                  cmf <HelpTip size={11} text="Comfort outcome: room temperatures stayed within bounds while the controller was being driven by forecast-influenced shadow decisions." />
                </span>
                <span className="w-7 inline-flex items-center gap-0.5">
                  cnf <HelpTip size={11} text="Composite confidence: the forecast composite confidence score — derived from weather classification, twin agreement, and prediction history — held above threshold for the window." />
                </span>
                <span className="w-7 inline-flex items-center gap-0.5">
                  twn <HelpTip size={11} text="Twin agreement: the digital twin's projection of how the controller would behave under forecast input matched what actually happened." />
                </span>
              </div>
              {Object.entries(scopes).map(([scope, gate]) => (
                <div key={scope} className="border-t border-[var(--border)]">
                  <div className="flex items-center gap-2 py-1 text-sm">
                    <span className="w-32 text-[var(--text-muted)]">{scope}</span>
                    <GateDot pass={gate.prediction_error_gate_pass} label="err" />
                    <GateDot pass={gate.comfort_gate_pass} label="cmf" />
                    <GateDot pass={gate.composite_confidence_gate_pass} label="cnf" />
                    <GateDot pass={gate.twin_gate_pass} label="twn" />
                    <span className="ml-2 text-[var(--text-muted)]">
                      {gate.cycles_holding} / {gate.cycles_required}
                    </span>
                    {gate.cutover_eligible && (
                      <span className="ml-2 px-2 py-0.5 bg-green-500 text-white text-xs rounded">
                        ELIGIBLE
                      </span>
                    )}
                    <span
                      className="ml-auto text-xs text-[var(--text-muted)] truncate max-w-md hidden sm:inline"
                      title={gate.rationale}
                    >
                      {gate.rationale}
                    </span>
                  </div>
                  <div className="sm:hidden pl-32 pr-2 pb-1 text-xs text-[var(--text-muted)]">
                    {gate.rationale}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
