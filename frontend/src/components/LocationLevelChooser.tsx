import { cn } from '../lib/utils'
import {
  LOCATION_CANNOT_USE_HEADING,
  LOCATION_CAN_USE_HEADING,
  LOCATION_HEADING,
  LOCATION_INPUT_HELP,
  LOCATION_INTERNATIONAL_NOTE,
  LOCATION_INTRO,
  LOCATION_LEVELS,
  LOCATION_LOWERING_NOTE,
  LOCATION_SHARES_HEADING,
  LOCATION_STATUS_NOTE,
} from '../lib/locationLevels'
import type { LocationLevel } from '../types/config'

interface LocationLevelChooserProps {
  regionMode: 'uk' | 'international'
  level: LocationLevel
  code: string
  onChange: (level: LocationLevel, code: string) => void
}

// INSTRUCTION-570C — the data-sharing location level, shared by the wizard's
// Data Sharing step and the Settings Data Sharing page. It holds no state and
// no check of the postcode form: the server holds that rule.
export function LocationLevelChooser({ regionMode, level, code, onChange }: LocationLevelChooserProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text)]">{LOCATION_HEADING}</h3>
      <p className="text-sm text-[var(--text-muted)] leading-relaxed">{LOCATION_INTRO}</p>
      <p className="text-xs text-[var(--text-muted)] italic">{LOCATION_STATUS_NOTE}</p>

      {regionMode === 'international' ? (
        <p className="text-sm text-[var(--text-muted)]">{LOCATION_INTERNATIONAL_NOTE}</p>
      ) : (
        <div role="radiogroup" aria-label={LOCATION_HEADING} className="space-y-3">
          {LOCATION_LEVELS.map((entry) => {
            const selected = entry.level === level
            return (
              <div
                key={entry.level}
                className={cn(
                  'rounded-lg border bg-[var(--bg)] p-3 space-y-2',
                  selected ? 'border-[var(--accent)]' : 'border-[var(--border)]'
                )}
              >
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-[var(--text)]">
                  <input
                    type="radio"
                    name="location-level"
                    value={entry.level}
                    checked={selected}
                    onChange={() => onChange(entry.level, '')}
                    className="accent-[var(--accent)]"
                  />
                  {entry.label}
                </label>
                <div className="space-y-1 pl-6 text-xs text-[var(--text-muted)]">
                  <p className="font-medium text-[var(--text)]">{LOCATION_SHARES_HEADING}</p>
                  <p>{entry.shares}</p>
                  <p className="font-medium text-[var(--text)]">{LOCATION_CAN_USE_HEADING}</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {entry.canUse.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <p className="font-medium text-[var(--text)]">{LOCATION_CANNOT_USE_HEADING}</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {entry.cannotUse.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
                {selected && entry.placeholder !== null && (
                  <div className="space-y-1 pl-6">
                    <label htmlFor="location-code" className="block text-xs font-medium text-[var(--text)]">
                      {entry.inputLabel}
                    </label>
                    <input
                      id="location-code"
                      type="text"
                      value={code}
                      placeholder={entry.placeholder}
                      onChange={(e) => onChange(entry.level, e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
                    />
                    <p className="text-xs text-[var(--text-muted)]">{LOCATION_INPUT_HELP}</p>
                    {entry.privacyNote && (
                      <p className="text-xs text-[var(--text-muted)]">{entry.privacyNote}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">{LOCATION_LOWERING_NOTE}</p>
    </div>
  )
}
