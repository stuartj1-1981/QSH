// Performance: not in 30s WS render path — React.memo not required.
// InfrastructureCard has no current call site in the application.
import { Sun, Battery, Zap } from 'lucide-react'

interface InfrastructureCardProps {
  solarProduction?: number | null
  batterySoc?: number | null
  gridPower?: number | null
}

export function InfrastructureCard({
  solarProduction,
  batterySoc,
  gridPower,
}: InfrastructureCardProps) {
  // Only render if at least one infrastructure value is available
  const hasData = (solarProduction != null && solarProduction > 0)
    || (batterySoc != null)
    || (gridPower != null)

  if (!hasData) return null

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-4">
      <h3 className="text-sm font-semibold mb-3">Infrastructure</h3>
      <div className="flex flex-wrap gap-4">
        {solarProduction != null && (
          <div className="flex items-center gap-2 text-sm">
            <Sun size={16} className="text-amber-500" />
            <span>{solarProduction.toFixed(1)} kW solar</span>
          </div>
        )}
        {batterySoc != null && (
          <div className="flex items-center gap-2 text-sm">
            <Battery size={16} className="text-green-500" />
            <span>{batterySoc.toFixed(0)}% battery</span>
          </div>
        )}
        {gridPower != null && (
          <div className="flex items-center gap-2 text-sm">
            <Zap size={16} className="text-[var(--blue)]" />
            <span>{gridPower.toFixed(1)} kW grid</span>
          </div>
        )}
      </div>
    </div>
  )
}
