import type { PresetName } from '../../types/schedule'
import { PRESET_LABELS } from '../../types/schedule'

const PRESETS = Object.keys(PRESET_LABELS) as PresetName[]

interface PresetSelectorProps {
  onSelect: (preset: PresetName) => void
  loading?: boolean
}

export function PresetSelector({ onSelect, loading }: PresetSelectorProps) {
  return (
    <select
      disabled={loading}
      onChange={(e) => {
        if (e.target.value) onSelect(e.target.value as PresetName)
        e.target.value = '' // reset to placeholder
      }}
      defaultValue=""
      className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
    >
      <option value="" disabled>
        Apply preset...
      </option>
      {PRESETS.map((p) => (
        <option key={p} value={p}>
          {PRESET_LABELS[p]}
        </option>
      ))}
    </select>
  )
}
