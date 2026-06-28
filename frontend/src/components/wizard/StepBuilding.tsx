import type { FabricClass, QshConfigYaml } from '../../types/config'

interface StepBuildingProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

// INSTRUCTION-368 — Taxonomy-V1 §3.5 fabric classes, user-facing labels.
// `unknown` is intentionally NOT offered as a choice: the "I don't know" path
// leaves the field UNSET (undefined), it does not store "unknown".
const FABRIC_OPTIONS: { value: FabricClass; label: string }[] = [
  { value: 'solid_wall', label: 'Solid wall (pre-1930s, no cavity)' },
  { value: 'cavity_unfilled', label: 'Cavity wall — unfilled' },
  { value: 'cavity_filled', label: 'Cavity wall — filled / insulated' },
  { value: 'timber_frame', label: 'Timber frame' },
  { value: 'sip', label: 'Structural insulated panel (SIP)' },
  { value: 'mixed', label: 'Mixed construction' },
]

export function StepBuilding({ config, onUpdate }: StepBuildingProps) {
  const constructionYear = config.construction_year
  const fabricClass = config.fabric_class

  return (
    <div className="space-y-8" data-testid="step-building">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">
          Building Construction
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Optional. These help QSH classify your building&apos;s archetype for
          fleet learning. Leave them unset if you&apos;re not sure — QSH never
          guesses, it simply learns from your own home instead.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Construction year */}
        <div>
          <label
            htmlFor="construction-year"
            className="block text-sm font-medium text-[var(--text)] mb-1"
          >
            Construction Year
          </label>
          <input
            id="construction-year"
            type="number"
            inputMode="numeric"
            min={1700}
            max={new Date().getFullYear()}
            placeholder="e.g. 2016"
            value={constructionYear ?? ''}
            onChange={(e) => {
              const raw = e.target.value.trim()
              if (raw === '') {
                onUpdate('construction_year', undefined)
                return
              }
              const parsed = parseInt(raw, 10)
              onUpdate(
                'construction_year',
                Number.isFinite(parsed) ? parsed : undefined
              )
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            The year the property was built. Leave blank if unknown.
          </p>
        </div>

        {/* Fabric class */}
        <div>
          <label
            htmlFor="fabric-class"
            className="block text-sm font-medium text-[var(--text)] mb-1"
          >
            Wall Construction
          </label>
          <select
            id="fabric-class"
            value={fabricClass ?? ''}
            onChange={(e) => {
              const v = e.target.value
              onUpdate('fabric_class', v === '' ? undefined : (v as FabricClass))
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          >
            <option value="">Not sure — leave unset</option>
            {FABRIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Your home&apos;s primary wall construction type.
          </p>
        </div>
      </div>
    </div>
  )
}
