import { useState, useEffect } from 'react'
import { Sparkles, FileEdit } from 'lucide-react'
import { apiUrl } from '../../lib/api'
import { cn } from '../../lib/utils'

import type { QshConfigYaml } from '../../types/config'

interface StepWelcomeProps {
  config: Partial<QshConfigYaml>
  onSetConfig: (config: Partial<QshConfigYaml>) => void
}

export function StepWelcome({ onSetConfig }: StepWelcomeProps) {
  const [hasExisting, setHasExisting] = useState(false)
  const [mode, setMode] = useState<'fresh' | 'existing'>('fresh')

  useEffect(() => {
    fetch(apiUrl('api/config/raw'))
      .then((r) => r.json())
      .then((data) => {
        if (data?.rooms && Object.keys(data.rooms).length > 0) {
          setHasExisting(true)
          setMode('existing')
          onSetConfig(data)
        }
      })
      .catch(() => {})
  }, [onSetConfig])

  const handleMode = (m: 'fresh' | 'existing') => {
    setMode(m)
    if (m === 'fresh') {
      onSetConfig({})
    } else {
      // Pre-fill from existing config
      fetch(apiUrl('api/config/raw'))
        .then((r) => r.json())
        .then((data) => {
          if (data && typeof data === 'object') onSetConfig(data)
        })
        .catch(() => {})
    }
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--accent)]/10">
          <Sparkles size={32} className="text-[var(--accent)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text)]">
          Welcome to QSH Setup
        </h2>
        <p className="text-[var(--text-muted)] max-w-lg mx-auto">
          This wizard will guide you through configuring Quantum Swarm Heating.
          We'll scan your Home Assistant for compatible entities and build your
          configuration step by step.
        </p>
      </div>

      {hasExisting && (
        <div className="max-w-md mx-auto space-y-3">
          <p className="text-sm font-medium text-[var(--text)] text-center">
            Existing configuration detected
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleMode('existing')}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-lg border text-sm transition-colors',
                mode === 'existing'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] hover:border-[var(--accent)]/50'
              )}
            >
              <FileEdit size={20} className="text-[var(--accent)]" />
              <span className="font-medium">Edit Existing</span>
              <span className="text-xs text-[var(--text-muted)]">
                Pre-fill with current config
              </span>
            </button>
            <button
              onClick={() => handleMode('fresh')}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-lg border text-sm transition-colors',
                mode === 'fresh'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] hover:border-[var(--accent)]/50'
              )}
            >
              <Sparkles size={20} className="text-[var(--accent)]" />
              <span className="font-medium">Start Fresh</span>
              <span className="text-xs text-[var(--text-muted)]">
                Build from scratch
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="max-w-md mx-auto p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
        <h3 className="text-sm font-medium text-[var(--text)] mb-2">
          What you'll configure:
        </h3>
        <ol className="text-sm text-[var(--text-muted)] space-y-1.5 list-decimal list-inside">
          <li>Heat source type and control method</li>
          <li>Sensor entities (HP flow, outdoor temp, etc.)</li>
          <li>Room definitions with TRV/sensor mapping</li>
          <li>Energy tariff (Octopus or fixed rate)</li>
          <li>Occupancy schedules</li>
          <li>Building thermal properties</li>
        </ol>
      </div>
    </div>
  )
}
