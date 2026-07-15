"""Shared per-entry heat_sources validation for the interactive write surfaces.

INSTRUCTION-412 D7 — ONE guard implementation, TWO call sites: the settings PATCH
section guard (``qsh/api/routes/config.py``) and the wizard deploy route
(``qsh/api/routes/wizard.py``). Homing every per-entry heat_sources check here means
the applied clamp (``source_capabilities.clamp_source_flow_envelope``), the boot
warn, the config-load fail-hard, and the save-time rejection all derive from one
place and cannot disagree (372A no-drift property, extended to capability +
coherence).

Imports are deliberately light — ``qsh.heat_source_limits`` (constants) and
``qsh.pipeline.source_capabilities`` (pure resolution helpers) only. No FastAPI, no
route imports: callers own the HTTPException raise, so this module stays
framework-free and unit-testable in isolation.

The aggregate ``validate_heat_sources_list`` returns ``(status_code, detail)`` on the
first failing check, else ``None``; callers raise ``HTTPException(status, detail)``.
Structural shape defects map to 400; out-of-band / incoherent VALUES map to 422 —
the settings PATCH surface's pre-412 400/422 mapping preserved byte-for-byte
(INSTRUCTION-412 D7 / T3). Detail strings are self-sufficient (INSTRUCTION-412 L4):
each names the source index / name, the offending value, the permitted band, and
the remediation, so it stands alone in a banner off-screen.
"""

from typing import Any, Dict, List, Optional, Tuple

from qsh.heat_source_limits import (
    ABSOLUTE_FLOW_CAPABILITY_C,
    MAX_HEAT_SOURCES,
    MIN_HEAT_SOURCES,
)
from qsh.pipeline.source_capabilities import (
    clamp_source_flow_envelope,
    resolve_effective_capability_or_reason,
)


def validate_no_duplicate_heat_source_topics(
    sources: List[Dict[str, Any]],
) -> Optional[str]:
    """Return an error string if any sensor topic appears under two sources.

    INSTRUCTION-241C §D-6: silent data fusion is the failure mode this guard
    exists to prevent. Two sources subscribed to the same MQTT topic produce a
    corrupted SensorData.heat_sources dict with one entry overwriting the other on
    each payload. Hard reject at interactive-save time.

    Returns None if validation passes; an error message string if duplicates
    detected. Error names the conflicting (source, slot) pair so the operator can
    resolve unambiguously.

    Note: same topic on DIFFERENT slots WITHIN a single source is allowed — only one
    source claims it, so no fusion. Cross-source slot collision IS rejected
    regardless of slot name (silently-fused source attribution).

    INSTRUCTION-412 — relocated here (from ``routes/config.py``) so both interactive
    write surfaces share it. ``routes/config.py`` re-exports the leading-underscore
    name for the existing unit test.
    """
    seen: Dict[str, Tuple[str, str]] = {}  # topic -> (source_name, slot)
    for source in sources:
        if not isinstance(source, dict):
            continue
        name = source.get("name", "<unnamed>")
        sensors = source.get("sensors", {}) or {}
        if not isinstance(sensors, dict):
            continue
        # Track topics added in THIS source's pass — same-source intra-slot
        # duplication is allowed and must not poison the seen dict for the
        # next source.
        this_source_topics: Dict[str, str] = {}
        for slot, value in sensors.items():
            topic: Optional[str] = None
            if isinstance(value, str):
                topic = value.strip()
            elif isinstance(value, dict):
                raw_topic = value.get("topic", "")
                topic = raw_topic.strip() if isinstance(raw_topic, str) else None
            if not topic:
                continue
            if topic in seen:
                other_name, other_slot = seen[topic]
                return (
                    f"Duplicate sensor topic '{topic}' assigned to both "
                    f"({other_name}, {other_slot}) and ({name}, {slot}). "
                    f"Per INSTRUCTION-241C §D-6 the same topic may not feed "
                    f"two heat sources — silent data fusion."
                )
            this_source_topics[topic] = slot
        # Merge this source's topics into the cross-source seen index AFTER
        # the loop, so intra-source same-topic across slots is allowed but
        # subsequent sources still get checked against this source's set.
        for topic, slot in this_source_topics.items():
            seen[topic] = (name, slot)
    return None


def _coerce(value) -> Optional[float]:
    """Coerce like the config loader's ``safe_float`` — None if non-numeric."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _check_shape(sources) -> Optional[Tuple[int, str]]:
    """Element shape / count / type (INSTRUCTION-237A, relocated). 400 on failure."""
    if not isinstance(sources, list):
        return (400, "heat_sources must be a list of source objects")
    if not (MIN_HEAT_SOURCES <= len(sources) <= MAX_HEAT_SOURCES):
        return (
            400,
            f"heat_sources must contain {MIN_HEAT_SOURCES}..{MAX_HEAT_SOURCES} entries",
        )
    if not all(isinstance(x, dict) for x in sources):
        return (400, "heat_sources entries must all be objects (dicts)")
    if not all(isinstance(x.get("type"), str) for x in sources):
        return (400, "heat_sources[*].type is required and must be a string")
    return None


def _check_response_timeout(idx: int, src: dict) -> Optional[Tuple[int, str]]:
    """Per-source response_timeout_s band [30, 900] s (INSTRUCTION-339C, relocated).

    Newly enforced on the wizard deploy surface by INSTRUCTION-412 (D7 — closes the
    pre-existing sibling bypass: the deploy route carried no response-timeout check).
    """
    if "response_timeout_s" not in src:
        return None
    rt = _coerce(src["response_timeout_s"])
    if rt is None:
        return (
            422,
            f"heat_sources[{idx}].response_timeout_s must be a number, "
            f"got {src['response_timeout_s']!r}",
        )
    if not (30.0 <= rt <= 900.0):
        return (
            422,
            f"heat_sources[{idx}].response_timeout_s={rt}s is outside safe range "
            f"[30, 900]",
        )
    return None


def _check_capability(idx: int, src: dict) -> Optional[Tuple[int, str]]:
    """Capability keys numeric / in-band + resolved-pair coherence (412 D2/R1). 422."""
    has_min = "capability_flow_min" in src
    has_max = "capability_flow_max" in src
    if not (has_min or has_max):
        return None
    abs_lo, abs_hi = ABSOLUTE_FLOW_CAPABILITY_C
    src_type = src.get("type")
    cap_min = cap_max = None
    if has_min:
        cap_min = _coerce(src["capability_flow_min"])
        if cap_min is None:
            return (
                422,
                f"heat_sources[{idx}].capability_flow_min must be a number, "
                f"got {src['capability_flow_min']!r}",
            )
        if not (abs_lo <= cap_min <= abs_hi):
            return (
                422,
                f"heat_sources[{idx}].capability_flow_min={cap_min} is outside the "
                f"absolute flow-capability band [{abs_lo}, {abs_hi}]",
            )
    if has_max:
        cap_max = _coerce(src["capability_flow_max"])
        if cap_max is None:
            return (
                422,
                f"heat_sources[{idx}].capability_flow_max must be a number, "
                f"got {src['capability_flow_max']!r}",
            )
        if not (abs_lo <= cap_max <= abs_hi):
            return (
                422,
                f"heat_sources[{idx}].capability_flow_max={cap_max} is outside the "
                f"absolute flow-capability band [{abs_lo}, {abs_hi}]",
            )
    eff_lo, eff_hi, reason = resolve_effective_capability_or_reason(
        src_type, cap_min, cap_max
    )
    if reason is not None:
        return (
            422,
            f"heat_sources[{idx}] flow capability is incoherent: {reason} "
            f"(effective envelope [{eff_lo}, {eff_hi}] requires floor < ceiling)",
        )
    return None


def _check_operating_envelope(idx: int, src: dict) -> Optional[Tuple[int, str]]:
    """Operating flow_min/flow_max inside the EFFECTIVE capability envelope +
    operating-pair inversion (INSTRUCTION-412 D2(v)/(vi), M2 strict). 422.

    Runs AFTER _check_capability for the same element, so the capability pair is
    already known coherent and the effective envelope is well-formed. flow_min /
    flow_max are checked only when present AND coercible — a non-numeric operating
    value follows the loader's ``safe_float(None)`` outcome (treated as absent), so
    it is not newly rejected here (parity with the config-load semantics).
    """
    src_type = src.get("type")
    name = src.get("name", src_type)
    eff_lo, eff_hi, _ = clamp_source_flow_envelope(
        src_type,
        None,
        None,
        src.get("capability_flow_min"),
        src.get("capability_flow_max"),
    )
    fmin = _coerce(src["flow_min"]) if "flow_min" in src else None
    fmax = _coerce(src["flow_max"]) if "flow_max" in src else None
    if fmin is not None and (fmin < eff_lo or fmin > eff_hi):
        return (
            422,
            f"heat_sources[{idx}] ('{name}') flow_min={fmin} is outside the appliance "
            f"flow capability [{eff_lo}, {eff_hi}]. Widen the capability "
            f"(capability_flow_min / capability_flow_max) to your appliance's rated "
            f"range, or bring flow_min inside the current capability",
        )
    if fmax is not None and (fmax < eff_lo or fmax > eff_hi):
        return (
            422,
            f"heat_sources[{idx}] ('{name}') flow_max={fmax} is outside the appliance "
            f"flow capability [{eff_lo}, {eff_hi}]. Widen the capability "
            f"(capability_flow_min / capability_flow_max) to your appliance's rated "
            f"range, or bring flow_max inside the current capability",
        )
    # INSTRUCTION-412 M2 — strict inversion, mirroring the runtime predicate
    # (clamp_source_flow_envelope reverts on floor > ceiling, strict). flow_min ==
    # flow_max is a runtime-legal pinned envelope and is accepted.
    if fmin is not None and fmax is not None and fmin > fmax:
        return (
            422,
            f"heat_sources[{idx}] ('{name}') flow_min={fmin} must not exceed "
            f"flow_max={fmax} — the operating pair is inverted",
        )
    return None


def validate_heat_sources_list(sources) -> Optional[Tuple[int, str]]:
    """Aggregate per-entry guard for both interactive write surfaces (412 D7).

    Returns ``(status_code, detail)`` on the first failing check (400 structural /
    422 value), else ``None``. Check order per element: response_timeout → capability
    (must precede operating so the effective envelope is coherent) → operating
    envelope + inversion.
    """
    shape = _check_shape(sources)
    if shape is not None:
        return shape
    dup = validate_no_duplicate_heat_source_topics(sources)
    if dup is not None:
        return (400, dup)
    for idx, src in enumerate(sources):
        for check in (
            _check_response_timeout,
            _check_capability,
            _check_operating_envelope,
        ):
            err = check(idx, src)
            if err is not None:
                return err
    return None


__all__ = [
    "validate_heat_sources_list",
    "validate_no_duplicate_heat_source_topics",
]
