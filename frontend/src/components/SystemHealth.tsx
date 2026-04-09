import { memo } from 'react'
import { RecoveryCard } from './RecoveryCard'
import { CapacityBar } from './CapacityBar'

interface SystemHealthProps {
  recoveryTimeHours: number
  capacityPct: number
  minLoadPct: number
  operatingState?: string
}

export const SystemHealth = memo(function SystemHealth({ recoveryTimeHours, capacityPct, minLoadPct, operatingState }: SystemHealthProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <RecoveryCard recoveryTimeHours={recoveryTimeHours} capacityPct={capacityPct} operatingState={operatingState} />
      <div className="md:col-span-2">
        <CapacityBar capacityPct={capacityPct} minLoadPct={minLoadPct} />
      </div>
    </div>
  )
})
