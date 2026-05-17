import { Fragment, useState } from 'react'
import type { PredictionRecord } from '../../types/api'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { HelpTip } from '../HelpTip'

interface PredictionRecordsTableProps {
  records: Record<string, Record<string, PredictionRecord>> | undefined
}

function formatTimeFromNow(ts: number): string {
  const now = Date.now() / 1000
  const dt = ts - now
  if (dt < 0) return `${Math.abs(dt).toFixed(0)}s ago`
  if (dt < 60) return `in ${dt.toFixed(0)}s`
  if (dt < 3600) return `in ${(dt / 60).toFixed(1)}m`
  return `in ${(dt / 3600).toFixed(1)}h`
}

// INSTRUCTION-227A Task 3 — header is shared between the empty and populated
// branches so the HelpTip is visible in both states.
const Header = (
  <h3 className="font-semibold mb-3 flex items-center gap-1.5">
    In-Flight Prediction Records
    <HelpTip
      size={12}
      text="Decisions the forecast layer has already taken whose predicted outcome hasn't yet arrived. Each row shows the controller, room, predicted value, target time, and the decision taken. Click a row to inspect the full decision basis (sysid params, thresholds, weighting). These records will be reconciled against actual observed values once the target time passes — that reconciliation drives the gates in Section 4."
    />
  </h3>
)

export function PredictionRecordsTable({ records }: PredictionRecordsTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!records || Object.keys(records).length === 0) {
    return (
      <div className="p-4 bg-[var(--bg-card)] rounded-lg">
        {Header}
        <div className="text-[var(--text-muted)]">
          No in-flight prediction records this cycle.
        </div>
      </div>
    )
  }

  const flatRows: Array<{ controller: string; room: string; record: PredictionRecord }> = []
  for (const [controller, roomMap] of Object.entries(records)) {
    for (const [room, record] of Object.entries(roomMap)) {
      flatRows.push({ controller, room, record })
    }
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="p-4 bg-[var(--bg-card)] rounded-lg">
      {Header}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
          <tr className="text-[var(--text-muted)]">
            <th className="text-left py-1"></th>
            <th className="text-left py-1">Controller</th>
            <th className="text-left py-1">Room</th>
            <th className="text-right py-1">Predicted Value</th>
            <th className="text-right py-1">Target</th>
            <th className="text-left py-1">Decision Taken</th>
          </tr>
        </thead>
        <tbody>
          {flatRows.map(({ controller, room, record }) => {
            const key = `${controller}|${room}`
            const isExpanded = expanded.has(key)
            return (
              <Fragment key={key}>
                <tr
                  className="border-t border-[var(--border)] cursor-pointer"
                  onClick={() => toggle(key)}
                >
                  <td className="py-1">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </td>
                  <td className="py-1">{controller}</td>
                  <td className="py-1">{room}</td>
                  <td className="py-1 text-right">{record.predicted_value.toFixed(2)}</td>
                  <td className="py-1 text-right">{formatTimeFromNow(record.prediction_target_ts)}</td>
                  <td className="py-1 truncate max-w-[220px]">{record.decision_taken}</td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={6} className="py-2 px-4 bg-[var(--bg)] text-xs">
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(record.decision_basis, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
