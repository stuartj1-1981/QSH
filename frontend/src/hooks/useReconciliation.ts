import { useMemo } from 'react'
import { useHistorianEvents } from './useHistorian'

export interface ReconciliationPoint {
  controller: string
  room: string
  weather_class: string | null
  predicted: number
  actual: number
  error_c: number
  prediction_target_ts: number
  basis_summary: string | null
  basis_hash: string | null
}

interface UseReconciliationResult {
  points: ReconciliationPoint[]
  loading: boolean
  error: string | null
}

export function useReconciliation(
  controller?: string,
  room?: string,
  timeFrom: string = '-7d',
): UseReconciliationResult {
  const { data: historianData, loading, error } = useHistorianEvents(
    'qsh_forecast_reconciliation',
    { controller, room, timeFrom },
  )

  const points = useMemo<ReconciliationPoint[]>(() => {
    if (!historianData?.rows) return []
    return historianData.rows
      .map((row): ReconciliationPoint | null => {
        // The route filters on controller already; this keeps the hook's
        // contract when the route is bypassed.
        if (controller !== undefined && row['controller'] !== controller) {
          return null
        }
        // The weather class is composed from the three class tags; a row
        // whose three tags are all unknown has none.
        const oat = row['oat_class']
        const solar = row['solar_class']
        const wind = row['wind_class']
        return {
          controller: typeof row['controller'] === 'string' ? row['controller'] : '',
          room: typeof row['room'] === 'string' ? row['room'] : '',
          weather_class:
            typeof oat === 'string' &&
            typeof solar === 'string' &&
            typeof wind === 'string' &&
            !(oat === 'unknown' && solar === 'unknown' && wind === 'unknown')
              ? `${oat}/${solar}/${wind}`
              : null,
          predicted: typeof row['predicted'] === 'number' ? row['predicted'] : 0,
          actual: typeof row['actual'] === 'number' ? row['actual'] : 0,
          error_c: typeof row['error_c'] === 'number' ? row['error_c'] : 0,
          prediction_target_ts:
            typeof row['prediction_target_ts'] === 'number'
              ? row['prediction_target_ts']
              : 0,
          basis_summary:
            typeof row['basis_summary'] === 'string' ? row['basis_summary'] : null,
          basis_hash:
            typeof row['basis_hash'] === 'string' ? row['basis_hash'] : null,
        }
      })
      .filter((pt): pt is ReconciliationPoint => pt !== null)
  }, [historianData, controller])

  return { points, loading, error }
}
