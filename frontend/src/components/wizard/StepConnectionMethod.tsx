import { Network, Home } from 'lucide-react'
import { cn } from '../../lib/utils'

interface StepConnectionMethodProps {
  config: Record<string, unknown>
  onUpdate: (section: string, data: unknown) => void
}

const OPTIONS = [
  {
    id: 'ha' as const,
    label: 'Home Assistant',
    desc: 'Sensors and control via Home Assistant entities',
    Icon: Home,
  },
  {
    id: 'mqtt' as const,
    label: 'MQTT',
    desc: 'Direct MQTT broker connection',
    Icon: Network,
  },
] as const

export function StepConnectionMethod({ config, onUpdate }: StepConnectionMethodProps) {
  const selected = (config.driver as string) || 'ha'

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Connection Method</h2>
        <p className="text-sm text-[var(--text-muted)]">
          How does QSH connect to your sensors and heating system?
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {OPTIONS.map(({ id, label, desc, Icon }) => (
          <button
            key={id}
            onClick={() => onUpdate('driver', id)}
            className={cn(
              'flex flex-col items-center gap-3 p-6 rounded-lg border text-sm transition-colors',
              selected === id
                ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] hover:border-[var(--accent)]/50'
            )}
          >
            <Icon
              size={32}
              className={selected === id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}
            />
            <span className="font-medium text-[var(--text)]">{label}</span>
            <span className="text-xs text-[var(--text-muted)] text-center">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
