// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-524B.
/**
 * The one historian control (INSTRUCTION-524B T4). Settings renders it, and
 * the setup wizard reuses it with these same six props (INSTRUCTION-524C).
 *
 * It offers the built-in store only. It holds no state, fetches nothing and
 * decides nothing: the mode comes from `deriveHistorianMode`, and every
 * press is reported upwards as a `HistorianAction`.
 */
import {
  deriveHistorianMode,
  isParked,
  type HistorianAction,
} from '../../lib/historianMode'
import { HISTORIAN } from '../../lib/helpText'
import type { HistorianYaml } from '../../types/config'
import type { HistorianSetupResponse } from '../../types/api'

interface HistorianChoiceProps {
  section: HistorianYaml | null | undefined
  setup: HistorianSetupResponse | null
  error: string | null
  checked: boolean
  onAction: (action: HistorianAction) => void
  onRetry: () => void
}

/** The paragraphs shown for a mode, in order. */
function textFor(
  mode: ReturnType<typeof deriveHistorianMode>,
  section: HistorianYaml,
  setup: HistorianSetupResponse | null,
): string[] {
  const enabled = section.enabled === true
  const active = setup?.active === true

  switch (mode) {
    case 'unknown':
      if (setup === null) return [HISTORIAN.unknown.noSetup]
      if (setup.record_state === 'unread') return [HISTORIAN.unknown.unread]
      return [HISTORIAN.unknown.noState]

    case 'unavailable':
      return [HISTORIAN.unavailable]

    case 'unreadable':
      return [HISTORIAN.unreadable]

    case 'migrating':
      if (isParked(section)) {
        // Three variants, not two: a disabled historian is off first and
        // parked second (review finding R1).
        const lead = !enabled
          ? HISTORIAN.migratingParked.notEnabled
          : active
            ? HISTORIAN.migratingParked.active
            : HISTORIAN.migratingParked.inactive
        return [lead, HISTORIAN.migratingParked.advice]
      }
      if (active) return [HISTORIAN.migrating.active]
      if (enabled) return [HISTORIAN.migrating.enabledNotActive]
      return [HISTORIAN.migrating.notEnabled]

    case 'builtin':
      if (!enabled) return [HISTORIAN.builtin.notEnabled]
      return active
        ? [HISTORIAN.builtin.recording]
        : [HISTORIAN.builtin.enabledNotActive]

    case 'legacy':
      return [
        HISTORIAN.legacy.lead,
        section.store?.shadow === false
          ? HISTORIAN.legacy.move
          : HISTORIAN.legacy.noStore,
      ]

    case 'fresh': {
      const out: string[] = [HISTORIAN.fresh.lead]
      if (section.host !== undefined || section.backend === 'influxdb') {
        out.push(HISTORIAN.fresh.oldInflux)
      }
      if (enabled && section.backend === 'qsdb' && setup?.store_open === false) {
        out.push(HISTORIAN.fresh.storeDidNotStart)
      }
      return out
    }
  }
}

const BUTTON_CLASS =
  'px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)]'

export function HistorianChoice({
  section,
  setup,
  error,
  checked,
  onAction,
  onRetry,
}: HistorianChoiceProps) {
  const s = section ?? {}
  const mode = deriveHistorianMode(s, setup)

  // `unknown` may not be written to at all. The three states below describe
  // a store that cannot serve, so the only safe move is turning it off.
  const checkboxDisabled =
    mode === 'unknown' ||
    ((mode === 'unavailable' || mode === 'unreadable' || mode === 'legacy') &&
      !checked)

  const showResume = mode === 'migrating' && isParked(s)
  const showUseBuiltin =
    (mode === 'builtin' || mode === 'fresh') &&
    s.enabled === true &&
    (s.backend !== 'qsdb' || setup?.active !== true)
  const showMove = mode === 'legacy' && s.store?.shadow === false

  return (
    <div className="space-y-3">
      <div
        data-testid="historian-mode"
        data-mode={mode}
        className="space-y-2 text-sm text-[var(--text-dim)]"
      >
        {textFor(mode, s, setup).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          disabled={checkboxDisabled}
          onChange={(e) => onAction(e.target.checked ? 'enable' : 'disable')}
          className="accent-[var(--accent)] disabled:opacity-50"
        />
        <span className="text-sm font-medium text-[var(--text)]">
          Record history in the built-in store
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {showResume && (
          <button className={BUTTON_CLASS} onClick={() => onAction('resume')}>
            Resume the move
          </button>
        )}
        {showUseBuiltin && (
          <button
            className={BUTTON_CLASS}
            onClick={() => onAction('use_builtin')}
          >
            Use the built-in store only
          </button>
        )}
        {showMove && (
          <button
            className={BUTTON_CLASS}
            onClick={() => onAction('move_to_builtin')}
          >
            Move to the built-in store
          </button>
        )}
        {mode === 'unknown' && (
          <button className={BUTTON_CLASS} onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
