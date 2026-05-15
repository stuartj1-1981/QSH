// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
//
// 228B Task 2: Source-selection Settings subsection.
//   * Renders an explainer note when fewer than two heat sources are configured.
//   * Mode selector lists `Auto` plus one `Lock to <name>` option per configured source.
//   * Preference slider with "Pure cost / Balanced / Pure carbon" anchors.
//   * Engineering-gated dwell / deadband / daily-cap inputs.
//   * Daily-cap clamped to 1..12 at the UI level (compressor cycle-life guard).
import { useState, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { HelpTip } from '../HelpTip'
import { SOURCE_SELECTION } from '../../lib/helpText'
import type { SourceSelectionYaml } from '../../types/config'

interface SourceSelectionSettingsProps {
  config?: SourceSelectionYaml
  sourceNames: string[]
  onRefetch: () => void
}

const DAILY_CAP_MIN = 1
const DAILY_CAP_MAX = 12  // 228B Task 2 L2: UI guard against pathologically short dwell/switch cycles
const DEFAULT_CONFIG: SourceSelectionYaml = {
  mode: 'auto',
  preference: 0.7,
  min_dwell_minutes: 30,
  score_deadband_pct: 10.0,
  max_switches_per_day: 6,
}

// Internal mode label form: 'auto' or 'lock:<name>'. Stripped to the
// bare source name at the save boundary because the backend
// (qsh/pipeline/controllers/source_selection.py::_find_source_by_mode)
// expects raw names with no prefix.
function modeToInternal(yamlMode: string): 'auto' | `lock:${string}` {
  return yamlMode === 'auto' ? 'auto' : `lock:${yamlMode}`
}
function internalToYaml(internal: 'auto' | `lock:${string}`): string {
  return internal === 'auto' ? 'auto' : internal.slice('lock:'.length)
}

function isEngineeringEnabled(): boolean {
  try {
    return localStorage.getItem('qsh-engineering') === 'true'
  } catch {
    return false
  }
}

export function SourceSelectionSettings({ config, sourceNames, onRefetch }: SourceSelectionSettingsProps) {
  // 228B Task 2 L7: render explainer for single-source installs.
  if (sourceNames.length < 2) {
    return (
      <div
        data-testid="source-selection-explainer"
        className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]"
      >
        <h3 className="text-sm font-bold text-[var(--text)] mb-1">Source Selection</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Hybrid source selection becomes available when two or more heat sources are configured.
        </p>
      </div>
    )
  }

  return (
    <SourceSelectionPanel
      config={config ?? DEFAULT_CONFIG}
      sourceNames={sourceNames}
      onRefetch={onRefetch}
    />
  )
}

interface PanelProps {
  config: SourceSelectionYaml
  sourceNames: string[]
  onRefetch: () => void
}

function SourceSelectionPanel({ config, sourceNames, onRefetch }: PanelProps) {
  const [ss, setSs] = useState<SourceSelectionYaml>(config)
  const { patch, saving } = usePatchConfig()
  const [engineering, setEngineering] = useState<boolean>(isEngineeringEnabled())

  useEffect(() => { setSs(config) }, [config])

  // The engineering flag lives in localStorage and is set elsewhere. Re-read
  // it on focus / storage events so toggling Engineering from another tab
  // (or another mounted view) is reflected here without a manual refresh.
  useEffect(() => {
    const sync = () => setEngineering(isEngineeringEnabled())
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  const update = (changes: Partial<SourceSelectionYaml>) => {
    setSs(prev => ({ ...prev, ...changes }))
  }

  const save = async () => {
    // Clamp daily cap defensively in case state went out of bounds via direct
    // input. The render layer already clamps min/max on the <input>; this
    // ensures the wire payload is bounded even on edge inputs.
    const clamped: SourceSelectionYaml = {
      ...ss,
      max_switches_per_day: Math.max(
        DAILY_CAP_MIN,
        Math.min(DAILY_CAP_MAX, Math.round(ss.max_switches_per_day)),
      ),
      preference: Math.max(0, Math.min(1, ss.preference)),
    }
    const result = await patch('source_selection', clamped)
    if (result) onRefetch()
  }

  const internalMode = modeToInternal(ss.mode)
  const setMode = (next: 'auto' | `lock:${string}`) => {
    update({ mode: internalToYaml(next) })
  }

  const preferencePct = Math.round(ss.preference * 100)
  const preferenceAnchor =
    preferencePct === 0 ? 'Pure cost'
      : preferencePct === 100 ? 'Pure carbon'
        : preferencePct === 50 ? 'Balanced'
          : `${preferencePct}%`

  return (
    <div
      data-testid="source-selection-panel"
      className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]"
    >
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

      <div>
        <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
          Mode <HelpTip text={SOURCE_SELECTION.mode} size={12} />
        </label>
        <div role="radiogroup" aria-label="Source selection mode" className="flex flex-col gap-1">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
            <input
              type="radio"
              name="source-mode"
              value="auto"
              checked={internalMode === 'auto'}
              onChange={() => setMode('auto')}
              className="accent-[var(--accent)]"
            />
            Auto
          </label>
          {sourceNames.map((name) => {
            const lockValue: `lock:${string}` = `lock:${name}`
            return (
              <label key={name} className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="radio"
                  name="source-mode"
                  value={lockValue}
                  checked={internalMode === lockValue}
                  onChange={() => setMode(lockValue)}
                  className="accent-[var(--accent)]"
                />
                Lock to {name}
              </label>
            )
          })}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
          Cost / Carbon Preference <HelpTip text={SOURCE_SELECTION.preference} size={12} />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Pure cost</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={preferencePct}
            onChange={(e) => update({ preference: parseInt(e.target.value, 10) / 100 })}
            className="flex-1 accent-[var(--accent)]"
            data-testid="source-selection-preference"
          />
          <span className="text-xs text-[var(--text-muted)]">Pure carbon</span>
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-1 text-center" data-testid="source-selection-preference-anchor">
          {preferenceAnchor}
        </div>
      </div>

      {engineering && (
        <div
          data-testid="source-selection-engineering"
          className="grid grid-cols-3 gap-4 pt-2 border-t border-[var(--border)]"
        >
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
              Min Dwell (min) <HelpTip text={SOURCE_SELECTION.dwell} size={12} />
            </label>
            <input
              type="number"
              min={0}
              value={ss.min_dwell_minutes}
              onChange={(e) => update({ min_dwell_minutes: parseInt(e.target.value, 10) || 30 })}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              data-testid="source-selection-dwell"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
              Deadband (%) <HelpTip text={SOURCE_SELECTION.deadband} size={12} />
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={ss.score_deadband_pct}
              onChange={(e) => update({ score_deadband_pct: parseFloat(e.target.value) || 10.0 })}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              data-testid="source-selection-deadband"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
              Max Switches/Day <HelpTip text={SOURCE_SELECTION.maxSwitches} size={12} />
            </label>
            <input
              type="number"
              min={DAILY_CAP_MIN}
              max={DAILY_CAP_MAX}
              value={ss.max_switches_per_day}
              onChange={(e) => {
                const raw = parseInt(e.target.value, 10)
                const next = Number.isFinite(raw)
                  ? Math.max(DAILY_CAP_MIN, Math.min(DAILY_CAP_MAX, raw))
                  : 6
                update({ max_switches_per_day: next })
              }}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              data-testid="source-selection-daily-cap"
            />
          </div>
        </div>
      )}
    </div>
  )
}
