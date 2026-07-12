"""Configuration endpoints — read, raw YAML access, section updates, deletion."""

import copy
import logging
import os
import yaml
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from ..state import shared_state

# YAML I/O primitives live in qsh.config_io so non-HTTP modules can update
# qsh.yaml without importing from this routes package (INSTRUCTION-130 Task 0).
# Re-exported under their original underscore-private names so existing internal
# call sites — and test patches at @patch("qsh.api.routes.config._atomic_write_yaml")
# — continue to work unchanged.
from qsh.config_io import (
    yaml_lock as _yaml_lock,
    atomic_write_yaml as _atomic_write_yaml,
)
from qsh.paths import YAML_PATH

logger = logging.getLogger(__name__)

router = APIRouter()

YAML_SEARCH_PATHS = [
    "/config/qsh.yaml",
    "/data/qsh.yaml",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "qsh.yaml"
    ),
]

REDACTED_SENTINEL = "***REDACTED***"


def _validate_no_duplicate_heat_source_topics(
    sources: List[Dict[str, Any]],
) -> Optional[str]:
    """Return an error string if any sensor topic appears under two sources.

    INSTRUCTION-241C §D-6: silent data fusion is the failure mode this guard
    exists to prevent. After 241A lands, two sources subscribed to the same
    MQTT topic produce a corrupted SensorData.heat_sources dict with one
    entry overwriting the other on each payload. Hard reject at PATCH time.

    Returns None if validation passes; an error message string if duplicates
    detected. Error names the conflicting (source, slot) pair so the operator
    can resolve unambiguously.

    Note: same topic on DIFFERENT slots WITHIN a single source is allowed —
    only one source claims it, so no fusion. Cross-source slot collision IS
    rejected regardless of slot name (silently-fused source attribution).
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


def _find_yaml_path() -> str:
    """Find the active qsh.yaml path."""
    for path in YAML_SEARCH_PATHS:
        if os.path.isfile(path):
            return path
    return YAML_PATH  # Default write path


def _load_raw_yaml():
    """Load the raw YAML (not the processed HOUSE_CONFIG).

    Returns the parsed dict, or None if the file could not be read/parsed.
    """
    path = _find_yaml_path()
    try:
        with open(path, "r") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.error(
            "Failed to load qsh.yaml from %s: %s — returning None", path, e
        )
        return None


def read_modify_write(transform: Callable[[dict], dict]) -> dict:
    """Canonical YAML read-modify-write helper for HTTP route callers, used by
    both PATCH /api/config/{section} and POST /api/wizard/persist-octopus-tariff-codes
    (INSTRUCTION-174 V2 LOW). Promoted from a leading-underscore private name
    when a second cross-module caller (wizard.py) was introduced — the
    underscore signal would otherwise be silently violated.

    Resolves the YAML path via the search-list (the alpha-install backwards-
    compat affordance) and uses the local _load_raw_yaml / _atomic_write_yaml
    references — both are patchable for tests at qsh.api.routes.config.

    Non-HTTP callers should use qsh.config_io.read_modify_write, which resolves
    directly against qsh.paths.YAML_PATH and skips the search list.
    """
    path = _find_yaml_path()
    with _yaml_lock:
        raw = _load_raw_yaml()
        if raw is None and os.path.isfile(path) and os.path.getsize(path) > 0:
            raise RuntimeError(
                f"Config file {path} exists ({os.path.getsize(path)} bytes) "
                f"but _load_raw_yaml returned None — refusing to overwrite"
            )
        if raw is None:
            raw = {}
        result = transform(raw)
        _atomic_write_yaml(result, path)
    return result


def _migrate_on_save_strip_legacy(persisted: dict, payload: dict) -> dict:
    """INSTRUCTION-411 (was 150C V5 E-M5 / V3 150C-V2-M3): COPY-FORWARD-THEN-STRIP
    legacy tariff migration.

    A legacy Octopus credential is MOVED into its new-shape home before the
    legacy key is stripped (D1), so a Settings/wizard save never removes the last
    on-disk copy of a credential still read by any fuel — the reported
    persistence defect (S1). The transform reasons about the COMPLETE on-disk
    energy section (D9 — `_apply_patch` preserves every unsubmitted `energy.*`
    sub-block before this runs) but gates each branch on the SUBMITTED fuel set
    carried in `payload["energy"]`, so a single-fuel save migrates only the fuel
    it touched. Partial migration is INTENDED (V3 150C-V2-M4).

    PURE FUNCTIONAL — returns a NEW dict; does NOT mutate `persisted`.
    Caller pattern: `persisted = _migrate_on_save_strip_legacy(persisted, payload)`.

    Phases:
      1. FILL (copy-forward) — gap-fill the SUBMITTED fuel's new-shape block from
         the legacy energy.octopus.* values (new-shape wins, D4).
      2. DECLARE (D7) — an undeclared submitted block now carrying its fuel's full
         Octopus credential set is stamped provider='octopus', preserving the
         resolution the legacy synthesis path would have produced.
      3. STRIP — submitted-branch-gated pop of the migrated legacy keys; a shared
         credential (api_key / account_number) is popped only once NO fuel —
         declared, undeclared, or blockless-by-synthesis — still reads it (D8/L7).
    """
    result = copy.deepcopy(persisted)
    energy_payload = payload.get("energy", {})
    if not isinstance(energy_payload, dict):
        energy_payload = {}

    submitted_octopus_fuels = [
        f for f in ("electricity", "gas") if f in energy_payload
    ]

    energy = result.get("energy")
    if isinstance(energy, dict) and submitted_octopus_fuels:
        # Phase 1 — FILL. Each submitted fuel's block is gap-filled from legacy:
        # the shared credentials and the fuel's own keys, per the forward map.
        for fuel in submitted_octopus_fuels:
            block = energy.get(fuel)
            if isinstance(block, dict):
                _copy_forward(energy, block, fuel, _FUEL_FORWARD_NEW_KEYS[fuel])

        # Phase 2 — DECLARE (D7, resolution-preserving).
        from qsh.tariff import OCTOPUS_REQUIRED_CREDENTIALS

        for fuel in submitted_octopus_fuels:
            block = energy.get(fuel)
            if isinstance(block, dict) and not block.get("provider"):
                required = OCTOPUS_REQUIRED_CREDENTIALS.get(fuel, ())
                if required and all(_is_real(block.get(k)) for k in required):
                    block["provider"] = "octopus"

    # Phase 3 — STRIP.
    if "electricity" in energy_payload:
        legacy_octopus = result.get("energy", {}).get("octopus", {})
        for key in _ELECTRICITY_LEGACY_POP_KEYS:
            legacy_octopus.pop(key, None)
        # 158B V2 (Finding 1 / parent Decision 8): when the new shape selects
        # ha_entity AND carries an explicit rates_entity, the legacy
        # octopus.rates nested dict is redundant. Strip it so the YAML has a
        # single source of truth. Conditional on the new shape being well-formed
        # — a malformed ha_entity save (provider set but rates_entity missing)
        # does NOT remove the only working source.
        elec = energy_payload.get("electricity", {})
        if (
            isinstance(elec, dict)
            and elec.get("provider") == "ha_entity"
            and elec.get("rates_entity")
        ):
            legacy_octopus.pop("rates", None)

    if "gas" in energy_payload:
        legacy_octopus = result.get("energy", {}).get("octopus", {})
        for key in _GAS_LEGACY_POP_KEYS:
            legacy_octopus.pop(key, None)
        legacy_tariff = result.get("tariff", {})
        legacy_tariff.pop("gas_price", None)

    # Shared credentials — strip only once NO fuel still reads them (D8/L7).
    # Evaluated AFTER the fuel-specific pops but BEFORE removing the shared keys,
    # so the consumer gate sees the pre-strip legacy octopus state.
    if submitted_octopus_fuels:
        legacy_octopus = result.get("energy", {}).get("octopus", {})
        if isinstance(legacy_octopus, dict):
            unconsumed = [
                key
                for key in _SHARED_LEGACY_KEYS
                if not _legacy_still_consumed(result, key)
            ]
            for key in unconsumed:
                legacy_octopus.pop(key, None)

    if "lpg" in energy_payload:
        result.get("tariff", {}).pop("lpg_price", None)

    if "oil" in energy_payload:
        result.get("tariff", {}).pop("oil_price", None)

    # Drop empty containers so the YAML stays tidy.
    energy_section = result.get("energy")
    if isinstance(energy_section, dict):
        legacy_octopus = energy_section.get("octopus")
        if isinstance(legacy_octopus, dict) and not legacy_octopus:
            energy_section.pop("octopus", None)
    if result.get("tariff") == {}:
        result.pop("tariff", None)

    return result


def restore_redacted(existing: dict, incoming: dict) -> dict:
    """Full-section overwrite with redacted field restoration.

    The incoming dict is the complete section as the UI intends it.
    The ONLY exception: fields arriving as REDACTED_SENTINEL are
    replaced with the existing real value. All other keys are taken
    from incoming as-is.
    """
    result = {}
    for key, value in incoming.items():
        if value == REDACTED_SENTINEL and key in existing:
            result[key] = existing[key]
        elif isinstance(value, dict) and isinstance(existing.get(key), dict):
            result[key] = restore_redacted(existing[key], value)
        else:
            result[key] = value
    return result


# INSTRUCTION-378: the two DHW signal-source keys that live ONLY in the singular
# heat_source.sensors block. The frontend strips them from the plural heat_sources
# payload (INSTRUCTION-236), and the singular block is both the sole HA-path read
# site (config.py:1726-1741) and write site. The length-1 plural→singular mirror
# (INSTRUCTION-237A) is a blind full-block assignment of the DHW-stripped primary,
# so without re-merging these keys it silently deletes the operator's hot-water
# entities on every Heat-Source save / wizard re-deploy.
DHW_SINGULAR_SENSOR_KEYS = ("water_heater", "hot_water_boolean")


def preserve_singular_dhw_sensors(prev_singular: dict, mirrored: dict) -> dict:
    """Re-merge the DHW signal-source keys from a prior singular heat_source
    into the mirrored (DHW-stripped) primary, gap-fill semantics.

    `mirrored` values win where present; `prev_singular["sensors"]` fills gaps
    via setdefault. Mutates and returns `mirrored`.

    The no-op is keyed on `prev_singular`, NOT on `mirrored`: if `prev_singular`
    has no `sensors` dict, or carries none of `DHW_SINGULAR_SENSOR_KEYS`, the
    function returns `mirrored` untouched (preserving the
    `persisted["heat_source"] == payload[0]` contract for no-DHW installs). But
    when `prev_singular` DOES carry DHW keys, they are injected even if `mirrored`
    has no `sensors` dict at all — the function creates `mirrored["sensors"]`.
    """
    prev_sensors = prev_singular.get("sensors") if isinstance(prev_singular, dict) else None
    if not isinstance(prev_sensors, dict):
        return mirrored
    dhw = {k: prev_sensors[k] for k in DHW_SINGULAR_SENSOR_KEYS if k in prev_sensors}
    if not dhw:
        return mirrored
    mirrored_sensors = mirrored.get("sensors")
    if not isinstance(mirrored_sensors, dict):
        mirrored_sensors = {}
        mirrored["sensors"] = mirrored_sensors
    for key, value in dhw.items():
        mirrored_sensors.setdefault(key, value)
    return mirrored


# 158A Task 3: legacy fallback paths for first-save sentinel restoration.
# Maps (parent_key, child_key) in the new shape to (legacy_parent, legacy_child)
# in the persisted YAML. When the new path's value is REDACTED_SENTINEL and
# the new path has no existing real value, fall back to the legacy path.
_ENERGY_SENTINEL_LEGACY_BRIDGES = {
    ("electricity", "octopus_api_key"):        ("octopus", "api_key"),
    ("electricity", "octopus_account_number"): ("octopus", "account_number"),
    ("electricity", "octopus_tariff_code"):    ("octopus", "electricity_tariff_code"),
    ("gas", "octopus_api_key"):                ("octopus", "api_key"),
    ("gas", "octopus_account_number"):         ("octopus", "account_number"),
    ("gas", "octopus_tariff_code"):            ("octopus", "gas_tariff_code"),
}


# ═══════════════════════════════════════════════════════════════════════════
# INSTRUCTION-411 — copy-forward-then-strip legacy tariff migration substrate
# ═══════════════════════════════════════════════════════════════════════════

# Shared Octopus credentials — live under energy.octopus and are read by BOTH
# the electricity and gas providers.
_SHARED_LEGACY_KEYS: Tuple[str, ...] = ("api_key", "account_number")
# New-shape home of each shared legacy key (identical for both fuels).
_SHARED_LEGACY_TO_NEW: Dict[str, str] = {
    "api_key": "octopus_api_key",
    "account_number": "octopus_account_number",
}
# Electricity-only legacy keys under energy.octopus (popped on an electricity
# save; the shared keys above are handled separately by the consumer gate).
_ELECTRICITY_LEGACY_POP_KEYS: Tuple[str, ...] = ("electricity_tariff_code", "rates_entity")
# Gas-only legacy key under energy.octopus.
_GAS_LEGACY_POP_KEYS: Tuple[str, ...] = ("gas_tariff_code",)

# D2 — the forward (copy-forward) twin of _ENERGY_SENTINEL_LEGACY_BRIDGES (the
# restore direction) plus the electricity rates_entity key. Maps
# (fuel, new_child) -> (legacy_parent, legacy_child) WITHIN the energy section.
# Copy-forward reads the legacy value from energy.<legacy_parent>.<legacy_child>
# and gap-fills it into the new-shape block's <new_child>.
_LEGACY_FORWARD_MIGRATIONS: Dict[Tuple[str, str], Tuple[str, str]] = {
    ("electricity", "octopus_api_key"):        ("octopus", "api_key"),
    ("electricity", "octopus_account_number"): ("octopus", "account_number"),
    ("electricity", "octopus_tariff_code"):    ("octopus", "electricity_tariff_code"),
    ("electricity", "rates_entity"):           ("octopus", "rates_entity"),
    ("gas", "octopus_api_key"):                ("octopus", "api_key"),
    ("gas", "octopus_account_number"):         ("octopus", "account_number"),
    ("gas", "octopus_tariff_code"):            ("octopus", "gas_tariff_code"),
}

# The new-shape keys copy-forward fills per fuel, DERIVED from the forward map so
# the two cannot drift: shared credentials plus the fuel's own keys.
_FUEL_FORWARD_NEW_KEYS: Dict[str, Tuple[str, ...]] = {
    "electricity": tuple(nk for (f, nk) in _LEGACY_FORWARD_MIGRATIONS if f == "electricity"),
    "gas": tuple(nk for (f, nk) in _LEGACY_FORWARD_MIGRATIONS if f == "gas"),
}


def _assert_legacy_forward_map_bidirectional() -> None:
    """L6 module-load lockstep assert:
      (1) every restore bridge (_ENERGY_SENTINEL_LEGACY_BRIDGES) appears in the
          forward map with the same (legacy_parent, legacy_child) target; and
      (2) every popped legacy key is represented as a forward-map legacy target,
          so a key can never be stripped without a copy-forward home.
    """
    for new_path, legacy_path in _ENERGY_SENTINEL_LEGACY_BRIDGES.items():
        assert _LEGACY_FORWARD_MIGRATIONS.get(new_path) == legacy_path, (
            f"restore bridge {new_path}->{legacy_path} missing or mismatched in "
            f"_LEGACY_FORWARD_MIGRATIONS"
        )
    map_legacy_children = {child for (_parent, child) in _LEGACY_FORWARD_MIGRATIONS.values()}
    popped = set(_SHARED_LEGACY_KEYS) | set(_ELECTRICITY_LEGACY_POP_KEYS) | set(_GAS_LEGACY_POP_KEYS)
    missing = popped - map_legacy_children
    assert not missing, (
        f"legacy pop keys not represented in _LEGACY_FORWARD_MIGRATIONS: {sorted(missing)}"
    )


_assert_legacy_forward_map_bidirectional()


def _is_real(value: Any) -> bool:
    """D4: a 'real' credential value is a non-empty string that is not the
    redaction sentinel. None / empty / whitespace / REDACTED_SENTINEL are 'not
    real' — a gap the copy-forward may fill, and a value that never counts as an
    own-block copy for the consumer gate."""
    return isinstance(value, str) and bool(value.strip()) and value != REDACTED_SENTINEL


def _copy_forward(
    energy: dict, block: dict, fuel: str, new_keys: Tuple[str, ...]
) -> None:
    """Gap-fill new-shape credential keys in `block` (mutated in place) from the
    legacy energy.octopus.* values, per _LEGACY_FORWARD_MIGRATIONS. New-shape
    wins (D4) — a key already carrying a real value is not overwritten. Only
    eligible blocks (provider in {None, 'octopus'}) are filled; a fixed /
    ha_entity / edf block is left untouched (its keys are irrelevant to it)."""
    if not isinstance(block, dict) or block.get("provider") not in (None, "octopus"):
        return
    for new_key in new_keys:
        if _is_real(block.get(new_key)):
            continue
        mapping = _LEGACY_FORWARD_MIGRATIONS.get((fuel, new_key))
        if mapping is None:
            continue
        legacy_parent, legacy_child = mapping
        legacy_section = energy.get(legacy_parent)
        if not isinstance(legacy_section, dict):
            continue
        legacy_val = legacy_section.get(legacy_child)
        if _is_real(legacy_val):
            block[new_key] = legacy_val


def _fuel_resolves_octopus(energy: dict, fuel: str) -> bool:
    """Whether building `fuel`'s provider from `energy` resolves to Octopus —
    declared (energy.<fuel>.provider == 'octopus') or synthesised from the legacy
    energy.octopus.* keys per qsh.tariff._normalise_legacy_config (which also
    covers the non-dict / scalar-garbage block edge, R12)."""
    from qsh.tariff import _normalise_legacy_config

    resolved = _normalise_legacy_config(energy, fuel)
    return isinstance(resolved, dict) and resolved.get("provider") == "octopus"


def _legacy_still_consumed(result: dict, legacy_key: str) -> bool:
    """True iff some fuel still READS energy.octopus.<legacy_key> after the
    new-shape blocks in `result` are considered (D8/R12). `legacy_key` is one of
    _SHARED_LEGACY_KEYS.

    Models each provider's ACTUAL read path (not an isinstance(dict)
    approximation):
      * electricity reads the legacy shared key ONLY via the synthesis path — a
        block with no `provider`, so _normalise_legacy_config falls through to
        the legacy octopus credentials. A DECLARED electricity block is returned
        as-is by OctopusElectricityProvider._read_section (never merges legacy),
        so it is not a legacy consumer.
      * gas reads the legacy shared key for a declared OR synthesised octopus
        block whenever its own new-shape key is absent — OctopusGasProvider.
        _read_section merges the legacy credentials into a declared block.
    """
    energy = result.get("energy")
    if not isinstance(energy, dict):
        return False
    new_key = _SHARED_LEGACY_TO_NEW[legacy_key]

    # electricity — synthesis path only (no declared provider).
    elec = energy.get("electricity")
    elec_declared = isinstance(elec, dict) and elec.get("provider")
    if not elec_declared and _fuel_resolves_octopus(energy, "electricity"):
        return True

    # gas — declared or synthesised octopus block lacking its own real copy.
    if _fuel_resolves_octopus(energy, "gas"):
        gas_block = energy.get("gas")
        gas_block = gas_block if isinstance(gas_block, dict) else {}
        if not _is_real(gas_block.get(new_key)):
            return True

    return False


def _resolve_sentinel_with_legacy_bridge(
    existing_section: dict, parent_key: str, child_key: str
) -> str | None:
    """Return the real legacy value if the new-shape path is unresolvable.

    Used by restore_redacted_energy only when called on the energy section root.
    None means no legacy value is available — caller should leave the sentinel.
    """
    bridge = _ENERGY_SENTINEL_LEGACY_BRIDGES.get((parent_key, child_key))
    if bridge is None:
        return None
    legacy_parent, legacy_child = bridge
    legacy_section = existing_section.get(legacy_parent, {})
    if not isinstance(legacy_section, dict):
        return None
    val = legacy_section.get(legacy_child)
    return val if isinstance(val, str) and val and val != REDACTED_SENTINEL else None


def _restore_with_legacy(existing_section: dict, parent: str, incoming_child: dict) -> dict:
    """For incoming.electricity / incoming.gas: restore each REDACTED field
    from existing.<parent>.<field> if present, else from the legacy bridge."""
    out = {}
    existing_parent = (
        existing_section.get(parent, {})
        if isinstance(existing_section.get(parent), dict)
        else {}
    )
    for k, v in incoming_child.items():
        if v == REDACTED_SENTINEL:
            if k in existing_parent and existing_parent[k] != REDACTED_SENTINEL:
                out[k] = existing_parent[k]
            else:
                bridged = _resolve_sentinel_with_legacy_bridge(existing_section, parent, k)
                if bridged is not None:
                    out[k] = bridged
                else:
                    out[k] = v  # leave sentinel; downstream will surface as auth failure
        elif isinstance(v, dict) and isinstance(existing_parent.get(k), dict):
            out[k] = restore_redacted(existing_parent[k], v)
        else:
            out[k] = v
    return out


def restore_redacted_energy(existing: dict, incoming: dict) -> dict:
    """Energy-section variant of restore_redacted with cross-key legacy
    bridges for first-save sentinel handling. Delegates to restore_redacted
    for sub-dicts that have a matching existing block; only the new-shape
    parent dicts (electricity, gas) get the legacy fallback treatment.
    """
    result = {}
    for key, value in incoming.items():
        if key in ("electricity", "gas") and isinstance(value, dict):
            result[key] = _restore_with_legacy(existing, key, value)
        elif value == REDACTED_SENTINEL and key in existing:
            result[key] = existing[key]
        elif isinstance(value, dict) and isinstance(existing.get(key), dict):
            result[key] = restore_redacted(existing[key], value)
        else:
            result[key] = value
    return result


@router.get("/config")
def get_config():
    """Return the current HOUSE_CONFIG as JSON.

    Sensitive fields (API keys) are redacted.
    """
    config = shared_state.get_config()
    if config is None:
        return {"error": "Config not yet loaded"}

    safe = _redact_config(config)
    # INSTRUCTION-351A — derived, READ-ONLY flag the UI uses to gate the 'Octopus'
    # DHW schedule-source option (351B). Single-sourced from the backend so the
    # client never re-derives availability (no drift). It is NOT persisted YAML:
    # it is added only to this GET response (a deep copy via _redact_config),
    # never to shared_state's config nor to disk, and never appears in a PATCH
    # *section* body — the 'root' allow-list does not include it either, so a
    # write-back cannot persist it. Imported lazily (and defensively) so the API
    # module import graph does not pull the HA driver in at config.py load time.
    try:
        from qsh.drivers.ha import octopus_hp_control
        safe["octopus_dhw_signal_available"] = octopus_hp_control.dhw_activity_available()
    except Exception:
        safe["octopus_dhw_signal_available"] = False
    return safe


@router.get("/config/raw")
def get_raw_config():
    """Return the raw qsh.yaml as JSON (not the processed HOUSE_CONFIG).

    Used by settings screens to show the editable YAML structure.
    Sensitive fields are redacted.
    """
    raw = _load_raw_yaml() or {}
    return _redact_config(raw)


# INSTRUCTION-401 Task 2: PATCH-able top-level config sections, hoisted to a
# module constant so the carry-through class-closure guard test can import and
# assert every member is either carried into HOUSE_CONFIG or documented-as-
# consumed. Zero behaviour change — same members, same rejection path.
VALID_PATCH_SECTIONS: frozenset[str] = frozenset(
    {
        "rooms",
        "property",
        "heat_source",
        "heat_sources",
        "outdoor",
        "energy",
        "thermal",
        "control",
        "shoulder",
        "summer",
        "solar",
        "battery",
        "battery_devices",
        "grid",
        "cascade",
        "occupancy",
        "historian",
        "hw_plan",
        "hw_schedule",
        "hw_tank",
        "hw_precharge",
        "inverter",
        "logging",
        "source_selection",
        "telemetry",
        "disclaimer_accepted",
        "mqtt",
        "root",
    }
)


@router.patch("/config/{section}")
def patch_config_section(section: str, body=Body(...)):
    """Update a single config section.

    All changes trigger a pipeline restart to adopt the new config.

    INSTRUCTION-237A: body is declared via fastapi.Body so list-shaped PATCHes
    (heat_sources) are accepted alongside dict-shaped ones. The
    body.get("data", body) pattern below collapses both forms uniformly when
    body is a dict; lists pass through directly.
    """
    if section not in VALID_PATCH_SECTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid section: {section}")

    # INSTRUCTION-237A Task 1b: heat_sources element-level guard. Element
    # shape and bounds checks before the snapshot fires, so malformed PATCHes
    # are rejected cheaply and the snapshot is not wasted.
    if section == "heat_sources":
        from qsh.heat_source_limits import MIN_HEAT_SOURCES, MAX_HEAT_SOURCES

        guard_incoming = body.get("data", body) if isinstance(body, dict) else body
        if not isinstance(guard_incoming, list):
            raise HTTPException(
                status_code=400,
                detail="heat_sources PATCH body must be a list of source objects",
            )
        if not (MIN_HEAT_SOURCES <= len(guard_incoming) <= MAX_HEAT_SOURCES):
            raise HTTPException(
                status_code=400,
                detail=f"heat_sources must contain {MIN_HEAT_SOURCES}..{MAX_HEAT_SOURCES} entries",
            )
        if not all(isinstance(x, dict) for x in guard_incoming):
            raise HTTPException(
                status_code=400,
                detail="heat_sources entries must all be objects (dicts)",
            )
        if not all(isinstance(x.get("type"), str) for x in guard_incoming):
            raise HTTPException(
                status_code=400,
                detail="heat_sources[*].type is required and must be a string",
            )

        # INSTRUCTION-241C Task 4: duplicate-topic guard. §D-6 silent data
        # fusion — two sources subscribed to the same MQTT topic produce
        # a corrupted SensorData.heat_sources dict; reject hard at PATCH
        # time before persistence.
        _dup_err = _validate_no_duplicate_heat_source_topics(guard_incoming)
        if _dup_err is not None:
            raise HTTPException(status_code=400, detail=_dup_err)

        # INSTRUCTION-339C — per-element response_timeout_s range parity. Mirrors
        # the backend config-load band [30, 900] s (config.py heat_sources loop)
        # so an out-of-range value is rejected at PATCH with a clean 422 rather
        # than deferred to a config-load SystemExit on the next restart. Coerces
        # like the loader's safe_float so a numeric string is accepted; absent
        # key is fine (resolves to the per-source-type default at runtime).
        for _idx, _src in enumerate(guard_incoming):
            if not isinstance(_src, dict) or "response_timeout_s" not in _src:
                continue
            _rt_raw = _src["response_timeout_s"]
            try:
                _rt = float(_rt_raw)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"heat_sources[{_idx}].response_timeout_s must be a number, "
                        f"got {_rt_raw!r}"
                    ),
                )
            if not (30.0 <= _rt <= 900.0):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"heat_sources[{_idx}].response_timeout_s={_rt}s is outside "
                        "safe range [30, 900]"
                    ),
                )

    # INSTRUCTION-373A Task 1: battery_devices element-level guard. Mirrors the
    # heat_sources element-shape checks above. The list serialises the per-device
    # SoC map ({device, battery_entity, room}); each element must carry a
    # non-empty str device and battery_entity (room optional str), and device
    # must be unique across the list — the config.py parse last-wins on a
    # duplicate device key (qsh/config.py:1835), so reject it hard here.
    if section == "battery_devices":
        guard_incoming = body.get("data", body) if isinstance(body, dict) else body
        if not isinstance(guard_incoming, list):
            raise HTTPException(
                status_code=400,
                detail="battery_devices PATCH body must be a list of device objects",
            )
        if not all(isinstance(x, dict) for x in guard_incoming):
            raise HTTPException(
                status_code=400,
                detail="battery_devices entries must all be objects (dicts)",
            )
        for _idx, _bd in enumerate(guard_incoming):
            _dev = _bd.get("device")
            if not isinstance(_dev, str) or not _dev.strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"battery_devices[{_idx}].device is required and must be a non-empty string",
                )
            _bat = _bd.get("battery_entity")
            if not isinstance(_bat, str) or not _bat.strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"battery_devices[{_idx}].battery_entity is required and must be a non-empty string",
                )
            _room = _bd.get("room")
            if _room is not None and not isinstance(_room, str):
                raise HTTPException(
                    status_code=400,
                    detail=f"battery_devices[{_idx}].room must be a string when present",
                )
        _seen_devices = [str(x.get("device")) for x in guard_incoming]
        if len(_seen_devices) != len(set(_seen_devices)):
            raise HTTPException(
                status_code=400,
                detail="battery_devices entries must have a unique device per entry",
            )

    # INSTRUCTION-192: pre-write snapshot. SourceMissingError is treated
    # as fatal here — patch_config_section requires an existing qsh.yaml
    # (the section being patched lives in it). Other failures abort the
    # write so the operator's recovery path is preserved.
    from qsh.api.snapshots import (
        snapshot_capture,
        SnapshotCaptureError,
        SourceMissingError,
    )
    try:
        # Pass the resolved YAML path so the snapshot captures the same
        # file read_modify_write is about to mutate (the YAML search
        # list returns the same path the write will hit).
        snapshot_capture(
            trigger_path="settings_patch",
            source_path=_find_yaml_path(),
        )
    except SourceMissingError as exc:
        logger.error(
            "module=config_snapshot event=capture_failed trigger_path=settings_patch error=%r",
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Configuration snapshot failed (source missing); write aborted.",
        ) from exc
    except SnapshotCaptureError as exc:
        logger.error(
            "module=config_snapshot event=capture_failed trigger_path=settings_patch error=%r",
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Configuration snapshot failed; write aborted to preserve recoverability.",
        ) from exc

    incoming = body.get("data", body) if isinstance(body, dict) else body

    # INSTRUCTION-305: reject an unbootable fixed-without-rate energy config at
    # the route BEFORE read_modify_write and BEFORE the restart-flag write, so
    # the Settings save path can never persist a config that crash-loops on
    # restart. This is the backend correctness boundary; the 304 frontend seed
    # is the UX convenience. Validates electricity AND gas (lpg/oil default at
    # runtime). The 422 detail shape matches deploy_config (wizard.py) so API
    # clients see one validation-error contract across both write entry points.
    if section == "energy" and isinstance(incoming, dict):
        from qsh.tariff import validate_energy_fixed_rate

        _energy_errors = validate_energy_fixed_rate(incoming)
        if _energy_errors:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Config validation failed",
                    "errors": _energy_errors,
                },
            )

    # "root" section merges individual keys at the YAML root level
    # (e.g. publish_mqtt_shadow, flow_min_internal)
    if section == "root":
        _ROOT_ALLOWED = {
            "publish_mqtt_shadow",
            "mqtt_legacy_shadow_topics",
            "flow_min_internal",
            "flow_max_internal",
            "pid_target_internal",
            "flow_writes_per_hour",
            "mode_writes_per_hour",
            # INSTRUCTION-327 — Settings → System schedule-timezone field.
            "schedule_timezone",
            # INSTRUCTION-369 — building-class metadata, surfaced for
            # post-setup edit in the Rooms-settings Property box. Captured
            # at first-run by 368's wizard StepBuilding; this is the ongoing
            # edit path. Top-level scalars, recognised + soft-validated by the
            # 368 config loader (_resolve_building_class). Soft on both layers:
            # no range/enum 4xx here — an out-of-band year is warn-and-unset at
            # load, and the material select only emits valid §3.5 values.
            "construction_year",
            "fabric_class",
        }

        def _apply_root(raw: dict) -> dict:
            if isinstance(incoming, dict):
                for key, value in incoming.items():
                    if key in _ROOT_ALLOWED:
                        # Range-validate writes-per-hour keys before persisting.
                        if key in ("flow_writes_per_hour", "mode_writes_per_hour"):
                            if not isinstance(value, int) or value < 3 or value > 6:
                                raise HTTPException(
                                    status_code=422,
                                    detail=f"{key} must be an integer in [3, 6], got {value!r}",
                                )
                        # INSTRUCTION-327 — schedule_timezone: validate the
                        # IANA name before persisting. The in-memory write
                        # below feeds qsh/utils.py:_config_time_zone within
                        # the 300 s TTL, and the runtime arm catches
                        # ZoneInfoNotFoundError ONLY — a malformed key would
                        # raise ValueError on every re-resolution. Interactive
                        # write → reject with 422 (the boot path's equivalent
                        # is warn-and-don't-carry in _build_house_config).
                        # Blank/null clears the key (= automatic resolution:
                        # Supervisor → TZ env → UTC).
                        if key == "schedule_timezone":
                            if value is None or (
                                isinstance(value, str) and not value.strip()
                            ):
                                raw.pop(key, None)
                                config = shared_state.get_config()
                                if config is not None:
                                    config.pop(key, None)
                                continue
                            if not isinstance(value, str):
                                raise HTTPException(
                                    status_code=422,
                                    detail=f"schedule_timezone must be a string, got {value!r}",
                                )
                            value = value.strip()
                            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
                            try:
                                ZoneInfo(value)
                            except (ZoneInfoNotFoundError, ValueError):
                                raise HTTPException(
                                    status_code=422,
                                    detail=(
                                        f"schedule_timezone {value!r} is not a valid "
                                        f"IANA zone name (example: Europe/London)"
                                    ),
                                )
                        # INSTRUCTION-369 — building-class clear path. A
                        # blank/null construction_year or fabric_class pops the
                        # key (mirrors schedule_timezone above). Required because
                        # the root merge otherwise preserves the prior value when
                        # a field is cleared — emptying the year / picking
                        # "Not set" would not unset without this. No 4xx: the
                        # year stays soft (368 loader warn-and-unset), the
                        # material select only emits valid §3.5 values.
                        if key in ("construction_year", "fabric_class"):
                            if value is None or (
                                isinstance(value, str) and not value.strip()
                            ):
                                raw.pop(key, None)
                                config = shared_state.get_config()
                                if config is not None:
                                    config.pop(key, None)
                                continue
                        raw[key] = value
                        # Also update in-memory config
                        config = shared_state.get_config()
                        if config is not None:
                            config[key] = value
                        # Hot-reload the live debouncer for writes-per-hour keys.
                        if key == "flow_writes_per_hour":
                            debouncer = shared_state.get_debouncer()
                            if debouncer is not None:
                                debouncer.set_flow_debounce_time(3600.0 / value)
                        elif key == "mode_writes_per_hour":
                            debouncer = shared_state.get_debouncer()
                            if debouncer is not None:
                                debouncer.set_mode_debounce_time(3600.0 / value)
                    else:
                        logger.info(
                            "config/root: dropping unknown key '%s' (not in _ROOT_ALLOWED)",
                            key,
                        )
            return raw

        read_modify_write(_apply_root)
        return {
            "updated": "root",
            "restart_required": False,
            "message": "Root config keys updated",
        }

    def _apply_patch(raw: dict) -> dict:
        existing_section = raw.get(section, {})
        # INSTRUCTION-411 D9: preserve EVERY unsubmitted energy.* sub-block, not
        # just the legacy `octopus` block (which is what 158A Task 2 preserved).
        # The frontend sends electricity/gas/fallback_rates only; an API caller
        # may send a partial energy payload. Without this, restore_redacted_energy's
        # full-section overwrite drops any on-disk sub-block absent from the
        # incoming payload (the 378-class block-drop) — stranding another fuel's
        # config and, upstream of the strip, defeating any strip-side recovery.
        # Preserving all unsubmitted sub-blocks means restore_redacted_energy
        # processes the fuller section unchanged and _migrate_on_save_strip_legacy
        # reasons about the COMPLETE on-disk energy. Legacy `octopus` remains
        # covered as the k == "octopus" case. (Block DELETION is out of band —
        # delete_config_section handles that.)
        local_incoming = incoming
        if (
            section == "energy"
            and isinstance(local_incoming, dict)
            and isinstance(existing_section, dict)
        ):
            preserved = dict(local_incoming)
            for key, value in existing_section.items():
                if key not in preserved:
                    preserved[key] = copy.deepcopy(value)
            local_incoming = preserved
        # Restore redacted fields so secrets aren't overwritten with the sentinel
        if section == "energy" and isinstance(existing_section, dict) and isinstance(local_incoming, dict):
            raw[section] = restore_redacted_energy(existing_section, local_incoming)
        elif isinstance(existing_section, dict) and isinstance(local_incoming, dict):
            raw[section] = restore_redacted(existing_section, local_incoming)
        else:
            raw[section] = local_incoming
        # INSTRUCTION-237A Task 1b: server-authoritative singular/plural
        # reconciliation for heat_sources. Mirror to singular when only one
        # source; strip the stale singular when 2+. Atomic within this
        # read_modify_write block.
        if section == "heat_sources" and isinstance(local_incoming, list):
            if len(local_incoming) == 1:
                # Singular mirror — preserves back-compat for any code path that
                # still reads raw["heat_source"] (validation at config.py:2053,
                # legacy callers).
                # INSTRUCTION-378: re-merge the DHW signal-source keys the plural
                # payload intentionally strips (236). raw.get("heat_source") here
                # is the pre-overwrite on-disk singular — the sole DHW store. The
                # deepcopy prevents aliasing local_incoming[0] (keeps the plural
                # primary DHW-stripped).
                mirrored = copy.deepcopy(local_incoming[0])
                preserve_singular_dhw_sensors(raw.get("heat_source") or {}, mirrored)
                raw["heat_source"] = mirrored
                # V2 G-N5: N→1 transition cleanup. Symmetric with the 1→N
                # singular strip below — source_selection becomes inert when
                # only one source remains; leaving it on disk is the same class
                # of stale-block hazard as a stale singular.
                raw.pop("source_selection", None)
            else:
                # len >= 2: strip the stale singular block. Verified at
                # config.py:2041 that singular→plural normalisation is skipped
                # when both keys are present, so the stale singular would persist
                # forever without this strip and trip _validate_heat_source.
                raw.pop("heat_source", None)
        # On-disk YAML hygiene for entity/topic fields. Runtime safety is already
        # provided by Task 1's .strip() at config-load — this block exists so the
        # persisted YAML matches what the runtime sees, GET-after-PATCH returns a
        # clean round-trip, and backups archive a normalised value. Without this,
        # the file remains harmlessly dirty (runtime works, manual cat shows the
        # trailing space). Scope: control section only — other sections have
        # different rules and will be hardened in a separate instruction if and
        # when the same class of bug surfaces there.
        if section == "control" and isinstance(raw[section], dict):
            for key, value in list(raw[section].items()):
                if isinstance(value, str) and (key.endswith("_entity") or key.endswith("_topic")):
                    raw[section][key] = value.strip()
        # INSTRUCTION-411 (was 150C V5 E-M5): copy-forward-then-strip legacy
        # tariff migration. `raw` now carries the COMPLETE on-disk energy (D9
        # preserve above), so the fill / declare / consumer-gate reason about all
        # fuels; the gating payload is the SUBMITTED energy (`incoming`, not
        # `raw["energy"]`) so a single-fuel save migrates only the fuel it
        # touched (partial migration is intended — QG6).
        if section == "energy" and isinstance(raw.get("energy"), dict):
            raw = _migrate_on_save_strip_legacy(raw, {"energy": incoming})
        return raw

    read_modify_write(_apply_patch)

    # Always restart to adopt changes
    try:
        with open("/config/qsh_restart_requested", "w") as f:
            f.write("1")
    except OSError:
        pass

    return {
        "updated": section,
        "restart_required": True,
        "message": f"Section '{section}' updated — pipeline restarting",
    }


@router.delete("/config/{section}")
def delete_config_section(section: str):
    """Remove an optional section from qsh.yaml entirely."""
    deletable_sections = {
        "solar",
        "battery",
        "grid",
        "inverter",
        "hw_plan",
        "hw_schedule",
        "hw_tank",
        "hw_precharge",
        "historian",
    }
    if section not in deletable_sections:
        raise HTTPException(
            status_code=400,
            detail=f"Section '{section}' cannot be deleted (required or non-deletable)",
        )

    removed: list = [None]  # mutable container for closure write-back

    def _apply_delete(raw: dict) -> dict:
        removed[0] = raw.pop(section, None)
        return raw

    read_modify_write(_apply_delete)
    was_present = removed[0] is not None

    if not was_present:
        return {"deleted": section, "was_present": False}

    structural = {"hw_plan", "hw_schedule", "hw_tank", "hw_precharge"}
    needs_restart = section in structural

    if needs_restart:
        try:
            with open("/config/qsh_restart_requested", "w") as f:
                f.write("1")
        except OSError:
            pass

    return {
        "deleted": section,
        "was_present": True,
        "restart_required": needs_restart,
    }


class InfluxTestRequest(BaseModel):
    host: str
    port: int = 8086
    database: str = "qsh"
    username: str = ""
    password: str = ""


@router.post("/config/test-influxdb")
def test_influxdb(req: InfluxTestRequest):
    """Test InfluxDB connectivity and database existence."""
    # If password is redacted, load real one from YAML
    if req.password == REDACTED_SENTINEL:
        raw = _load_raw_yaml() or {}
        req.password = raw.get("historian", {}).get("password", "")

    try:
        from influxdb import InfluxDBClient

        client = InfluxDBClient(
            host=req.host,
            port=req.port,
            username=req.username,
            password=req.password,
            timeout=5,
        )
        dbs = [d["name"] for d in client.get_list_database()]
        if req.database not in dbs:
            return {
                "success": False,
                "message": f"Connected but database '{req.database}' not found. "
                f"Available: {', '.join(dbs)}",
            }
        return {
            "success": True,
            "message": f"Connected. Database '{req.database}' exists.",
        }
    except ImportError:
        return {"success": False, "message": "influxdb Python package not installed"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {e}"}


def _redact_config(config: dict) -> dict:
    """Remove API keys and credentials from config for safe exposure."""
    c = copy.deepcopy(config)
    _redact_recursive(c)
    return c


def _redact_recursive(obj, depth=0):
    if depth > 10:
        return
    if isinstance(obj, dict):
        for k in obj:
            if any(s in k.lower() for s in ("key", "secret", "token", "password")):
                if isinstance(obj[k], str) and obj[k]:
                    obj[k] = REDACTED_SENTINEL
            else:
                _redact_recursive(obj[k], depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _redact_recursive(item, depth + 1)
