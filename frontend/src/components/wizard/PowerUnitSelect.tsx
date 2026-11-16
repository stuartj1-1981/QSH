import type { PowerUnit } from '../../lib/mqttTopic'

interface PowerUnitSelectProps {
  /** The name of the topic field, for the accessible name of the control. */
  label: string
  /** The `unit` that the entry holds: 'W', 'kW', '' for none, or other text. */
  stored: string
  onChange: (unit: PowerUnit) => void
}

/** INSTRUCTION-629D — the unit of an MQTT power topic. kW is the default and
 *  is stored as no `unit` key; W is stored as `unit: 'W'`. A stored value that
 *  is not one of the two is shown, and the user must select W or kW. */
export function PowerUnitSelect({ label, stored, onChange }: PowerUnitSelectProps) {
  const known = stored === '' || stored === 'W' || stored === 'kW'
  const value = stored === '' ? 'kW' : stored
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>Unit of this topic</span>
        <select
          aria-label={`${label} unit`}
          value={value}
          onChange={(e) => {
            const next = e.target.value
            if (next === 'W' || next === 'kW') onChange(next)
          }}
          className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)]"
        >
          {!known && (
            <option value={stored} disabled>
              {stored} (not valid)
            </option>
          )}
          <option value="kW">kW</option>
          <option value="W">W</option>
        </select>
      </label>
      {!known && (
        <span role="alert" className="text-xs text-[var(--red)]">
          Select W or kW.
        </span>
      )}
    </div>
  )
}
