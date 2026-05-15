import { useMemo } from 'react'
import { useHistorianQuery } from './useHistorian'

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
  const { data: historianData, loading, error } = useHistorianQuery(
    'qsh_forecast_reconciliation',
    [
      'predicted',
      'actual',
      'error_c',
      'prediction_target_ts',
      'basis_summary',
      'basis_hash',
    ],
    {
      room,
      timeFrom,
      timeTo: 'now()',
      interval: '5m',
      aggregation: 'last',
    },
  )

  const points = useMemo<ReconciliationPoint[]>(() => {
    if (!historianData?.points) return []
    return historianData.points
      .map((p): ReconciliationPoint | null => {
        const point = p as unknown as Record<string, unknown>
        if (controller !== undefined && point['controller'] !== controller) {
          return null
        }
        return {
          controller: typeof point['controller'] === 'string' ? point['controller'] : '',
          room: typeof point['room'] === 'string' ? point['room'] : '',
          weather_class:
            typeof point['weather_class'] === 'string' ? point['weather_class'] : null,
          predicted: typeof point['predicted'] === 'number' ? point['predicted'] : 0,
          actual: typeof point['actual'] === 'number' ? point['actual'] : 0,
          error_c: typeof point['error_c'] === 'number' ? point['error_c'] : 0,
          prediction_target_ts:
            typeof point['prediction_target_ts'] === 'number'
              ? point['prediction_target_ts']
              : 0,
          basis_summary:
            typeof point['basis_summary'] === 'string' ? point['basis_summary'] : null,
          basis_hash:
            typeof point['basis_hash'] === 'string' ? point['basis_hash'] : null,
        }
      })
      .filter((pt): pt is ReconciliationPoint => pt !== null)
  }, [historianData, controller])

  return { points, loading, error }
}
