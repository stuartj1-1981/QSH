import { useState, useEffect, useMemo, useRef } from 'react'
import { Save, Loader2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { useStatus } from '../../hooks/useStatus'
import { apiUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { MAX_HEAT_SOURCES } from '../../lib/constants'
import {
  mqttSensorPlaceholder,
  mqttControlPlaceholder,
} from '../../lib/mqtt-placeholders'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import { TopicPicker } from '../wizard/TopicPicker'
import { extractTopic, extractFormat, extractJsonPath } from '../../lib/mqttTopic'
import { HelpTip } from '../HelpTip'
import { HEAT_SOURCE, SOURCE_SELECTION } from '../../lib/helpText'
import {
  ABSOLUTE_FLOW_CAPABILITY,
  effectiveCapability,
  resolvedCapabilityInverts,
} from '../../lib/heatSourceCapability'
import type { HeatSourceYaml, MqttTopicInput, SourceSelectionYaml, QshConfigYaml, MqttConfig, Driver } from '../../types/config'
import type { ControlSource } from '../../types/api'
import { SourceSelectionSettings } from './SourceSelectionSettings'
import { ControlValueDisplay } from './ControlValueDisplay'
import { WriteBudgetField } from './WriteBudgetField'
import { isHeatPumpType } from '../../lib/heat-source-types'

// INSTRUCTION-385B — verbatim mirror of the backend efficiency_plausible
// (385A, config.py). Keyed on explicit type sets (NOT isHeatPumpType, which is
// UI-treatment sugar) so the panel badge and this Settings hint never disagree:
// HP-family COP must exceed 1.0; a known combustion boiler is 0 < eff < 1.0; an
// unknown type is not judged. If a future type is added it must be added to the
// backend map AND these two sets.
const HEAT_PUMP_TYPES = ['heat_pump', 'gshp']
const BOILER_TYPES = ['gas_boiler', 'oil_boiler', 'lpg_boiler']
function efficiencyImplausible(type: string, v: number | undefined): boolean {
  if (v == null || Number.isNaN(v)) return false
  if (HEAT_PUMP_TYPES.includes(type)) return v <= 1.0            // COP must exceed 1
  if (BOILER_TYPES.includes(type)) return v <= 0 || v >= 1.0     // GCV combustion boiler
  return false                                                    // unknown type — not judged
}

interface HeatSourceSettingsProps {
  heatSource: HeatSourceYaml
  heatSources?: HeatSourceYaml[]
  sourceSelection?: SourceSelectionYaml
  rootConfig?: QshConfigYaml
  mqtt?: MqttConfig
  driver: Driver
  onRefetch: () => void
}

// BEIS conversion factors — used as type-aware carbon-factor placeholders.
// V2 G-N3: these are NEVER written to state on render; they only populate
// the input's `placeholder` attribute so a clean install boots the editor
// without forcing a value the user didn't choose.
const CARBON_FACTOR_DEFAULTS: Record<string, number> = {
  gas_boiler: 0.183,
  lpg_boiler: 0.214,
  oil_boiler: 0.247,
}

function carbonFactorPlaceholder(type: string | undefined): string {
  if (!type) return ''
  return CARBON_FACTOR_DEFAULTS[type]?.toString() ?? ''
}

/** Narrowing helper: HA sensor slots store string entity IDs; MQTT sensor
 * slots store `{topic, format, ...}` objects (INSTRUCTION-241B). The HA
 * branch uses EntityField which only knows about entity_id strings; the
 * MQTT branch uses TopicField which only knows topic strings. This helper
 * returns the string form for either case: entity_id for HA inputs,
 * topic for MQTT inputs. */
function sensorEntity(v: string | { topic?: string } | undefined): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof v.topic === 'string') return v.topic
  return ''
}

/**
 * INSTRUCTION-308: stamp `flow_control.method="mqtt"` on NON-PRIMARY MQTT
 * sources at the emit point. The MQTT editor renders "Flow Control Method" as a
 * static "MQTT" label and never persisted the method, but
 * `resolve_source_routing` keys per-source dispatch on exactly that method — so
 * a non-primary source with per-source topics but no method is SUPPRESSED.
 *
 * Scoped strictly to non-primary sources to preserve INSTRUCTION-279's
 * primary-shared invariant. "Primary" is the single §1.7 contract: the source
 * at index 0 of the OUTGOING payload, identified by name (the same rule
 * `resolve_source_routing` uses for `is_primary`). Computing `primaryName` from
 * the outgoing payload (not an as-loaded cache) makes this robust to in-session
 * add/remove that promotes a new source to primary; a stale `method="mqtt"`
 * left on a source so promoted is stripped here. Caller gates on `driver`.
 */
function stampMqttFlowMethod(sources: HeatSourceYaml[]): HeatSourceYaml[] {
  const primaryName = sources[0]?.name
  return sources.map((s) => {
    if (s.name === primaryName) {
      // Primary always dispatches via the shared top-level topic (279). Strip
      // any stale method left over from when this source was non-primary.
      if (s.flow_control?.method === 'mqtt') {
        const { method: _drop, ...rest } = s.flow_control
        void _drop
        return { ...s, flow_control: rest }
      }
      return s
    }
    return { ...s, flow_control: { ...s.flow_control, method: 'mqtt' as const } }
  })
}

function computeInitial(
  heatSource: HeatSourceYaml,
  heatSources: HeatSourceYaml[] | undefined,
): HeatSourceYaml[] {
  if (heatSources && heatSources.length > 0) return heatSources
  return [heatSource]
}

export function HeatSourceSettings({
  heatSource,
  heatSources,
  sourceSelection,
  rootConfig,
  mqtt,
  driver,
  onRefetch,
}: HeatSourceSettingsProps) {
  // INSTRUCTION-236: `mqtt` prop is retained on the interface so the parent's
  // contract is unchanged, but HeatSourceSettings is non-authoritative for
  // any mqtt.inputs.* DHW field. HotWaterSettings is the sole edit surface
  // and the sole PATCH-write surface for hot_water_active / hot_water_boolean.
  void mqtt

  // INSTRUCTION-438 D8 (36C Task 4) — resolved-control provenance from
  // /api/status; [] / undefined when the driver offers no resolution, in
  // which case ControlValueDisplay renders its internal-only state exactly
  // as before the bridge landed.
  const { data: statusData } = useStatus()
  const controlSources = statusData?.control_sources

  const [sources, setSources] = useState<HeatSourceYaml[]>(() =>
    computeInitial(heatSource, heatSources),
  )
  const [expandedIndex, setExpandedIndex] = useState<number>(0)
  // V5 N-V5-1: declared at top level per React Rules of Hooks. Set by
  // handleRemove's empty-payload guard (V5 D-V4-1) and cleared on
  // successful persist (V5 N-V5-2) or by user dismissal.
  const [removeError, setRemoveError] = useState<string | null>(null)
  // INSTRUCTION-241C Task 6 — captures backend detail prose on PATCH failure
  // (e.g. the duplicate-topic 400 from §D-6). usePatchConfig.patch returns
  // null on error and discards the response body; this state lets the call
  // site below recapture it via a direct fetch without refactoring the hook.
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)

  // Per-card dirty tracking. A card is dirty when its current state in
  // `sources[i]` differs from the last-saved snapshot at `lastSavedRef.current[i]`.
  //
  // Kept as useRef rather than useState so the structural-equality
  // resync useEffect below can keep [heatSource, heatSources] as its only
  // deps — if lastSaved were state, including it in deps would cause the
  // effect to re-run after each persist() and could re-introduce the
  // V1 D-3 stomp-on-prop-refresh hazard via a different door.
  //
  // Because ref mutation does NOT trigger a re-render, a sibling `tick`
  // state is bumped after every mutation to force the render that re-
  // computes isDirty / isNew. The tick value is unused in the render —
  // it exists only to signal React that derived UI must re-evaluate.
  const lastSavedRef = useRef<HeatSourceYaml[]>(
    computeInitial(heatSource, heatSources),
  )
  const [tick, setTick] = useState<number>(0)
  void tick
  const forceUpdate = () => setTick((t) => t + 1)

  // V1 D-3 fix: structural-equality resync. Only reset local state from
  // props when the incoming props REPRESENT a different config than what
  // we have locally — never on a reference change with identical content.
  // This prevents a parent refetch from stomping a user's in-flight edits.
  useEffect(() => {
    const incoming = computeInitial(heatSource, heatSources)
    if (JSON.stringify(incoming) !== JSON.stringify(lastSavedRef.current)) {
      setSources(incoming)
      lastSavedRef.current = incoming
      forceUpdate()
    }
  }, [heatSource, heatSources])

  const isDirty = (i: number): boolean =>
    JSON.stringify(sources[i]) !== JSON.stringify(lastSavedRef.current[i])

  // V3 G-V3-1: a card is "new" iff its index sits past the end of the
  // last-saved snapshot. After a successful Save the snapshot is updated
  // and isNew flips to false automatically.
  const isNew = (i: number): boolean => i >= lastSavedRef.current.length

  const handleChange = (i: number) => (changes: Partial<HeatSourceYaml>) => {
    setSources((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...changes } : s)),
    )
  }

  const handleSensorChange = (i: number) => (key: string, value: string) => {
    setSources((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s
        const nextSensors = { ...(s.sensors ?? {}), [key]: value || undefined }
        return { ...s, sensors: nextSensors }
      }),
    )
  }

  // V2 D-N1 decision: Add is local-state-only. NO patch fires here. A
  // half-baked source persisted by an accidental Add-then-close-browser
  // can trip _validate_heat_source on next boot. The user must explicitly
  // Save the new card.
  const handleAdd = () => {
    if (sources.length >= MAX_HEAT_SOURCES) return
    const next = [
      ...sources,
      {
        type: 'heat_pump',
        name: `Source ${sources.length + 1}`,
      } as HeatSourceYaml,
    ]
    setSources(next)
    setExpandedIndex(next.length - 1)
  }

  const { patch, saving } = usePatchConfig()
  void saving

  // V3 D-V3-1: persist returns boolean ok/notok so handleRemove can roll
  // back local state on failure. usePatchConfig.patch returns null on
  // error, non-null object on success — we collapse to boolean here.
  // INSTRUCTION-241C Task 6: on failure, a sibling fetch against the same
  // endpoint captures the response detail body the backend emits on
  // duplicate-topic guard rejection (§D-6). The hook's patch() discards
  // the body on error; refactoring it touches every caller — out of scope
  // per Task 6 V2 closing note. Cost is one extra HTTP call per FAILED
  // save (acceptable; success path unchanged).
  const persist = async (next: HeatSourceYaml[]): Promise<boolean> => {
    // INSTRUCTION-236: strip DHW keys before save (HotWaterSettings is the
    // sole DHW editor; preserve T-236 invariants). Only sanitise when
    // sensors is present — otherwise we'd materialise an empty sensors
    // object that desyncs the dirty/lastSaved comparison after save.
    const sanitised = next.map((s) => {
      if (!s.sensors) return s
      const {
        water_heater: _omit_wh,
        hot_water_boolean: _omit_hwb,
        ...rest
      } = s.sensors
      void _omit_wh
      void _omit_hwb
      return { ...s, sensors: rest }
    })

    // INSTRUCTION-308: stamp method="mqtt" on non-primary MQTT sources (and
    // strip a stale stamp from the primary) at this single emit choke point —
    // the one site used by both Save and handleRemove, where the outgoing
    // order is final. Applied to `stamped` so BOTH the authoritative write
    // below AND the INSTRUCTION-241C failure-detail re-send carry it. The
    // last-saved snapshot stays as the UNSTAMPED `sanitised` so it matches the
    // (unstamped) local `sources` — dirty tracking is correct immediately, and
    // the post-save refetch resync pulls the backend's stamped config in.
    const stamped =
      driver === 'mqtt' ? stampMqttFlowMethod(sanitised) : sanitised

    // Server-authoritative reconciliation per INSTRUCTION-237A:
    //   length 1  → backend mirrors to singular heat_source
    //   length>=2 → backend strips stale singular
    // The frontend writes ONLY heat_sources. No dual-PATCH atomicity hazard.
    const result = await patch('heat_sources', stamped)
    if (result !== null) {
      setSaveError(null)
      lastSavedRef.current = sanitised
      // The ref mutation alone won't re-render; bump the tick so the
      // dirty/new badges re-compute after the snapshot updates.
      forceUpdate()
      // V5 N-V5-2: clear the "cannot remove" banner if it was set —
      // saving a new card may have unblocked a pending Remove.
      setRemoveError(null)
      onRefetch()
      return true
    }

    // INSTRUCTION-241C Task 6 — failure path: sibling fetch to capture the
    // backend's detail prose (e.g. duplicate-topic 400 from §D-6). Mirrors
    // the wrapped-body shape that usePatchConfig.patch sends so the second
    // request reproduces the first's failure deterministically.
    try {
      const resp = await fetch(apiUrl('api/config/heat_sources'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: stamped }),
      })
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`
        try {
          const body = await resp.json()
          if (typeof body?.detail === 'string') {
            detail = body.detail
          }
        } catch {
          // body not JSON; keep the HTTP status fallback.
        }
        setSaveError(detail)
      } else {
        // Race window — the second fetch succeeded where the first reported
        // failure. Treat as transient and clear the error.
        setSaveError(null)
      }
    } catch (e) {
      setSaveError(
        `Save failed — network error: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
    return false
  }

  const handleRemove = async (i: number) => {
    if (sources.length <= 1) return
    const prevSources = sources
    const next = sources.filter((_, idx) => idx !== i)

    // V3 D-V3-2: drop new-unsaved cards from the PATCH payload. Those
    // cards remain in local state with their `(new — unsaved)` badge
    // intact and are only persisted when the user explicitly Saves them.
    const persistPayload = next.filter((_, j) => {
      const origIndex = j < i ? j : j + 1
      const wasNew = origIndex >= lastSavedRef.current.length
      const wasDirty =
        JSON.stringify(prevSources[origIndex]) !==
        JSON.stringify(lastSavedRef.current[origIndex])
      return !(wasNew && wasDirty)
    })

    // V5 D-V4-1: empty-payload guard. The backend PATCH guard rejects
    // empty heat_sources lists with a 400; surface that locally with a
    // user-actionable message before reaching the network.
    if (persistPayload.length === 0) {
      setRemoveError(
        'Cannot remove this source until the new (unsaved) sources are ' +
          'either saved or removed. Save your new source first, or click ' +
          'Remove on it.',
      )
      return
    }
    setRemoveError(null)

    // Optimistic local removal — reverted in the failure branch below.
    setSources(next)
    if (expandedIndex >= next.length) {
      setExpandedIndex(Math.max(0, next.length - 1))
    }

    // V5 G-V4-1: wrap in try/catch so an exception from patch is treated
    // identically to a null/false return. Without this, an unhandled
    // promise rejection bypasses the rollback and re-introduces the V3
    // D-V3-1 desync via a different door.
    let ok = false
    try {
      ok = await persist(persistPayload)
    } catch {
      ok = false
    }
    if (!ok) {
      // V3 D-V3-1: rollback so the user can retry without lengths going
      // out of sync.
      setSources(prevSources)
      if (expandedIndex >= prevSources.length) {
        setExpandedIndex(Math.max(0, prevSources.length - 1))
      }
    }
  }

  const handleSaveCard = async (i: number) => {
    setSavingIndex(i)
    try {
      // Per-card Save writes the FULL current array — picks up neighbours'
      // unsaved edits too. The `(unsaved)` indicator on other dirty cards
      // disappears on success.
      await persist(sources)
    } finally {
      setSavingIndex(null)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[var(--text)]">Heat Sources</h2>

      {/* INSTRUCTION-241C Task 6 — combined error banner. saveError carries
          the backend detail prose verbatim (e.g. duplicate-topic 400 with
          conflicting source/slot pair named); removeError carries the
          pending-unsaved-source guidance. Either dismisses the other. */}
      {(saveError || removeError) && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 text-sm text-[var(--text)]"
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{saveError || removeError}</span>
            <button
              type="button"
              onClick={() => {
                setSaveError(null)
                setRemoveError(null)
              }}
              aria-label="Dismiss error"
              className="text-[var(--text-muted)] hover:text-[var(--text)] shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {sources.map((source, i) => (
          <SourceCard
            key={i}
            source={source}
            sources={sources}
            index={i}
            isNew={isNew(i)}
            removable={sources.length > 1}
            expanded={expandedIndex === i}
            dirty={isDirty(i)}
            saving={savingIndex === i}
            driver={driver}
            rootConfig={rootConfig}
            controlSources={controlSources}
            onToggle={() =>
              setExpandedIndex(expandedIndex === i ? -1 : i)
            }
            onChange={handleChange(i)}
            onSensorChange={handleSensorChange(i)}
            onRemove={() => handleRemove(i)}
            onSave={() => handleSaveCard(i)}
            onRefetch={onRefetch}
          />
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={sources.length >= MAX_HEAT_SOURCES}
          aria-label="Add heat source"
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
            sources.length >= MAX_HEAT_SOURCES
              ? 'border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed'
              : 'border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/5',
          )}
        >
          <Plus size={16} /> Add heat source
        </button>
        {sources.length >= MAX_HEAT_SOURCES && (
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Maximum {MAX_HEAT_SOURCES} sources.
          </p>
        )}
      </div>

      {/* Heat source write budget (216A/B) — system-wide, not per-source. */}
      <div className="space-y-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="text-sm font-medium text-[var(--text)]">
          Heat source write budget
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          Cap the rate at which QSH writes to the heat pump controller. Default 6/hour matches
          the existing 10-minute debounce. Lower this if your heat pump vendor enforces a
          flash-write budget (e.g. Daikin EDLA082 family).
        </div>
        <WriteBudgetField
          label="Flow writes per hour"
          fieldKey="flow_writes_per_hour"
          apiPath="api/control/flow-writes-per-hour"
          rootConfig={rootConfig}
          onSuccess={onRefetch}
        />
        <WriteBudgetField
          label="Mode writes per hour"
          fieldKey="mode_writes_per_hour"
          apiPath="api/control/mode-writes-per-hour"
          rootConfig={rootConfig}
          onSuccess={onRefetch}
        />
      </div>

      <p className="text-xs text-[var(--amber)]">
        Changing heat source type will trigger a pipeline restart.
      </p>

      {/* Source Selection Settings (228B Task 2: the component renders an
          explainer note when fewer than two sources are configured). */}
      <SourceSelectionSettings
        config={sourceSelection}
        sourceNames={sources.map((s, i) => s.name ?? `Source ${i + 1}`)}
        onRefetch={onRefetch}
      />
    </div>
  )
}

interface SourceCardProps {
  source: HeatSourceYaml
  // INSTRUCTION-241C Task 2 — full sources array for placeholder collision
  // detection. The card derives MQTT topic placeholders from source.type plus
  // a name-derived disambiguation suffix when types collide (parent §D-5).
  sources: HeatSourceYaml[]
  index: number
  isNew: boolean
  removable: boolean
  expanded: boolean
  dirty: boolean
  saving: boolean
  driver: Driver
  rootConfig?: QshConfigYaml
  // INSTRUCTION-438 D8 — resolved-control provenance for the flow_min /
  // flow_max ControlValueDisplay sites (undefined pre-fetch or without an
  // MQTT resolution path).
  controlSources?: ControlSource[]
  onToggle: () => void
  onChange: (changes: Partial<HeatSourceYaml>) => void
  onSensorChange: (key: string, value: string) => void
  onRemove: () => void
  onSave: () => void
  onRefetch: () => void
}

function SourceCard({
  source: hs,
  sources,
  index,
  isNew,
  removable,
  expanded,
  dirty,
  saving,
  driver,
  rootConfig,
  controlSources,
  onToggle,
  onChange,
  onSensorChange,
  onRemove,
  onSave,
  onRefetch,
}: SourceCardProps) {
  const [showSensors, setShowSensors] = useState(false)
  const [showFlowControl, setShowFlowControl] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  // INSTRUCTION-339C — per-source command-to-fire response timeout (dead-time
  // gate). Resolved default mirrors the backend capability table (339B Task 1):
  // HP/GSHP 180 s, boilers 300 s. Validity band [30, 900] s mirrors the
  // backend config-load + PATCH guard so the UI flags it before a restart.
  const RESPONSE_TIMEOUT_MIN = 30
  const RESPONSE_TIMEOUT_MAX = 900
  const responseTimeoutDefault =
    hs.type === 'heat_pump' || hs.type === 'gshp' ? 180 : 300
  const responseTimeoutError =
    hs.response_timeout_s !== undefined &&
    (hs.response_timeout_s < RESPONSE_TIMEOUT_MIN ||
      hs.response_timeout_s > RESPONSE_TIMEOUT_MAX)

  // INSTRUCTION-412 — per-source appliance flow CAPABILITY assertion. Both axes
  // optional; the effective envelope is asserted-else-registry (mirror of the
  // backend resolution). ALL validation below derives from the card's CURRENT
  // (dirty) form state (L6), so the one-visit "assert capability + widen the
  // operating value" flow never flags input the backend will accept. The backend
  // 422 is authoritative and renders verbatim in the saveError banner; these
  // client checks only pre-empt the round-trip.
  const [ABS_CAP_LO, ABS_CAP_HI] = ABSOLUTE_FLOW_CAPABILITY
  const capMinOutOfBand =
    hs.capability_flow_min !== undefined &&
    (hs.capability_flow_min < ABS_CAP_LO || hs.capability_flow_min > ABS_CAP_HI)
  const capMaxOutOfBand =
    hs.capability_flow_max !== undefined &&
    (hs.capability_flow_max < ABS_CAP_LO || hs.capability_flow_max > ABS_CAP_HI)
  // Resolved-pair coherence (R1): surface only when neither axis is individually
  // out of band (an out-of-band axis is flagged by its own error, not double-flagged).
  const capIncoherent =
    !capMinOutOfBand &&
    !capMaxOutOfBand &&
    (hs.capability_flow_min !== undefined || hs.capability_flow_max !== undefined) &&
    resolvedCapabilityInverts(hs.type, hs.capability_flow_min, hs.capability_flow_max)
  const capMinError = capMinOutOfBand
  const capMaxError = capMaxOutOfBand || capIncoherent
  // Effective envelope the operating flow_min/flow_max must sit inside (L6 — from
  // the card's current capability form state).
  const [effCapLo, effCapHi] = effectiveCapability(
    hs.type,
    hs.capability_flow_min,
    hs.capability_flow_max,
  )
  const flowMinOutOfCap =
    hs.flow_min !== undefined && (hs.flow_min < effCapLo || hs.flow_min > effCapHi)
  const flowMaxOutOfCap =
    hs.flow_max !== undefined && (hs.flow_max < effCapLo || hs.flow_max > effCapHi)
  // Strict inversion, mirroring the backend M2 rule (flow_min == flow_max is legal).
  const flowPairInverted =
    hs.flow_min !== undefined &&
    hs.flow_max !== undefined &&
    hs.flow_min > hs.flow_max

  const entityIds = useMemo(() => {
    if (driver === 'mqtt') {
      return [
        hs.flow_min_entity,
        hs.flow_max_entity,
        hs.flow_control?.entity_id,
        hs.flow_control?.flow_entity,
        hs.flow_control?.mode_entity,
        hs.on_off_control?.entity_id,
      ].filter(Boolean) as string[]
    }
    return [
      hs.flow_min_entity,
      hs.flow_max_entity,
      hs.flow_control?.entity_id,
      hs.flow_control?.flow_entity,
      hs.flow_control?.mode_entity,
      hs.on_off_control?.entity_id,
      hs.sensors?.flow_temp,
      hs.sensors?.power_input,
      hs.sensors?.cop,
      hs.sensors?.heat_output,
      hs.sensors?.total_energy,
      hs.sensors?.return_temp,
      hs.sensors?.flow_rate,
      hs.sensors?.delta_t,
      hs.sensors?.pump_power,
      hs.sensors?.cooling_active,
      extractTopic(hs.fuel_cost_entity),
      extractTopic(hs.carbon_factor_entity),
    ].filter(Boolean) as string[]
  }, [hs, driver])
  const { resolved } = useEntityResolve(entityIds, driver)

  const method = hs.flow_control?.method || 'ha_service'
  const isNonHp = !isHeatPumpType(hs.type)

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Card header — always visible */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg)]">
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            expanded
              ? `Collapse source ${index + 1}`
              : `Expand source ${index + 1}`
          }
          className="text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <input
          type="text"
          value={hs.name ?? ''}
          placeholder={`Source ${index + 1}`}
          onChange={(e) => onChange({ name: e.target.value || undefined })}
          aria-label={`Source ${index + 1} name`}
          className="font-medium bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)] rounded px-1 text-[var(--text)] flex-1 min-w-0"
        />
        <span className="text-xs text-[var(--text-muted)] shrink-0">
          {(hs.type ?? '').replace(/_/g, ' ')}
        </span>
        {isNew && (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-[var(--accent)] shrink-0">
            (new — unsaved)
          </span>
        )}
        {dirty && !isNew && (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-[var(--amber)] shrink-0">
            (unsaved)
          </span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          aria-label={`Save source ${index + 1}`}
          title="Save — persists changes on all cards"
          className={cn(
            'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0',
            !dirty || saving
              ? 'bg-[var(--bg-card)] text-[var(--text-muted)] cursor-not-allowed'
              : 'bg-[var(--accent)] text-white hover:opacity-90',
          )}
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Save size={12} />
          )}
          Save
        </button>
        <button
          type="button"
          onClick={() => setConfirmingRemove(true)}
          disabled={!removable}
          aria-label={`Remove source ${index + 1}`}
          className={cn(
            'p-1.5 rounded transition-colors shrink-0',
            removable
              ? 'text-[var(--text-muted)] hover:text-[var(--red)]'
              : 'text-[var(--text-muted)]/40 cursor-not-allowed',
          )}
        >
          <X size={14} />
        </button>
      </div>

      {/* Remove confirmation */}
      {confirmingRemove && (
        <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--red)]/5">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text)] flex-1">
              Remove this heat source? This cannot be undone.
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirmingRemove(false)
                onRemove()
              }}
              className="px-3 py-1 rounded text-xs bg-[var(--red)] text-white hover:opacity-90"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="px-3 py-1 rounded text-xs border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Card body — only rendered when expanded */}
      {expanded && (
        <div className="px-4 py-4 space-y-6">
          {/* Type */}
          <div>
            <label className="flex items-center gap-1 text-sm font-medium text-[var(--text)] mb-2">
              Type <HelpTip text={HEAT_SOURCE.hpModel} size={12} />
            </label>
            <div className="flex gap-2 flex-wrap">
              {(['heat_pump', 'gshp', 'gas_boiler', 'lpg_boiler', 'oil_boiler'] as const).map(
                (t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onChange({ type: t })}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                      hs.type === t
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50',
                    )}
                  >
                    {t.replace(/_/g, ' ')}
                  </button>
                ),
              )}
            </div>
          </div>

          <div
            className={cn(
              'grid gap-4',
              driver === 'mqtt' ? 'grid-cols-2' : 'grid-cols-3',
            )}
          >
            <div>
              <label
                htmlFor={`source-${index}-efficiency`}
                className="block text-xs font-medium text-[var(--text)] mb-1"
              >
                {isHeatPumpType(hs.type) ? 'COP' : 'Efficiency'}
              </label>
              <input
                id={`source-${index}-efficiency`}
                type="number"
                step="0.1"
                value={hs.efficiency ?? ''}
                onChange={(e) =>
                  onChange({
                    efficiency: parseFloat(e.target.value) || undefined,
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
              {/* INSTRUCTION-385B — advisory implausible-value hint at the
                  correction point (the owner-chosen "you set it" path). Does
                  not block saving. */}
              {efficiencyImplausible(hs.type, hs.efficiency) && (
                <p className="mt-1 text-xs text-[var(--amber)]">
                  Implausible for a {isHeatPumpType(hs.type) ? 'COP' : 'combustion efficiency'} — set the real value
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor={`source-${index}-min-output`}
                className="block text-xs font-medium text-[var(--text)] mb-1"
              >
                Min Output (kW)
              </label>
              <input
                id={`source-${index}-min-output`}
                type="number"
                step="0.5"
                value={hs.min_output_kw ?? ''}
                onChange={(e) =>
                  onChange({
                    min_output_kw: parseFloat(e.target.value) || undefined,
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
            {driver === 'mqtt' ? (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Flow Control Method
                </label>
                <p className="px-2 py-1.5 text-sm text-[var(--text-muted)]">MQTT</p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor={`source-${index}-method`}
                  className="block text-xs font-medium text-[var(--text)] mb-1"
                >
                  Flow Control Method
                </label>
                <select
                  id={`source-${index}-method`}
                  value={method}
                  onChange={(e) =>
                    onChange({
                      flow_control: {
                        ...hs.flow_control,
                        method: e.target.value as 'ha_service' | 'mqtt' | 'entity',
                      },
                    })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                >
                  <option value="ha_service">HA Service</option>
                  <option value="mqtt">MQTT</option>
                  <option value="entity">Entity</option>
                </select>
              </div>
            )}
          </div>

          {/* Capacity */}
          <div>
            <label
              htmlFor={`source-${index}-capacity`}
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Rated capacity (kW)
            </label>
            <input
              id={`source-${index}-capacity`}
              type="number"
              min={1}
              max={100}
              step={0.1}
              value={hs.capacity_kw ?? ''}
              placeholder="e.g. 6.0"
              onChange={(e) =>
                onChange({
                  capacity_kw:
                    e.target.value === '' ? undefined : parseFloat(e.target.value),
                })
              }
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>

          {/* Response timeout (dead-time gate) — INSTRUCTION-339C */}
          <div>
            <label
              htmlFor={`source-${index}-response-timeout`}
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Source response timeout (s)
            </label>
            <input
              id={`source-${index}-response-timeout`}
              type="number"
              min={RESPONSE_TIMEOUT_MIN}
              max={RESPONSE_TIMEOUT_MAX}
              step={10}
              value={hs.response_timeout_s ?? ''}
              placeholder={`default ${responseTimeoutDefault}`}
              aria-invalid={responseTimeoutError}
              onChange={(e) =>
                onChange({
                  response_timeout_s:
                    e.target.value === ''
                      ? undefined
                      : parseFloat(e.target.value),
                })
              }
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            {responseTimeoutError ? (
              <p className="mt-1 text-xs text-red-500">
                Must be between {RESPONSE_TIMEOUT_MIN} and {RESPONSE_TIMEOUT_MAX}{' '}
                seconds.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Command-to-fire window before a no-response alarm. Unset uses{' '}
                {responseTimeoutDefault} s.
              </p>
            )}
          </div>

          {/* Appliance flow capability — INSTRUCTION-412 (D6). Renders on EVERY
              source card (all install shapes, D5): capability is equipment data.
              Per-axis optional; a blank axis uses the type default. Bounded to the
              absolute guard band [20, 90] and coherence-checked as a resolved pair,
              client-side from dirty state (L6). The backend 422 is authoritative. */}
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
              Appliance flow capability (°C){' '}
              <HelpTip text={HEAT_SOURCE.capabilityMax} size={12} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <input
                  id={`source-${index}-capability-flow-min`}
                  type="number"
                  min={ABS_CAP_LO}
                  max={ABS_CAP_HI}
                  step={1}
                  value={hs.capability_flow_min ?? ''}
                  placeholder={`min (default ${effCapLo})`}
                  aria-label="Appliance flow capability minimum (°C)"
                  aria-invalid={capMinError}
                  onChange={(e) =>
                    onChange({
                      capability_flow_min:
                        e.target.value === ''
                          ? undefined
                          : parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <input
                  id={`source-${index}-capability-flow-max`}
                  type="number"
                  min={ABS_CAP_LO}
                  max={ABS_CAP_HI}
                  step={1}
                  value={hs.capability_flow_max ?? ''}
                  placeholder={`max (default ${effCapHi})`}
                  aria-label="Appliance flow capability maximum (°C)"
                  aria-invalid={capMaxError}
                  onChange={(e) =>
                    onChange({
                      capability_flow_max:
                        e.target.value === ''
                          ? undefined
                          : parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>
            {capMinOutOfBand || capMaxOutOfBand ? (
              <p className="mt-1 text-xs text-red-500">
                Capability must be between {ABS_CAP_LO} and {ABS_CAP_HI} °C.
              </p>
            ) : capIncoherent ? (
              <p className="mt-1 text-xs text-red-500">
                Minimum capability must be below maximum (effective {effCapLo}–
                {effCapHi} °C uses the type default for a blank axis).
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Your appliance's rated flow range. Blank axes use the type default
                ({effCapLo}–{effCapHi} °C). Operating limits below must sit inside this.
              </p>
            )}
          </div>

          {/* Flow temp range — INSTRUCTION-377B (D-377-3): the per-source
              operating Min/Max pair renders ONLY for multi-source installs.
              A single-source install shows exactly the index-0 operating-
              setpoint pair below (Flow Min/Max Temperature). Bounded to the
              effective capability above (INSTRUCTION-412 D6/L6). */}
          {sources.length > 1 && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor={`source-${index}-flow-min`}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1"
                >
                  Flow Min (°C) <HelpTip text={HEAT_SOURCE.minFlowTemp} size={12} />
                </label>
                <input
                  id={`source-${index}-flow-min`}
                  type="number"
                  value={hs.flow_min ?? ''}
                  aria-invalid={flowMinOutOfCap || flowPairInverted}
                  onChange={(e) =>
                    onChange({
                      flow_min:
                        e.target.value === ''
                          ? undefined
                          : parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label
                  htmlFor={`source-${index}-flow-max`}
                  className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1"
                >
                  Flow Max (°C) <HelpTip text={HEAT_SOURCE.maxFlowTemp} size={12} />
                </label>
                <input
                  id={`source-${index}-flow-max`}
                  type="number"
                  value={hs.flow_max ?? ''}
                  aria-invalid={flowMaxOutOfCap || flowPairInverted}
                  onChange={(e) =>
                    onChange({
                      flow_max:
                        e.target.value === ''
                          ? undefined
                          : parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              {(flowMinOutOfCap || flowMaxOutOfCap || flowPairInverted) && (
                <p className="col-span-2 mt-1 text-xs text-red-500">
                  {flowPairInverted
                    ? 'Flow Min must not exceed Flow Max.'
                    : `Flow limits must sit inside the appliance capability ${effCapLo}–${effCapHi} °C. Widen the capability above, or bring these inside it.`}
                </p>
              )}
            </div>
          )}

          {/* Flow min/max entity override or internal value editor — only for
              the first source where the system-wide setpoint lives in
              rootConfig. Multi-source per-card flow-min/max overrides via
              control PATCH are intentionally not supported in this version. */}
          {index === 0 && (
            <div className="grid grid-cols-2 gap-4">
              {driver === 'mqtt' ? (
                <>
                  <ControlValueDisplay
                    label="Flow Min Temperature"
                    controlSource={controlSources?.find((cs) => cs.key === 'flow_min')}
                    internalValue={
                      rootConfig?.flow_min_internal ?? hs.flow_min ?? 25
                    }
                    onInternalChange={(v) => {
                      if (typeof v === 'number') {
                        fetch(apiUrl('api/control/flow-min'), {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ value: v }),
                        }).then(() => onRefetch())
                      }
                    }}
                    unit="°C"
                    min={20}
                    max={45}
                    step={0.5}
                  />
                  <ControlValueDisplay
                    label="Flow Max Temperature"
                    controlSource={controlSources?.find((cs) => cs.key === 'flow_max')}
                    internalValue={
                      rootConfig?.flow_max_internal ?? hs.flow_max ?? 50
                    }
                    onInternalChange={(v) => {
                      if (typeof v === 'number') {
                        fetch(apiUrl('api/control/flow-max'), {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ value: v }),
                        }).then(() => onRefetch())
                      }
                    }}
                    unit="°C"
                    min={30}
                    max={60}
                    step={0.5}
                  />
                </>
              ) : (
                <>
                  {hs.flow_min_entity ? (
                    <EntityField
                      label="Flow Min Entity"
                      value={hs.flow_min_entity}
                      friendlyName={resolved[hs.flow_min_entity]?.friendly_name}
                      state={resolved[hs.flow_min_entity]?.state}
                      unit={resolved[hs.flow_min_entity]?.unit}
                      onChange={(v) =>
                        onChange({ flow_min_entity: v || undefined })
                      }
                      placeholder="input_number.flow_min"
                    />
                  ) : (
                    <ControlValueDisplay
                      label="Flow Min Temperature"
                      controlSource={controlSources?.find((cs) => cs.key === 'flow_min')}
                      internalValue={
                        rootConfig?.flow_min_internal ?? hs.flow_min ?? 25
                      }
                      onInternalChange={(v) => {
                        if (typeof v === 'number') {
                          fetch(apiUrl('api/control/flow-min'), {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ value: v }),
                          }).then(() => onRefetch())
                        }
                      }}
                      unit="°C"
                      min={20}
                      max={45}
                      step={0.5}
                    />
                  )}
                  {hs.flow_max_entity ? (
                    <EntityField
                      label="Flow Max Entity"
                      value={hs.flow_max_entity}
                      friendlyName={resolved[hs.flow_max_entity]?.friendly_name}
                      state={resolved[hs.flow_max_entity]?.state}
                      unit={resolved[hs.flow_max_entity]?.unit}
                      onChange={(v) =>
                        onChange({ flow_max_entity: v || undefined })
                      }
                      placeholder="input_number.flow_max"
                    />
                  ) : (
                    <ControlValueDisplay
                      label="Flow Max Temperature"
                      controlSource={controlSources?.find((cs) => cs.key === 'flow_max')}
                      internalValue={
                        rootConfig?.flow_max_internal ?? hs.flow_max ?? 50
                      }
                      onInternalChange={(v) => {
                        if (typeof v === 'number') {
                          fetch(apiUrl('api/control/flow-max'), {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ value: v }),
                          }).then(() => onRefetch())
                        }
                      }}
                      unit="°C"
                      min={30}
                      max={60}
                      step={0.5}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* Fuel cost — all source types (INSTRUCTION-354B). For a heat
              pump the value is the electricity import rate; QSH divides by
              live COP to compare against other sources (354 decision 1). */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={`source-${index}-fuel-cost`}
                className="block text-xs font-medium text-[var(--text)] mb-1"
              >
                Fuel cost (£/kWh)
              </label>
              <input
                id={`source-${index}-fuel-cost`}
                type="number"
                step="0.001"
                value={hs.fuel_cost_per_kwh ?? ''}
                placeholder={isNonHp ? '0.060' : '0.245'}
                onChange={(e) =>
                  onChange({
                    fuel_cost_per_kwh:
                      e.target.value === ''
                        ? undefined
                        : parseFloat(e.target.value),
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
            {driver === 'mqtt' ? (
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1">
                  Fuel cost topic
                  <HelpTip text={SOURCE_SELECTION.fuelCostEntity} size={12} />
                </label>
                <TopicPicker
                  value={extractTopic(hs.fuel_cost_entity)}
                  format={extractFormat(hs.fuel_cost_entity)}
                  jsonPath={extractJsonPath(hs.fuel_cost_entity)}
                  onChange={(topic, fmt, jp) => {
                    if (!topic) {
                      onChange({ fuel_cost_entity: undefined })
                      return
                    }
                    const entry: MqttTopicInput = {
                      topic,
                      format: (fmt ?? 'plain') as 'plain' | 'json',
                    }
                    if (jp) entry.json_path = jp
                    onChange({ fuel_cost_entity: entry })
                  }}
                  placeholder={
                    isNonHp ? 'qsh/sources/boiler/cost' : 'qsh/sources/heat_pump/cost'
                  }
                  scanResults={[]}
                />
              </div>
            ) : (
              <EntityField
                label="Fuel cost entity"
                helpText={SOURCE_SELECTION.fuelCostEntity}
                value={extractTopic(hs.fuel_cost_entity)}
                friendlyName={
                  resolved[extractTopic(hs.fuel_cost_entity)]?.friendly_name
                }
                state={resolved[extractTopic(hs.fuel_cost_entity)]?.state}
                unit={resolved[extractTopic(hs.fuel_cost_entity)]?.unit}
                onChange={(v) =>
                  onChange({ fuel_cost_entity: v || undefined })
                }
                placeholder={
                  isNonHp ? 'sensor.gas_unit_rate' : 'sensor.electricity_import_rate'
                }
              />
            )}
          </div>
          {!isNonHp && (
            <p className="text-xs text-[var(--text-muted)] -mt-2">
              Publish your import electricity rate (£/kWh). QSH divides by live
              COP to compare against other sources.
            </p>
          )}

          {/* Carbon factor — all source types (INSTRUCTION-354B). V2 G-N3:
              placeholder only, never written to state on render. The grid CO₂
              factor applies to electricity (heat-pump) sources too. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={`source-${index}-carbon-factor`}
                className="text-xs font-medium text-[var(--text)] mb-1 flex items-center gap-1"
              >
                Carbon factor (kgCO₂e/kWh){' '}
                <HelpTip text={SOURCE_SELECTION.carbonFactor} size={12} />
              </label>
              <input
                id={`source-${index}-carbon-factor`}
                type="number"
                step="0.001"
                value={hs.carbon_factor ?? ''}
                placeholder={carbonFactorPlaceholder(hs.type)}
                onChange={(e) =>
                  onChange({
                    carbon_factor:
                      e.target.value === ''
                        ? undefined
                        : parseFloat(e.target.value),
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
            {driver === 'mqtt' ? (
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1">
                  Carbon factor topic
                  <HelpTip text={SOURCE_SELECTION.carbonFactor} size={12} />
                </label>
                <TopicPicker
                  value={extractTopic(hs.carbon_factor_entity)}
                  format={extractFormat(hs.carbon_factor_entity)}
                  jsonPath={extractJsonPath(hs.carbon_factor_entity)}
                  onChange={(topic, fmt, jp) => {
                    if (!topic) {
                      onChange({ carbon_factor_entity: undefined })
                      return
                    }
                    const entry: MqttTopicInput = {
                      topic,
                      format: (fmt ?? 'plain') as 'plain' | 'json',
                    }
                    if (jp) entry.json_path = jp
                    onChange({ carbon_factor_entity: entry })
                  }}
                  placeholder="qsh/grid/co2_factor"
                  scanResults={[]}
                />
              </div>
            ) : (
              <EntityField
                label="Carbon factor entity"
                value={extractTopic(hs.carbon_factor_entity)}
                friendlyName={
                  resolved[extractTopic(hs.carbon_factor_entity)]?.friendly_name
                }
                state={resolved[extractTopic(hs.carbon_factor_entity)]?.state}
                unit={resolved[extractTopic(hs.carbon_factor_entity)]?.unit}
                onChange={(v) =>
                  onChange({ carbon_factor_entity: v || undefined })
                }
                placeholder="sensor.grid_carbon_intensity"
              />
            )}
          </div>

          {/* Pump control — non-HP sources only. V3 G-V3-2: max-speed
              placeholder only, never written to state on render. */}
          {isNonHp && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-[var(--text)]">
                Pump Control
              </label>
              <div className="flex gap-4">
                {(['ha_service', 'mqtt'] as const).map((m) => (
                  <label
                    key={m}
                    className="flex items-center gap-2 text-sm text-[var(--text)]"
                  >
                    <input
                      type="radio"
                      name={`pump_method_${index}`}
                      checked={hs.pump_control?.method === m}
                      onChange={() =>
                        onChange({
                          pump_control: {
                            ...(hs.pump_control ?? {}),
                            method: m,
                          },
                        })
                      }
                      className="accent-[var(--accent)]"
                    />
                    {m === 'ha_service' ? 'HA Service' : 'MQTT'}
                  </label>
                ))}
              </div>
              {hs.pump_control?.method === 'mqtt' && (
                <TopicField
                  label="Pump topic"
                  value={hs.pump_control?.topic ?? ''}
                  onChange={(v) =>
                    onChange({
                      pump_control: {
                        ...(hs.pump_control ?? {}),
                        topic: v || undefined,
                      },
                    })
                  }
                  placeholder="qsh/pump/speed/set"
                />
              )}
              {hs.pump_control?.method === 'ha_service' && (
                <EntityField
                  label="Pump entity"
                  value={hs.pump_control?.entity_id ?? ''}
                  onChange={(v) =>
                    onChange({
                      pump_control: {
                        ...(hs.pump_control ?? {}),
                        entity_id: v || undefined,
                      },
                    })
                  }
                  placeholder="fan.boiler_pump"
                />
              )}
              <div>
                <label
                  htmlFor={`source-${index}-pump-max-speed`}
                  className="text-xs font-medium text-[var(--text)] mb-1 flex items-center gap-1"
                >
                  Max pump speed (%){' '}
                  <HelpTip text={SOURCE_SELECTION.pumpMaxSpeed} size={12} />
                </label>
                <input
                  id={`source-${index}-pump-max-speed`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={hs.pump_control?.max_speed_pct ?? ''}
                  placeholder="100"
                  onChange={(e) =>
                    onChange({
                      pump_control: {
                        ...(hs.pump_control ?? {}),
                        max_speed_pct:
                          e.target.value === ''
                            ? undefined
                            : parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="w-32 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>
          )}

          {/* Flow Control Details */}
          <div>
            <button
              type="button"
              onClick={() => setShowFlowControl(!showFlowControl)}
              className="flex items-center gap-2 text-sm font-medium text-[var(--text)]"
            >
              {showFlowControl ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
              Flow & On/Off Control Details
            </button>
            {showFlowControl && (
              <div className="space-y-4 pl-4 mt-3 border-l-2 border-[var(--border)]">
                {driver === 'mqtt' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <TopicField
                      label="Flow Temp Set Topic"
                      value={hs.flow_control?.topic || ''}
                      onChange={(v) =>
                        onChange({
                          flow_control: {
                            ...hs.flow_control,
                            topic: v || undefined,
                          },
                        })
                      }
                      placeholder={mqttControlPlaceholder(sources, index, 'flow_temp/set')}
                    />
                    <TopicField
                      label="Mode Topic"
                      value={hs.flow_control?.mode_topic || ''}
                      onChange={(v) =>
                        onChange({
                          flow_control: {
                            ...hs.flow_control,
                            mode_topic: v || undefined,
                          },
                        })
                      }
                      placeholder={mqttControlPlaceholder(sources, index, 'mode/set')}
                    />
                  </div>
                ) : (
                  <>
                    {method === 'ha_service' && (
                      <div className="grid grid-cols-3 gap-4">
                        <EntityField
                          label="Domain"
                          value={hs.flow_control?.domain || ''}
                          onChange={(v) =>
                            onChange({
                              flow_control: {
                                ...hs.flow_control,
                                domain: v || undefined,
                              },
                            })
                          }
                          placeholder="climate"
                        />
                        <EntityField
                          label="Service"
                          value={hs.flow_control?.service || ''}
                          onChange={(v) =>
                            onChange({
                              flow_control: {
                                ...hs.flow_control,
                                service: v || undefined,
                              },
                            })
                          }
                          placeholder="set_temperature"
                        />
                        <EntityField
                          label="Entity ID"
                          value={hs.flow_control?.entity_id || ''}
                          onChange={(v) =>
                            onChange({
                              flow_control: {
                                ...hs.flow_control,
                                entity_id: v || undefined,
                              },
                            })
                          }
                          placeholder="climate.heat_pump"
                        />
                      </div>
                    )}
                    {method === 'mqtt' && (
                      <div className="grid grid-cols-2 gap-4">
                        <EntityField
                          label="Topic"
                          value={hs.flow_control?.topic || ''}
                          onChange={(v) =>
                            onChange({
                              flow_control: {
                                ...hs.flow_control,
                                topic: v || undefined,
                              },
                            })
                          }
                          placeholder={mqttControlPlaceholder(sources, index, 'flow_temp/set')}
                        />
                        <EntityField
                          label="Mode Topic"
                          value={hs.flow_control?.mode_topic || ''}
                          onChange={(v) =>
                            onChange({
                              flow_control: {
                                ...hs.flow_control,
                                mode_topic: v || undefined,
                              },
                            })
                          }
                          placeholder={mqttControlPlaceholder(sources, index, 'mode/set')}
                        />
                      </div>
                    )}
                    {method === 'entity' && (
                      <div className="grid grid-cols-2 gap-4">
                        <EntityField
                          label="Flow Entity"
                          value={hs.flow_control?.flow_entity || ''}
                          onChange={(v) =>
                            onChange({
                              flow_control: {
                                ...hs.flow_control,
                                flow_entity: v || undefined,
                              },
                            })
                          }
                          placeholder="input_number.flow_temp"
                        />
                        <EntityField
                          label="Mode Entity"
                          value={hs.flow_control?.mode_entity || ''}
                          onChange={(v) =>
                            onChange({
                              flow_control: {
                                ...hs.flow_control,
                                mode_entity: v || undefined,
                              },
                            })
                          }
                          placeholder="input_select.hp_mode"
                        />
                      </div>
                    )}
                  </>
                )}

                {driver !== 'mqtt' && (
                  <>
                    <h4 className="text-xs font-medium text-[var(--text)] mt-2">
                      On/Off Control
                    </h4>
                    <div className="grid grid-cols-3 gap-4">
                      <EntityField
                        label="Domain"
                        value={hs.on_off_control?.domain || ''}
                        onChange={(v) =>
                          onChange({
                            on_off_control: {
                              ...hs.on_off_control,
                              domain: v || undefined,
                            },
                          })
                        }
                        placeholder="climate"
                      />
                      <EntityField
                        label="Service"
                        value={hs.on_off_control?.service || ''}
                        onChange={(v) =>
                          onChange({
                            on_off_control: {
                              ...hs.on_off_control,
                              service: v || undefined,
                            },
                          })
                        }
                        placeholder="turn_on"
                      />
                      <EntityField
                        label="Entity ID"
                        value={hs.on_off_control?.entity_id || ''}
                        onChange={(v) =>
                          onChange({
                            on_off_control: {
                              ...hs.on_off_control,
                              entity_id: v || undefined,
                            },
                          })
                        }
                        placeholder="climate.heat_pump"
                      />
                    </div>
                    <EntityField
                      label="Device ID (Octopus)"
                      value={hs.on_off_control?.device_id || ''}
                      onChange={(v) =>
                        onChange({
                          on_off_control: {
                            ...hs.on_off_control,
                            device_id: v || undefined,
                          },
                        })
                      }
                      placeholder="abc123def456..."
                    />
                  </>
                )}
              </div>
            )}
          </div>

          {/* Sensors */}
          <div>
            <button
              type="button"
              onClick={() => setShowSensors(!showSensors)}
              className="flex items-center gap-2 text-sm font-medium text-[var(--text)]"
            >
              {showSensors ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
              {driver === 'mqtt' ? 'Sensor Topics' : 'Sensor Entities'}
            </button>
            {showSensors && (
              <div className="space-y-3 pl-4 mt-3 border-l-2 border-[var(--border)]">
                {driver === 'mqtt' ? (
                  <>
                    {(
                      [
                        ['flow_temp', 'Flow Temperature'],
                        ['power_input', 'Power Input'],
                        ['cop', 'COP'],
                        ['heat_output', 'Heat Output'],
                        ['total_energy', 'Total Energy'],
                        ['return_temp', 'Return Temperature'],
                        ['flow_rate', 'Flow Rate'],
                        ['delta_t', 'Delta-T'],
                      ] as const
                    ).map(([key, label]) => (
                      <TopicField
                        key={key}
                        label={label}
                        value={sensorEntity(hs.sensors?.[key])}
                        onChange={(v) => onSensorChange(key, v)}
                        placeholder={mqttSensorPlaceholder(sources, index, key)}
                      />
                    ))}
                    {isNonHp && (
                      <TopicField
                        label="Pump power"
                        value={sensorEntity(hs.sensors?.pump_power)}
                        onChange={(v) => onSensorChange('pump_power', v)}
                        placeholder={mqttSensorPlaceholder(sources, index, 'pump_power')}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <EntityField
                      label="Flow Temperature"
                      value={sensorEntity(hs.sensors?.flow_temp)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.flow_temp)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.flow_temp)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.flow_temp)]?.unit}
                      onChange={(v) => onSensorChange('flow_temp', v)}
                      placeholder="sensor.hp_flow_temp"
                    />
                    <EntityField
                      label="Power Input"
                      value={sensorEntity(hs.sensors?.power_input)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.power_input)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.power_input)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.power_input)]?.unit}
                      onChange={(v) => onSensorChange('power_input', v)}
                      placeholder="sensor.hp_power"
                    />
                    <EntityField
                      label="COP"
                      value={sensorEntity(hs.sensors?.cop)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.cop)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.cop)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.cop)]?.unit}
                      onChange={(v) => onSensorChange('cop', v)}
                      placeholder="sensor.hp_cop"
                    />
                    <EntityField
                      label="Heat Output"
                      value={sensorEntity(hs.sensors?.heat_output)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.heat_output)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.heat_output)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.heat_output)]?.unit}
                      onChange={(v) => onSensorChange('heat_output', v)}
                      placeholder="sensor.hp_heat_output"
                    />
                    <EntityField
                      label="Total Energy"
                      value={sensorEntity(hs.sensors?.total_energy)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.total_energy)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.total_energy)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.total_energy)]?.unit}
                      onChange={(v) => onSensorChange('total_energy', v)}
                      placeholder="sensor.hp_total_energy"
                    />
                    <EntityField
                      label="Return Temperature"
                      value={sensorEntity(hs.sensors?.return_temp)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.return_temp)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.return_temp)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.return_temp)]?.unit}
                      onChange={(v) => onSensorChange('return_temp', v)}
                      placeholder="sensor.hp_return_temp"
                    />
                    <EntityField
                      label="Flow Rate"
                      value={sensorEntity(hs.sensors?.flow_rate)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.flow_rate)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.flow_rate)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.flow_rate)]?.unit}
                      onChange={(v) => onSensorChange('flow_rate', v)}
                      placeholder="sensor.hp_flow_rate"
                    />
                    <EntityField
                      label="Delta-T"
                      value={sensorEntity(hs.sensors?.delta_t)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.delta_t)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.delta_t)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.delta_t)]?.unit}
                      onChange={(v) => onSensorChange('delta_t', v)}
                      placeholder="sensor.hp_delta_t"
                    />
                    <EntityField
                      label="Cooling Status"
                      value={sensorEntity(hs.sensors?.cooling_active)}
                      friendlyName={resolved[sensorEntity(hs.sensors?.cooling_active)]?.friendly_name}
                      state={resolved[sensorEntity(hs.sensors?.cooling_active)]?.state}
                      unit={resolved[sensorEntity(hs.sensors?.cooling_active)]?.unit}
                      onChange={(v) => onSensorChange('cooling_active', v)}
                      placeholder="binary_sensor.my_hp_cooling"
                    />
                    {isNonHp && (
                      <EntityField
                        label="Pump power"
                        value={sensorEntity(hs.sensors?.pump_power)}
                        friendlyName={resolved[sensorEntity(hs.sensors?.pump_power)]?.friendly_name}
                        state={resolved[sensorEntity(hs.sensors?.pump_power)]?.state}
                        unit={resolved[sensorEntity(hs.sensors?.pump_power)]?.unit}
                        onChange={(v) => onSensorChange('pump_power', v)}
                        placeholder="sensor.boiler_pump_power"
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
