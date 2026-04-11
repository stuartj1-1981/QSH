import { useMemo } from 'react'
import { useHistorianMeasurements, useHistorianQuery } from './useHistorian'
import type { HistorianQueryPoint } from '../types/api'

/**
 * Parse an interval string (e.g. '1h', '5m', '1d') to hours.
 * Fallback produces incorrect energy/cost totals — add new interval formats here as they arise.
 */
export function intervalToHours(interval: string): number {
  const match = interval.match(/^(\d+)(m|h|d)$/)
  if (!match) {
    console.warn(`Unknown interval format "${interval}", falling back to 1h`)
    return 1
  }
  const value = Number(match[1])
  const unit = match[2]
  if (unit === 'm') return value / 60
  if (unit === 'h') return value
  if (unit === 'd') return value * 24
  return 1
}

export interface StatisticsKpis {
  totalEnergy_kWh: number
  totalCost_pence: number
  avgCop: number | null
  peakPower_kW: number | null
}

export interface UseStatisticsResult {
  available: boolean
  loading: boolean
  error: string | null
  kpis: StatisticsKpis | null
  trendData: HistorianQueryPoint[]
  refetch: () => void
}

export function useStatistics(
  timeFrom: string,
  timeTo: string,
  interval: string,
): UseStatisticsResult {
  const { data: measData, loading: measLoading } = useHistorianMeasurements()

  const available = measData?.available ?? true

  const meanQuery = useHistorianQuery(
    available ? 'qsh_system' : '',
    available ? ['cop', 'hp_power_kw', 'tariff_rate'] : [],
    { timeFrom, timeTo, interval, aggregation: 'mean' },
  )

  const maxQuery = useHistorianQuery(
    available ? 'qsh_system' : '',
    available ? ['hp_power_kw'] : [],
    { timeFrom, timeTo, interval, aggregation: 'max' },
  )

  const loading = measLoading || meanQuery.loading || maxQuery.loading
  const error = meanQuery.error ?? maxQuery.error ?? null

  const trendData = useMemo(() => meanQuery.data?.points ?? [], [meanQuery.data])

  const kpis = useMemo<StatisticsKpis | null>(() => {
    const points = meanQuery.data?.points
    if (!points || points.length === 0) return null

    const hours = intervalToHours(interval)

    let totalEnergy = 0
    let totalCost = 0
    let copSum = 0
    let copCount = 0

    for (const p of points) {
      const power = p.hp_power_kw
      if (typeof power === 'number' && power !== null) {
        totalEnergy += power * hours
        const tariff = p.tariff_rate
        if (typeof tariff === 'number' && tariff !== null) {
          totalCost += power * tariff * hours * 100
        }
      }
      const cop = p.cop
      if (typeof cop === 'number' && cop !== null) {
        copSum += cop
        copCount++
      }
    }

    const maxPoints = maxQuery.data?.points
    let peakPower: number | null = null
    if (maxPoints && maxPoints.length > 0) {
      for (const p of maxPoints) {
        const v = p.hp_power_kw
        if (typeof v === 'number' && v !== null) {
          if (peakPower === null || v > peakPower) peakPower = v
        }
      }
    }

    return {
      totalEnergy_kWh: totalEnergy,
      totalCost_pence: totalCost,
      avgCop: copCount > 0 ? copSum / copCount : null,
      peakPower_kW: peakPower,
    }
  }, [meanQuery.data, maxQuery.data, interval])

  const refetch = () => {
    meanQuery.refetch()
    maxQuery.refetch()
  }

  return { available, loading, error, kpis, trendData, refetch }
}
