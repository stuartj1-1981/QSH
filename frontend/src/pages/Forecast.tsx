// INSTRUCTION-208D V4 — page-level lift-state.
// Page instantiates ALL endpoint-driven hooks ONCE and passes data + actions
// as props to 208C's props-driven components. Single source of state truth.
import { useState } from 'react'
import { useLive } from '../hooks/useLive'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { useCutoverGates } from '../hooks/useCutoverGates'
import { useFallbackCounts } from '../hooks/useFallbackCounts'
import { useAlarms } from '../hooks/useAlarms'
import { useReconciliation } from '../hooks/useReconciliation'
import { useHistorianQuery } from '../hooks/useHistorian'
import { MasterEnableToggle } from '../components/forecast/MasterEnableToggle'
import { ForecastStatePanel } from '../components/forecast/ForecastStatePanel'
import { PassiveRecoveryPanel } from '../components/forecast/PassiveRecoveryPanel'
import { PredictionRecordsTable } from '../components/forecast/PredictionRecordsTable'
import { BlendEvolutionChart } from '../components/forecast/BlendEvolutionChart'
import { ReconciliationDashboard } from '../components/forecast/ReconciliationDashboard'
import { CutoverGateStatusGrid } from '../components/forecast/CutoverGateStatusGrid'
import { AlarmsPanel } from '../components/forecast/AlarmsPanel'
import { HelpTip } from '../components/HelpTip'

export function Forecast() {
  const { data: cycle } = useLive()

  const { data: ffData, refetch: refetchFlags } = useFeatureFlags()

  const { data: gatesData, loading: gatesLoading, error: gatesError } = useCutoverGates()

  // Future-component slot; kept instantiated to preserve lift-state uniformity.
  useFallbackCounts()

  const { liveAlarms, historicalAlarms, loading: alarmsLoading, error: alarmsError } =
    useAlarms('-7d')

  const [selectedController, setSelectedController] = useState<string>('rl')
  const { points: reconPoints, loading: reconLoading, error: reconError } = useReconciliation(
    selectedController, undefined, '-7d',
  )

  const blendQuery = useHistorianQuery(
    'qsh_blend_factor_evolution',
    ['blend_factor', 'step_c'],
    { timeFrom: '-30d', timeTo: 'now()', interval: '1h', aggregation: 'last' },
  )

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Forecast Extension</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Settings, status, and learning progress for forecast-aware heating decisions.
          </p>
        </div>
        <MasterEnableToggle value={ffData?.master_enable ?? false} onChange={refetchFlags} />
      </div>

      {/* View 1 — Forecast State + In-Flight Prediction Records */}
      <section data-testid="view-1-forecast-state">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          1. Forecast State
          <HelpTip size={12} text="The current weather forecast the system is using, plus any decisions made on the strength of it that are still waiting for the real outcome to arrive." />
        </h2>
        <div className="space-y-4">
          <ForecastStatePanel state={cycle?.forecast_state_snapshot} />
          <PredictionRecordsTable records={cycle?.forecast_predicted_decisions} />
        </div>
      </section>

      {/* View 2 — Composite Confidence Breakdown */}
      <section data-testid="view-2-passive-recovery">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          2. Composite Confidence Breakdown (Passive Recovery)
          <HelpTip size={12} text="How confident the forecast layer is in passive-recovery decisions, broken down by the inputs that feed the composite confidence score for each room." />
        </h2>
        <PassiveRecoveryPanel recovery={cycle?.passive_recovery} />
      </section>

      {/* View 3 — RL Blend Evolution */}
      <section data-testid="view-3-blend-evolution">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          3. RL Blend-Factor Evolution
          <HelpTip size={12} text="How much the forecast is being trusted over time. Starts at zero and grows as forecast accuracy is proven against reality. By design the value approaches but never reaches 1 — the deterministic controller always retains final authority." />
        </h2>
        <BlendEvolutionChart
          historianData={blendQuery.data}
          loading={blendQuery.loading}
          error={blendQuery.error}
        />
      </section>

      {/* View 4 — Cutover Gate Status */}
      <section data-testid="view-4-cutover-gates">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          4. Cutover Gate Status
          <HelpTip size={12} text="Progress of each forecast-using controller toward being allowed to act on the forecast. See the intro paragraph in the section for the four gates." />
        </h2>
        <CutoverGateStatusGrid
          data={gatesData}
          loading={gatesLoading}
          error={gatesError}
        />
      </section>

      {/* View 5 — Reconciliation Dashboard */}
      <section data-testid="view-5-reconciliation">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          5. Predicted-vs-Actual Reconciliation
          <HelpTip size={12} text="How well forecast-influenced predictions are matching real outcomes, per controller. Drives the gates in Section 4." />
        </h2>
        <ReconciliationDashboard
          points={reconPoints}
          loading={reconLoading}
          error={reconError}
          selectedController={selectedController}
          onControllerChange={setSelectedController}
        />
      </section>

      {/* View 6 — Alarms */}
      <section data-testid="view-6-alarms">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-1.5">
          6. Alarms (notification-only)
          <HelpTip size={12} text="Issues the forecast layer has raised. Notification-only — no automatic action is taken on these. Live alarms reflect current state; historical alarms cover the last 7 days." />
        </h2>
        <AlarmsPanel
          liveAlarms={liveAlarms}
          historicalAlarms={historicalAlarms}
          loading={alarmsLoading}
          error={alarmsError}
        />
      </section>
    </div>
  )
}
