import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { CloudSun, Snowflake, Wind } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ForecastStateSnapshot } from '../../types/api'

interface ForecastStatePanelProps {
  state: ForecastStateSnapshot | undefined
}

function formatScalar(value: number | null, suffix: string = ''): string {
  return value === null ? '—' : `${value.toFixed(1)}${suffix}`
}

export function ForecastStatePanel({ state }: ForecastStatePanelProps) {
  if (!state) {
    return (
      <div className="p-4 bg-[var(--bg-card)] rounded-lg text-[var(--text-muted)]">
        Forecast state not yet available.
      </div>
    )
  }

  const tempsData = state.hourly_temps_first_6.map((t, i) => ({ i, t }))
  const solarData = state.hourly_solar_first_6.map((s, i) => ({ i, s }))

  return (
    <div className="p-4 bg-[var(--bg-card)] rounded-lg">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <CloudSun size={18} /> Forecast State
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3 mb-4">
        <div className="p-2 bg-[var(--bg)] rounded">
          <div className="text-xs text-[var(--text-muted)]">OAT rise 6h</div>
          <div className="font-semibold">{formatScalar(state.oat_rise_next_6h_c, '°C')}</div>
        </div>
        <div className="p-2 bg-[var(--bg)] rounded">
          <div className="text-xs text-[var(--text-muted)]">Solar 12h</div>
          <div className="font-semibold">{formatScalar(state.solar_kwh_12h, ' kWh')}</div>
        </div>
        <div className="p-2 bg-[var(--bg)] rounded">
          <div className="text-xs text-[var(--text-muted)]">Load 4h</div>
          <div className="font-semibold">{formatScalar(state.forecast_load_kwh_4h, ' kWh')}</div>
        </div>
        <div className="p-2 bg-[var(--bg)] rounded">
          <div className="text-xs text-[var(--text-muted)]">Load 12h</div>
          <div className="font-semibold">{formatScalar(state.forecast_load_kwh_12h, ' kWh')}</div>
        </div>
        <div className="p-2 bg-[var(--bg)] rounded">
          <div className="text-xs text-[var(--text-muted)]">Load 24h</div>
          <div className="font-semibold">{formatScalar(state.forecast_load_kwh_24h, ' kWh')}</div>
        </div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {state.cold_snap_active && (
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs',
            'bg-blue-500/20 text-blue-700 dark:text-blue-300',
          )}>
            <Snowflake size={12} /> Cold snap
          </span>
        )}
        {state.wind_active && (
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs',
            'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
          )}>
            <Wind size={12} /> Wind
          </span>
        )}
      </div>
      {tempsData.length > 0 && (
        <div className="mb-2">
          <div className="text-xs text-[var(--text-muted)] mb-1">Hourly OAT (next 6h)</div>
          <ResponsiveContainer width="100%" height={60}>
            <LineChart data={tempsData}>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 12,
                }}
                // labelFormatter receives the data array index because no XAxis
                // dataKey is configured (sparkline pattern). If a future edit adds
                // an XAxis with dataKey, this formatter must be updated.
                labelFormatter={(label) => `+${Number(label)}h`}
                formatter={(value) => [`${Number(value).toFixed(1)}°C`, 'OAT']}
                cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1 }}
              />
              <Line type="monotone" dataKey="t" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {solarData.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-muted)] mb-1">Hourly solar potential (next 6h)</div>
          <ResponsiveContainer width="100%" height={60}>
            <LineChart data={solarData}>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 12,
                }}
                // labelFormatter receives the data array index because no XAxis
                // dataKey is configured (sparkline pattern). If a future edit adds
                // an XAxis with dataKey, this formatter must be updated.
                labelFormatter={(label) => `+${Number(label)}h`}
                // hourly_solar is dimensionless [0, 1] potential per qsh/forecast/compute.py:82
                formatter={(value) => [Number(value).toFixed(2), 'Solar potential']}
                cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1 }}
              />
              <Line type="monotone" dataKey="s" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
