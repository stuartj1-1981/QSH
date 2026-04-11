import { useState, useEffect } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { QshConfigYaml } from '../../types/config'

interface StepDisclaimerProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

export function StepDisclaimer({ config, onUpdate }: StepDisclaimerProps) {
  const [accepted, setAccepted] = useState(config.disclaimer_accepted ?? false)

  useEffect(() => {
    onUpdate('disclaimer_accepted', accepted)
  }, [accepted, onUpdate])

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <ShieldAlert size={28} className="text-[var(--accent)]" />
        <h2 className="text-xl font-bold text-[var(--text)]">Before You Begin</h2>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">
          QSH is beta software. It is not a replacement for professional heating system
          design or installer commissioning. Your heat pump&#39;s native controls remain active
          at all times — if QSH stops for any reason, your heating system continues operating
          on its manufacturer&#39;s settings. By proceeding you acknowledge that you are
          responsible for monitoring your heating system and that you use QSH at your own risk.
        </p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
        />
        <span className="text-sm text-[var(--text)]">
          I understand and accept these terms
        </span>
      </label>
    </div>
  )
}
