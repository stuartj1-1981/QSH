// INSTRUCTION-572B — one chooser for Settings and for the wizard.
// Driver-agnostic: it names no Home Assistant entity and no MQTT topic.
import { WINDOW_INFERENCE, WINDOW_INFERENCE_LABEL } from '../lib/helpText'
import { WINDOW_INFERENCE_MODES } from '../lib/windowSettings'
import type { WindowInferenceMode } from '../types/config'

interface WindowInferenceChooserProps {
  /** The name of the radio group. Each page that shows the chooser gives its own. */
  name: string
  /** The selected mode. Null is a stored value that is not a mode: no radio
   *  is selected, and a line of text says how QSH reads the value. */
  value: WindowInferenceMode | null
  onChange: (mode: WindowInferenceMode) => void
}

export function WindowInferenceChooser({ name, value, onChange }: WindowInferenceChooserProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-[var(--text)]">{WINDOW_INFERENCE.title}</legend>
      <p className="text-xs text-[var(--text-muted)]">{WINDOW_INFERENCE.intro}</p>
      {value === null && (
        <p className="text-xs text-[var(--amber)]" role="status">{WINDOW_INFERENCE.invalid}</p>
      )}
      <div className="space-y-2">
        {WINDOW_INFERENCE_MODES.map((mode) => (
          <label key={mode} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name={name}
              checked={value === mode}
              onChange={() => onChange(mode)}
              aria-label={WINDOW_INFERENCE_LABEL[mode]}
              aria-describedby={`${name}-${mode}-text`}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm text-[var(--text)]">{WINDOW_INFERENCE_LABEL[mode]}</span>
              <span id={`${name}-${mode}-text`} className="block text-xs text-[var(--text-muted)]">
                {WINDOW_INFERENCE[mode]}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
