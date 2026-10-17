import { memo } from 'react'
import { RecoveryCard } from './RecoveryCard'
import { CapacityBar } from './CapacityBar'
import type { RecoveryState } from '../types/api'

interface SystemHealthProps {
  recoveryState: RecoveryState
  recoveryTimeHours: number
  capacityPct: number
  minLoadPct: number
}

export const SystemHealth = memo(function SystemHealth({ recoveryState, recoveryTimeHours, capacityPct, minLoadPct }: SystemHealthProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <RecoveryCard recoveryState={recoveryState} recoveryTimeHours={recoveryTimeHours} capacityPct={capacityPct} />
      <div className="md:col-span-2">
        <CapacityBar capacityPct={capacityPct} minLoadPct={minLoadPct} />
      </div>
    </div>
  )
})
