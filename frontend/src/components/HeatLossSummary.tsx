import { HelpTip } from './HelpTip'
import { cn } from '../lib/utils'
import { MIN_OBS_FOR_USE } from '../lib/sysidConstants'
import type { InstallationHeatLoss, SysidRoom } from '../types/api'

// INSTRUCTION-614 — the whole-house heat loss coefficient: the learned U of
// the house against its design U, and each room's learned U against its
// design U, highest ratio first. All values come from /api/sysid; this
// component calculates nothing but the sort.

interface HeatLossSummaryProps {
  summary: InstallationHeatLoss
  rooms: Record<string, SysidRoom>
}

function fmt(value: number | null | undefined, digits: number, suffix: string = ''): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`
}

const CARD_HELP =
  'QSH adds up the heat loss coefficient (U) of every room. Learned U is the U that ' +
  'the room losses and the load values on the Forecast page use; those values are ' +
  'this U × the hours of (room target − forecast outdoor temperature). The capped ' +
  'calculations clamp a room at its cap (see the Ratio column). Design U comes from ' +
  'Peak Heat Loss ÷ (Comfort Setpoint − Design External Temp); Peak Heat Loss and the design external temperature are in Settings → Thermal, the Comfort Setpoint on the Home page. ' +
  'Peak Heat Loss is 5.0 kW when it was never set, and then the ratio tells you ' +
  'nothing. With Peak Heat Loss from a heat loss survey, a house ratio well above 1 ' +
  'means that the learned U is high: a room sensor with coarse steps, or heat that ' +
  'moves to another room read as loss to outside. The ratio shows when every room ' +
  'has a learned U, as the load values do: a room at its prior pulls the ratio ' +
  'toward 1. The U in use of a learned room still keeps part of its prior while ' +
  'its reads scatter, so the ratio can read nearer 1 than the reads alone.'

// iFAT-614 F1: with every room's U equal to the plant's, the room ratios on the
// semi_1970s bench ran from 0.49 to 4.88, because the prior split weights rooms
// by facing.
const RATIO_HELP =
  "Learned U ÷ the room's prior. The prior splits Peak Heat Loss over the rooms by " +
  'area × exposure: the external walls, roof and ground floor its envelope declares. It is not a room-by-room survey, so a room can be far from 1 when ' +
  'its U is right. Read the house ratio first. A room above the cap is one that the ' +
  'capped calculations clamp. The prior of a room is kept from when it was set; a ' +
  'change of Peak Heat Loss moves it only after a reset of the room.'

export function HeatLossSummary({ summary, rooms }: HeatLossSummaryProps) {
  const rows = Object.entries(rooms)
    .filter(([, r]) => typeof r.u_vs_design === 'number')
    .sort(([, a], [, b]) => (b.u_vs_design ?? 0) - (a.u_vs_design ?? 0))

  return (
    <div
      data-testid="heat-loss-summary"
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 overflow-x-auto"
    >
      <h2 className="text-sm font-semibold text-[var(--accent)] mb-3 flex items-center gap-1.5">
        HOUSE HEAT LOSS
        <HelpTip text={CARD_HELP} size={12} />
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm mb-4">
        <Stat label="Learned U" value={fmt(summary.u_learned_kw_per_c, 3, ' kW/°C')} testId="hl-learned" />
        <Stat
          label="Design U"
          value={fmt(summary.u_design_kw_per_c, 3, ' kW/°C')}
          testId="hl-design"
          help={`Peak Heat Loss ${fmt(summary.design_loss_kw, 1, ' kW')} ÷ ${fmt(summary.design_delta_c, 1, ' K')}, from Settings → Thermal and the Comfort Setpoint.`}
        />
        <Stat label="Learned ÷ design" value={fmt(summary.ratio, 2, '×')} testId="hl-ratio" />
        <Stat
          label="Loss at design"
          value={`${fmt(summary.learned_loss_at_design_kw, 1, ' kW')} / ${fmt(summary.design_loss_kw, 1, ' kW')}`}
          testId="hl-loss"
          help="The heat loss at the design outdoor temperature: with the learned U, then as configured."
        />
        <Stat
          label="Rooms learned"
          value={`${summary.rooms_learned} of ${summary.rooms_total}`}
          testId="hl-rooms"
          help={`A room has a learned U after ${MIN_OBS_FOR_USE} accepted observations. Before that its U is its prior.`}
        />
      </div>
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="pb-2 pr-1 sm:pr-3">Room</th>
              <th className="pb-2 pr-1 sm:pr-3">U (kW/°C)</th>
              <th className="pb-2 pr-1 sm:pr-3">Design U (kW/°C)</th>
              <th className="pb-2 pr-1 sm:pr-3">
                <span className="inline-flex items-center gap-1">
                  Ratio
                  <HelpTip text={RATIO_HELP} size={12} />
                </span>
              </th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, r]) => {
              const atPrior = r.u_observations < MIN_OBS_FOR_USE
              const aboveCap = (r.u_vs_design ?? 0) > summary.cap_mult
              return (
                <tr key={name} data-testid={`hl-row-${name}`} className="border-b border-[var(--border)]/50">
                  <td className="py-1.5 pr-1 sm:pr-3 font-medium capitalize">{name.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 pr-1 sm:pr-3 font-mono">{fmt(r.u_kw_per_c, 3)}</td>
                  <td className="py-1.5 pr-1 sm:pr-3 font-mono">{fmt(r.u_prior_kw_per_c, 3)}</td>
                  <td className={cn('py-1.5 pr-1 sm:pr-3 font-mono', aboveCap && 'text-amber-600 dark:text-amber-400')}>
                    {fmt(r.u_vs_design, 2, '×')}
                  </td>
                  <td className="py-1.5 space-x-1">
                    {atPrior && <Flag label="at prior" />}
                    {aboveCap && <Flag label={`above ${summary.cap_mult}× cap`} />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Stat({ label, value, testId, help }: { label: string; value: string; testId: string; help?: string }) {
  return (
    <div>
      <div className="text-[var(--text-muted)] text-xs flex items-center gap-1">
        {label}
        {help && <HelpTip text={help} size={12} />}
      </div>
      <div data-testid={testId} className="font-semibold font-mono">{value}</div>
    </div>
  )
}

function Flag({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-700 dark:text-amber-300">
      {label}
    </span>
  )
}
