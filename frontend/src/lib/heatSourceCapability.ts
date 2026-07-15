// INSTRUCTION-412 — frontend MIRROR of the backend per-source flow-capability
// registry defaults + the absolute guard band. 339C lockstep discipline: these
// values MUST stay in step with the backend. If either side changes, change both.
//   - ABSOLUTE_FLOW_CAPABILITY   ↔ qsh/heat_source_limits.py  ABSOLUTE_FLOW_CAPABILITY_C
//   - FLOW_CAPABILITY_DEFAULTS   ↔ qsh/pipeline/source_capabilities.py SOURCE_CAPABILITIES
//                                  (each type's flow_floor_c / flow_ceiling_c)
// The backend is authoritative — every save is band- and coherence-checked at the
// PATCH / deploy boundary and rejected with a self-sufficient 422 the panel echoes.
// This mirror exists only to flag the mistake client-side before the round-trip.

export const ABSOLUTE_FLOW_CAPABILITY: readonly [number, number] = [20, 90]

export interface FlowCapabilityDefault {
  floor: number
  ceiling: number
}

export const FLOW_CAPABILITY_DEFAULTS: Record<string, FlowCapabilityDefault> = {
  heat_pump: { floor: 25, ceiling: 55 },
  gshp: { floor: 25, ceiling: 55 },
  gas_boiler: { floor: 50, ceiling: 80 },
  lpg_boiler: { floor: 50, ceiling: 80 },
  oil_boiler: { floor: 55, ceiling: 80 },
}

function registryEnvelope(type: string | undefined): FlowCapabilityDefault {
  return (
    (type && FLOW_CAPABILITY_DEFAULTS[type]) || FLOW_CAPABILITY_DEFAULTS.heat_pump
  )
}

function inBand(v: number | undefined): number | undefined {
  const [absLo, absHi] = ABSOLUTE_FLOW_CAPABILITY
  return v != null && !Number.isNaN(v) && v >= absLo && v <= absHi ? v : undefined
}

/**
 * Resolve the effective capability envelope [lo, hi] — asserted-else-registry per
 * axis, coherence-checked. Mirrors the backend `clamp_source_flow_envelope`
 * resolution: an in-band asserted axis replaces the registry value; a resolved
 * pair that inverts (lo >= hi) reverts BOTH axes to the type registry envelope,
 * so the returned envelope is always well-formed.
 */
export function effectiveCapability(
  type: string | undefined,
  capabilityFlowMin: number | undefined,
  capabilityFlowMax: number | undefined,
): [number, number] {
  const reg = registryEnvelope(type)
  let lo = inBand(capabilityFlowMin) ?? reg.floor
  let hi = inBand(capabilityFlowMax) ?? reg.ceiling
  if (lo >= hi) {
    lo = reg.floor
    hi = reg.ceiling
  }
  return [lo, hi]
}

/**
 * True when the RESOLVED capability pair (asserted-else-registry, mirror defaults
 * for unasserted axes) inverts — i.e. lo >= hi BEFORE the registry revert. This is
 * the fail-loud coherence check (R1): a single asserted axis can invert against the
 * other axis's registry default (e.g. gas boiler + capability_flow_max=45 → [50, 45]).
 * Callers should only surface this when neither asserted axis is individually out of
 * band (an out-of-band axis is flagged by its own error, not double-flagged here).
 */
export function resolvedCapabilityInverts(
  type: string | undefined,
  capabilityFlowMin: number | undefined,
  capabilityFlowMax: number | undefined,
): boolean {
  const reg = registryEnvelope(type)
  const lo = inBand(capabilityFlowMin) ?? reg.floor
  const hi = inBand(capabilityFlowMax) ?? reg.ceiling
  return lo >= hi
}
