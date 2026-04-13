// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { HelpTip } from '../HelpTip'
import { SOURCE_SELECTION } from '../../lib/helpText'
import type { SourceSelectionYaml } from '../../types/config'

interface SourceSelectionSettingsProps {
  config: SourceSelectionYaml
  sourceNames: string[]
  onRefetch: () => void
}

export function SourceSelectionSettings({ config, sourceNames, onRefetch }: SourceSelectionSettingsProps) {
  const [ss, setSs] = useState<SourceSelectionYaml>(config)
  const { patch, saving } = usePatchConfig()

  useEffect(() => { setSs(config) }, [config])

  const update = (changes: Partial<SourceSelectionYaml>) => {
    setSs(prev => ({ ...prev, ...changes }))
  }

  const save = async () => {
    const result = await patch('source_selection', ss)
    if (result) onRefetch()
  }

  return (
    <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text)]">Source Selection</h3>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
            Default Mode <HelpTip text={SOURCE_SELECTION.mode} size={12} />
          </label>
          <select
            value={ss.mode}
            onChange={(e) => update({ mode: e.target.value })}
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          >
            <option value="auto">Auto</option>
            {sourceNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
            Cost/Eco Preference <HelpTip text={SOURCE_SELECTION.preference} size={12} />
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(ss.preference * 100)}
              onChange={(e) => update({ preference: parseInt(e.target.value, 10) / 100 })}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="text-xs text-[var(--text-muted)] w-8 text-right">
              {Math.round(ss.preference * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
            Min Dwell (min) <HelpTip text={SOURCE_SELECTION.dwell} size={12} />
          </label>
          <input
            type="number"
            value={ss.min_dwell_minutes}
            onChange={(e) => update({ min_dwell_minutes: parseInt(e.target.value, 10) || 30 })}
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
            Deadband (%) <HelpTip text={SOURCE_SELECTION.deadband} size={12} />
          </label>
          <input
            type="number"
            value={ss.score_deadband_pct}
            onChange={(e) => update({ score_deadband_pct: parseFloat(e.target.value) || 10.0 })}
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
            Max Switches/Day <HelpTip text={SOURCE_SELECTION.maxSwitches} size={12} />
          </label>
          <input
            type="number"
            value={ss.max_switches_per_day}
            onChange={(e) => update({ max_switches_per_day: parseInt(e.target.value, 10) || 6 })}
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>
      </div>
    </div>
  )
}
