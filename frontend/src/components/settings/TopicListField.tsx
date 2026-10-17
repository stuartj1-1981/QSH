import { Plus, Trash2 } from 'lucide-react'
import { TopicField } from './TopicField'
import { addTopicSlot, removeTopicAt, setTopicAt, topicsOf, type TopicsValue } from '../../lib/topicList'

interface TopicListFieldProps {
  /** Singular label, for example "TRV Setpoint Topic". */
  label: string
  /** Plural label shown when the value holds two or more topics. */
  labelPlural: string
  value: TopicsValue
  onChange: (next: TopicsValue) => void
  placeholder: string
  /** Placeholder for the second and later rows. */
  extraPlaceholder: (n: number) => string
  /** Title and aria-label of the `+` button. */
  addTitle: string
}

/** A stored entry that is not a string (a hand-edited file) shows as a blank
 *  input. The save drops it. */
const asText = (x: unknown): string => (typeof x === 'string' ? x : '')

/**
 * INSTRUCTION-581 — list editor for an output topic (one primary input, a `+`
 * button, and one removable row for each extra topic). Same layout as the
 * INSTRUCTION-224E valve_position editor.
 */
export function TopicListField({
  label,
  labelPlural,
  value,
  onChange,
  placeholder,
  extraPlaceholder,
  addTitle,
}: TopicListFieldProps) {
  const rows = topicsOf(value)
  const primary = asText(rows[0])
  const extras = rows.slice(1)
  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1">
        {rows.length >= 2 ? labelPlural : label}
      </label>
      <div className="space-y-1.5">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TopicField
              label=""
              value={primary}
              onChange={(v) => onChange(setTopicAt(value, 0, v))}
              placeholder={placeholder}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(addTopicSlot(value))}
            className="mb-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
            title={addTitle}
            aria-label={addTitle}
          >
            <Plus size={14} />
          </button>
        </div>
        {extras.map((topic, i) => (
          <div key={`${label}-${i + 1}`} className="flex items-end gap-2">
            <div className="flex-1">
              <TopicField
                label={`${label} ${i + 2}`}
                value={asText(topic)}
                onChange={(v) => onChange(setTopicAt(value, i + 1, v))}
                placeholder={extraPlaceholder(i + 2)}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(removeTopicAt(value, i + 1))}
              className="mb-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--red)]"
              title={`Remove ${label} ${i + 2}`}
              aria-label={`Remove ${label} ${i + 2}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
