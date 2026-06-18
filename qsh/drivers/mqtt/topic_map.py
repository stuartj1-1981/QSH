"""Topic <-> InputBlock/OutputBlock field mapping for the MQTT driver.

Builds subscription lists and field mappings from QSH config.
Handles plain and JSON payload parsing for both numeric and string fields.

INSTRUCTION-220C scope clarification (12 May 2026): topic_map services
**InputBlock-bound topics only** — topics whose payloads populate fields
on the per-cycle InputBlock dataclass (room temps, valve positions,
outdoor temp, hot-water state, etc.). Subscribe-only topics — topics
that QSH subscribes to but does NOT route into InputBlock — are NOT
registered through topic_map. They are added inline to MQTTDriver.setup()'s
subscription set via direct extension of all_topics before
self._mqtt.subscribe() is called.

INSTRUCTION-345 (17 June 2026): the subscribe-only exclusion is now
*implemented* via `SUBSCRIBE_ONLY_INPUT_KEYS` (a frozenset declared after
`_FIELD_CATEGORY_INFERENCE`). Keys in that set are skipped in the
`mqtt.inputs` loop — they never produce an InputBlock mapping and never
enter the signal-quality monitor. The forecast topic is the founding
member; future subscribe-only topics are added there.

`mqtt.inputs` keys that are neither in `SYSTEM_INPUT_FIELDS` /
`SYSTEM_STRING_INPUT_FIELDS` nor in `SUBSCRIBE_ONLY_INPUT_KEYS` are
skipped with a one-time config-load WARNING naming the key. Previously
they silently produced a phantom `_shadow_<key>` field tracked by the
signal-quality monitor under the 90/300 `default` category, generating
spurious stale/unavailable transitions for slow-cadence topics.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── Per-category default freshness thresholds (seconds) ─────────────────────
# These replace the previous hardcoded 90 s / 300 s module constants.
# See INSTRUCTION-92 for the rationale: battery Zigbee environmental sensors
# use hourly heartbeats, so the default `temperature`/`humidity` categories
# are sized generously. Mains-powered fast-reporting sensors fall under
# `power`/`energy`/`default` with tighter thresholds.
BUILTIN_STALENESS_DEFAULTS: Dict[str, Dict[str, int]] = {
    "temperature": {"fresh": 7200, "unavailable": 14400},
    "humidity":    {"fresh": 7200, "unavailable": 14400},
    "valve":       {"fresh": 3600, "unavailable": 7200},
    "power":       {"fresh": 180,  "unavailable": 600},
    "energy":      {"fresh": 300,  "unavailable": 900},
    "outdoor":     {"fresh": 1800, "unavailable": 3600},
    "default":     {"fresh": 90,   "unavailable": 300},
}


# ── Category inference table ─────────────────────────────────────────────────
# Maps InputBlock field names and common mapping keys to a staleness category.
# Convenience for the usual QSH fields; users must set `category:` explicitly
# for non-standard fields (humidity, CO₂, lux, pressure, etc.) on battery
# devices to avoid the 90/300 `default` fallback.
_FIELD_CATEGORY_INFERENCE: Dict[str, str] = {
    # Temperatures
    "outdoor_temp": "outdoor",
    "room_temp": "temperature",
    "hp_flow_temp": "temperature",
    "hp_return_temp": "temperature",
    # Valves
    "valve_position": "valve",
    # Power / energy
    "hp_power": "power",
    "grid_power": "power",
    "hp_cop": "power",
    "solar_production": "energy",
    "battery_soc": "energy",
}


# ── Subscribe-only mqtt.inputs keys (single source of truth) ─────────────────
# Topics QSH subscribes to but does NOT route into the per-cycle InputBlock.
# They are consumed via a dedicated provider/Protocol path and subscribed
# explicitly in the driver setup(), so they MUST NOT be registered as InputBlock
# mappings here. Registering one creates a phantom `_shadow_<key>` field that the
# signal-quality monitor tracks under the 90/300 `default` category, emitting
# spurious stale/unavailable transitions for slow-cadence topics (forecast
# publishes every ~20 min). This is the structural form of the exclusion the
# module docstring describes (S-4 option (a), now implemented — INSTRUCTION-345).
#
#   forecast → MQTTForecastProvider, via entities.forecast_mqtt_topic,
#              subscribed inline in MQTTDriver.setup() (driver.py:391-403).
#
# To add a subscribe-only topic: add its mqtt.inputs key here AND wire its
# subscription in the driver setup(). topic_map then correctly leaves it out of
# the InputBlock signal-quality pipeline. INSTRUCTION-345.
SUBSCRIBE_ONLY_INPUT_KEYS: frozenset = frozenset({"forecast"})


@dataclass
class AvailabilitySpec:
    """Publisher-provided availability topic for a mapping.

    `topic` is fully-qualified (prefix applied by build_topic_map).
    `online_match` is a small expression evaluated by evaluate_availability_match.
    """

    topic: str
    online_match: str


@dataclass
class LastSeenSpec:
    """Publisher-provided `last_seen` timestamp path for a mapping."""

    json_path: str
    format: str = "iso8601"  # "iso8601" | "epoch_s" | "epoch_ms"


@dataclass
class TopicMapping:
    """Single MQTT topic → field mapping."""

    topic: str                      # Full MQTT topic (prefix already applied)
    field: str                      # InputBlock field name, e.g. "outdoor_temp"
    room: Optional[str] = None      # Room name for per-room fields, None for system
    payload_format: str = "plain"   # "plain" or "json"
    json_path: Optional[str] = None  # Dot-notation path for JSON payloads
    category: str = "default"       # Staleness category (see BUILTIN_STALENESS_DEFAULTS)
    availability: Optional[AvailabilitySpec] = None
    last_seen: Optional[LastSeenSpec] = None
    # INSTRUCTION-224C: emitter stem for per-emitter fields (valve_position).
    # None for non-per-emitter fields (room_temp, occupancy_sensor, system).
    emitter: Optional[str] = None


@dataclass
class OutputMapping:
    """OutputBlock field → MQTT topic mapping."""

    topic: str
    field: str
    room: Optional[str] = None


class TopicMap:
    """Bi-directional topic ↔ field mapping built from config."""

    def __init__(self) -> None:
        self.input_mappings: List[TopicMapping] = []
        self.output_mappings: List[OutputMapping] = []
        self.away_topic: Optional[str] = None
        self.staleness_defaults: Dict[str, Dict[str, int]] = {}

    @property
    def subscribe_topics(self) -> List[str]:
        """All topics the driver needs to subscribe to.

        Unions value-topic, away-topic, and all distinct availability topics.
        """
        topics: List[str] = [m.topic for m in self.input_mappings]
        if self.away_topic:
            topics.append(self.away_topic)
        for m in self.input_mappings:
            if m.availability and m.availability.topic:
                topics.append(m.availability.topic)
        # Dedupe while preserving order.
        seen: set[str] = set()
        unique: List[str] = []
        for t in topics:
            if t not in seen:
                seen.add(t)
                unique.append(t)
        return unique

    def get_input_mapping(self, topic: str) -> Optional[TopicMapping]:
        """Find input mapping for a given topic."""
        for m in self.input_mappings:
            if m.topic == topic:
                return m
        return None


def _prefixed(prefix: str, topic: str) -> str:
    """Apply topic prefix: full_topic = f"{prefix}/{topic}" if prefix else topic."""
    if prefix:
        return f"{prefix}/{topic}"
    return topic


def _normalise_topic_field(value: Any) -> List[str]:
    """Normalise a per-room topic-field value (str or list[str]) to list[str].

    INSTRUCTION-222B contract: empty / whitespace-only entries RAISE
    ValueError at the parser (single rule with the validator at
    validate_yaml.py; whichever runs first catches it). Non-string
    elements raise. Empty literal list raises (no derivation fallback
    on the MQTT side — operator must declare a topic explicitly).
    """
    if isinstance(value, str):
        v = value.strip()
        if not v:
            raise ValueError("topic string is empty or whitespace-only")
        return [v]
    if isinstance(value, list):
        if not value:
            raise ValueError("topic list is empty — omit field or provide at least one topic")
        out: List[str] = []
        for i, item in enumerate(value):
            if not isinstance(item, str):
                raise ValueError(
                    f"topic list entry [{i}] must be a string, got {type(item).__name__}: {item!r}"
                )
            s = item.strip()
            if not s:
                raise ValueError(
                    f"topic list entry [{i}] is empty or whitespace-only"
                )
            out.append(s)
        return out
    raise ValueError(
        f"topic field must be a string or list of strings, got {type(value).__name__}"
    )


def _mqtt_emitter_stem(topic: str) -> str:
    """Derive emitter stem from an MQTT topic — terminal path component, sanitised.

    INSTRUCTION-224C: the stem is the last path component of the topic with all
    non-alphanumeric characters replaced by underscores and the result lowercased.
    The operator controls the outcome via topic structure. Duplicate stems within
    a room are rejected at config-load by the validator (validate_yaml.py); the
    helper itself does no special-case suffix handling.
    """
    terminal = topic.rstrip("/").split("/")[-1]
    return "".join(c if c.isalnum() else "_" for c in terminal).lower()


def parse_payload(payload_str: str, fmt: str = "plain", json_path: Optional[str] = None) -> Optional[float]:
    """Parse MQTT payload to float.

    Plain: float(payload_str) with try/except → None on failure.
    JSON: json.loads → traverse json_path dot-separated → float() the leaf → None on failure.
    """
    if fmt == "json" and json_path:
        try:
            obj = json.loads(payload_str)
            for key in json_path.split("."):
                obj = obj[key]
            return float(obj)
        except (json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError):
            return None
    else:
        try:
            return float(payload_str)
        except (ValueError, TypeError):
            return None


def parse_payload_string(
    payload_str: Optional[str],
    fmt: str = "plain",
    json_path: Optional[str] = None,
) -> Optional[str]:
    """Parse MQTT payload to a string, honouring format/json_path.

    Plain: returns payload_str unchanged. Caller is responsible for
        any case-folding or whitespace normalisation appropriate to the
        downstream classifier.
    JSON:  extracts the leaf at json_path via extract_json_value(...),
        then str()-coerces the result. Returns None if the JSON cannot
        be parsed or the path does not resolve.

    Mirrors parse_payload (numeric) so string and numeric fields share
    identical format/json_path semantics. Contract: never raises.
    """
    if payload_str is None:
        return None
    if fmt == "json" and json_path:
        leaf = extract_json_value(payload_str, json_path)
        if leaf is None:
            return None
        return str(leaf)
    return payload_str


def parse_payload_str(payload_str: str) -> str:
    """Return raw payload as string (for mode_state, away, etc.)."""
    return payload_str.strip()


# ── Freshness helpers ────────────────────────────────────────────────────────


def parse_timestamp(value: Any, fmt: str) -> Optional[float]:
    """Parse a timestamp value from a payload into a Unix epoch float.

    Returns None on any parse failure. Contract: never raises.

    Supported formats:
      - "iso8601": strings like "2026-04-15T07:19:42.000Z" or "2026-04-15T07:19:42+00:00"
      - "epoch_s": numeric seconds since epoch (int or float or numeric string)
      - "epoch_ms": numeric milliseconds since epoch
    """
    if value is None:
        return None
    try:
        if fmt == "iso8601":
            if not isinstance(value, str):
                return None
            s = value.strip()
            # datetime.fromisoformat() on Python 3.10 doesn't accept trailing "Z";
            # 3.11+ does. Strip to be safe across versions.
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            dt = datetime.fromisoformat(s)
            return dt.timestamp()
        if fmt == "epoch_s":
            return float(value)
        if fmt == "epoch_ms":
            return float(value) / 1000.0
        return None
    except (ValueError, TypeError, AttributeError):
        return None


def extract_json_value(payload_str: str, json_path: str) -> Any:
    """Traverse a JSON payload by dot-notation path; return raw value or None on failure.

    Contract: never raises. Accepts arbitrary leaf types (str, int, float, bool, None).
    """
    if payload_str is None or json_path is None:
        return None
    try:
        obj = json.loads(payload_str)
        for key in json_path.split("."):
            if isinstance(obj, dict):
                if key not in obj:
                    return None
                obj = obj[key]
            else:
                return None
        return obj
    except (json.JSONDecodeError, KeyError, IndexError, TypeError, AttributeError):
        return None


def _strip_quotes(s: str) -> str:
    """Strip a single pair of surrounding single or double quotes from s."""
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        return s[1:-1]
    return s


def evaluate_availability_match(payload_str: str, match_expr: str) -> Optional[bool]:
    """Evaluate an availability match expression against a payload.

    Returns True (online), False (offline), or None (cannot determine).

    Supported expression forms:
      - 'payload == "<value>"'      — exact match against raw payload
      - 'payload != "<value>"'      — negated exact match
      - '$.<path> == "<value>"'     — JSONPath match against extracted value
      - '$.<path> != "<value>"'     — negated JSONPath match

    No eval(), no exec(). Parses the expression into (lhs, op, rhs) tuples.
    Contract: never raises.
    """
    if payload_str is None or match_expr is None:
        return None
    try:
        expr = match_expr.strip()
        # Tokenise on the first " == " or " != " — note the surrounding spaces
        # keep the check unambiguous when the RHS contains == characters.
        if " == " in expr:
            lhs, rhs = expr.split(" == ", 1)
            negate = False
        elif " != " in expr:
            lhs, rhs = expr.split(" != ", 1)
            negate = True
        else:
            return None

        lhs = lhs.strip()
        rhs_expected = _strip_quotes(rhs)

        # LHS may reference the raw payload or a JSON path.
        if lhs == "payload":
            actual = payload_str.strip()
            # Raw payloads may be quoted in the wire format but conventions
            # like Tasmota just send "Online" / "Offline".  Strip the
            # surrounding quotes if present so ``payload == "Online"`` matches.
            actual = _strip_quotes(actual)
        elif lhs.startswith("$."):
            json_path = lhs[2:]
            raw = extract_json_value(payload_str, json_path)
            if raw is None:
                return None
            # Compare as string so expressions stay uniform; ``True``/``1``
            # edge cases rarely matter for availability semantics.
            if isinstance(raw, bool):
                actual = "true" if raw else "false"
            else:
                actual = str(raw)
        else:
            return None

        matched = (actual == rhs_expected)
        return (not matched) if negate else matched
    except (ValueError, TypeError, AttributeError):
        return None


def infer_category(field_name: str, mapping_key: Optional[str] = None) -> str:
    """Infer a staleness category from an InputBlock field or mapping key.

    Falls back to "default" (90/300) for unrecognised fields. Users must
    set `category:` explicitly on the mapping for non-standard battery
    sensors (humidity, CO₂, lux, pressure, etc.) — the fallback to
    "default" is safe for mains-powered fast-reporting sensors but will
    spuriously stale battery devices.
    """
    if mapping_key and mapping_key in _FIELD_CATEGORY_INFERENCE:
        return _FIELD_CATEGORY_INFERENCE[mapping_key]
    if field_name in _FIELD_CATEGORY_INFERENCE:
        return _FIELD_CATEGORY_INFERENCE[field_name]
    # Strip "_shadow_" prefix for system inputs like hp_heat_output.
    if field_name.startswith("_shadow_"):
        stripped = field_name[len("_shadow_"):]
        if stripped in _FIELD_CATEGORY_INFERENCE:
            return _FIELD_CATEGORY_INFERENCE[stripped]
    return "default"


def _merge_staleness_defaults(user_defaults: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    """Merge user-supplied mqtt.staleness_defaults over the built-ins.

    User values win per-category; categories absent from the user config
    keep the built-in defaults. The "default" category is always present.
    """
    merged: Dict[str, Dict[str, int]] = {
        cat: dict(vals) for cat, vals in BUILTIN_STALENESS_DEFAULTS.items()
    }
    if not isinstance(user_defaults, dict):
        return merged
    for category, vals in user_defaults.items():
        if not isinstance(vals, dict):
            continue
        base = merged.get(category, dict(merged["default"]))
        if "fresh" in vals:
            try:
                base["fresh"] = int(vals["fresh"])
            except (TypeError, ValueError):
                pass
        if "unavailable" in vals:
            try:
                base["unavailable"] = int(vals["unavailable"])
            except (TypeError, ValueError):
                pass
        merged[category] = base
    return merged


def _build_availability_spec(
    raw: Any, prefix: str
) -> Optional[AvailabilitySpec]:
    """Construct an AvailabilitySpec from a config dict, or None if invalid."""
    if not isinstance(raw, dict):
        return None
    topic = raw.get("topic")
    online_match = raw.get("online_match")
    if not topic or not online_match:
        return None
    return AvailabilitySpec(
        topic=_prefixed(prefix, str(topic)),
        online_match=str(online_match),
    )


def _build_last_seen_spec(raw: Any) -> Optional[LastSeenSpec]:
    """Construct a LastSeenSpec from a config dict, or None if invalid."""
    if not isinstance(raw, dict):
        return None
    json_path = raw.get("json_path")
    if not json_path:
        return None
    fmt = raw.get("format", "iso8601")
    return LastSeenSpec(json_path=str(json_path), format=str(fmt))


# ── Input field mapping: config key → InputBlock field ──────────────

SYSTEM_INPUT_FIELDS = {
    "outdoor_temp": "outdoor_temp",
    "hp_flow_temp": "hp_flow_temp",
    "hp_return_temp": "hp_return_temp",
    "hp_power": "hp_power",
    "hp_cop": "hp_cop",
    "hp_heat_output": "_shadow_hp_heat_output",   # store in shadow
    "hp_mode_state": "_shadow_hp_mode_state",      # store in shadow
    "solar_production": "solar_production",
    "grid_power": "grid_power",
    "battery_soc": "battery_soc",
    "flow_rate": "flow_rate",
    # INSTRUCTION-246 Task 7 — boiler fuel-input kW. Routed generically by
    # the driver (qsh/drivers/mqtt/driver.py:535) via SYSTEM_INPUT_FIELDS
    # iteration; the capability flag below pairs with it.
    "boiler_power_input": "boiler_power_input",
}

# System-level fields whose payload is a raw string (boolean/enum), NOT a number.
# These are parsed outside the numeric `parse_payload` path — see driver.read_inputs.
SYSTEM_STRING_INPUT_FIELDS = {
    "hot_water_active": "hot_water_active",
    "hot_water_boolean": "hot_water_boolean",
}

# Fields that indicate capabilities when received.
# Hot-water capability ("has_live_hot_water") is intentionally NOT registered
# here — it is written exactly once, post-loop, in driver.read_inputs using
# the shared three-valued classifier (see qsh/drivers/hot_water_payloads.py
# and INSTRUCTION-126). Registering it here would re-fire the write inside
# the per-mapping loop on UNAVAILABLE payloads and re-introduce the V2
# signal-quality bug.
CAPABILITY_FIELDS = {
    "hp_flow_temp": "has_live_flow",
    "hp_cop": "has_live_cop",
    "hp_power": "has_live_power",
    "hp_return_temp": "has_live_return_temp",
    "flow_rate": "has_live_flow_rate",
    "solar_production": "has_solar",
    "battery_soc": "has_battery",
    # INSTRUCTION-246 Task 7 — pairs with boiler_power_input above. Driver
    # iterates CAPABILITY_FIELDS at qsh/drivers/mqtt/driver.py:632-633.
    "boiler_power_input": "has_live_boiler_power",
}


# Static system-level control topics (no config dependency).
# Per-room topics require config and are built by get_control_topics().
_SYSTEM_CONTROL_TOPICS = [
    "control/away",
    "control/away_days",
    "control/dfan_control",
    "control/flow_min",
    "control/flow_max",
    "control/comfort_temp",
]


def _slug(name: str) -> str:
    """228A Task 8 — slugify a heat-source name for MQTT topic placement.

    Lowercase; runs of non-alphanumeric characters collapsed to one underscore;
    strip leading/trailing underscores. Returns 'source' for an input that
    slugifies to empty (e.g. '---').
    """
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or "source"


def command_topic_for_source(
    source_config: Dict[str, Any],
    default_prefix: str = "qsh/heat_source",
) -> str:
    """228A Task 8 — resolve the MQTT command topic for one heat source.

    Override: ``source_config['mqtt']['command_topic']`` used verbatim if
    present.
    Default: ``f"{default_prefix}/{_slug(source_config['name'])}/command"``.
    """
    override = (source_config.get("mqtt") or {}).get("command_topic")
    if override:
        return override
    return f"{default_prefix}/{_slug(source_config.get('name', ''))}/command"


def get_control_topics(config: Dict[str, Any]) -> list:
    """Build full control topic list including per-room topics.

    Called from MqttDriver.setup(), NOT at import time.  Per-room topics
    depend on config which is not available at module import time.
    Returned topics do NOT include the topic prefix — the caller applies it.
    """
    topics = list(_SYSTEM_CONTROL_TOPICS)
    for room in config.get("rooms", {}):
        topics.append(f"control/{room}/away")
        topics.append(f"control/{room}/away_days")
        topics.append(f"control/{room}/comfort_temp")
    return topics


def build_topic_map(config: Dict[str, Any]) -> TopicMap:
    """Build TopicMap from QSH config dict.

    Reads:
      - config["mqtt"]["inputs"] for system input topics
      - config["mqtt"]["outputs"] for system output topics
      - config["room_mqtt_topics"][room] for per-room topics
      - config["mqtt"]["topic_prefix"] for prefix
      - config["heat_sources"][i]["sensors"] for per-source topics
        (INSTRUCTION-241A Task 4)
    """
    tm = TopicMap()
    mqtt_cfg = config.get("mqtt", {})
    prefix = mqtt_cfg.get("topic_prefix", "")

    # ── Resolve staleness defaults (built-ins merged with user overrides) ──
    tm.staleness_defaults = _merge_staleness_defaults(
        mqtt_cfg.get("staleness_defaults", {}) or {}
    )

    # ── L1 disposition (INSTRUCTION-241A V2 Task 4) — when heat_sources[0]
    # provides a per-source topic for a slot covered by legacy mqtt.inputs.hp_*,
    # skip the legacy mapping to avoid double-subscription. Legacy retained
    # as fallback when the per-source slot is absent (partial migrations).
    _LEGACY_TO_PER_SOURCE_SLOT = {
        "hp_flow_temp":   "flow_temp",
        "hp_power":       "power_input",
        "hp_cop":         "cop",
        "hp_return_temp": "return_temp",
        "hp_flow_rate":   "flow_rate",
        "hp_heat_output": "heat_output",
        "hp_total_energy": "total_energy",
        "hp_delta_t":     "delta_t",
    }

    sources = config.get("heat_sources", []) or []
    per_source_covered_slots: set = set()
    if sources:
        primary_sensors = (sources[0].get("sensors") or {})
        for legacy_key, per_source_key in _LEGACY_TO_PER_SOURCE_SLOT.items():
            entry = primary_sensors.get(per_source_key)
            topic = entry.get("topic") if isinstance(entry, dict) else entry
            if topic:
                per_source_covered_slots.add(legacy_key)

    # ── System input topics ──
    inputs = mqtt_cfg.get("inputs", {})
    for config_key, topic_cfg in inputs.items():
        if config_key in SUBSCRIBE_ONLY_INPUT_KEYS:
            # Subscribe-only — consumed by a provider and subscribed inline in
            # MQTTDriver.setup(); never an InputBlock mapping. INSTRUCTION-345.
            continue

        if config_key in per_source_covered_slots:
            logger.debug(
                "L1: skipping legacy mqtt.inputs.%s — covered by per-source "
                "heat_sources[0].sensors.%s",
                config_key, _LEGACY_TO_PER_SOURCE_SLOT[config_key],
            )
            continue

        if isinstance(topic_cfg, dict):
            raw_topic = topic_cfg.get("topic", "")
            fmt = topic_cfg.get("format", "plain")
            jp = topic_cfg.get("json_path")
            category = topic_cfg.get("category")
            availability = _build_availability_spec(topic_cfg.get("availability"), prefix)
            last_seen = _build_last_seen_spec(topic_cfg.get("last_seen"))
        else:
            # Simple string form: just the topic
            raw_topic = str(topic_cfg)
            fmt = "plain"
            jp = None
            category = None
            availability = None
            last_seen = None

        if not raw_topic:
            continue

        ib_field = SYSTEM_INPUT_FIELDS.get(
            config_key,
            SYSTEM_STRING_INPUT_FIELDS.get(config_key),
        )
        if ib_field is None:
            # Not a recognised InputBlock field and not a declared subscribe-only
            # topic. Historically this silently became a phantom _shadow_<key>
            # field tracked by the signal-quality monitor (INSTRUCTION-345 root
            # cause). Skip + warn at config-load so a typo or an undeclared
            # subscribe-only topic surfaces loudly instead of generating
            # per-cycle signal-quality noise.
            logger.warning(
                "mqtt.inputs.%s is not a recognised InputBlock field and is not "
                "a declared subscribe-only topic %s; ignoring it. If it is "
                "subscribe-only, add it to SUBSCRIBE_ONLY_INPUT_KEYS and wire its "
                "subscription in the driver setup(); if it should populate the "
                "InputBlock, add it to SYSTEM_INPUT_FIELDS / "
                "SYSTEM_STRING_INPUT_FIELDS.",
                config_key, sorted(SUBSCRIBE_ONLY_INPUT_KEYS),
            )
            continue

        inferred_cat = category or infer_category(ib_field, config_key)
        tm.input_mappings.append(TopicMapping(
            topic=_prefixed(prefix, raw_topic),
            field=ib_field,
            room=None,
            payload_format=fmt,
            json_path=jp,
            category=inferred_cat,
            availability=availability,
            last_seen=last_seen,
        ))

    # ── Per-source heat-source topics (INSTRUCTION-241A Task 4) ──
    # For each source, for each slot with a non-empty topic, register a
    # TopicMapping using a deterministic per-source field name. The MQTT
    # driver's read_inputs routes these into inputs.heat_sources[name].<slot>.
    for source in sources:
        name = source.get("name") or "heat_source"
        sensors_block = source.get("sensors") or {}
        for slot in (
            "flow_temp", "power_input", "heat_output", "cop",
            "delta_t", "return_temp", "flow_rate",
            "total_energy", "pump_power",
        ):
            entry = sensors_block.get(slot)
            if isinstance(entry, dict):
                raw_topic = entry.get("topic", "")
                fmt = entry.get("format", "plain")
                jp = entry.get("json_path")
                category = entry.get("category")
                availability = _build_availability_spec(entry.get("availability"), prefix)
                last_seen = _build_last_seen_spec(entry.get("last_seen"))
            elif isinstance(entry, str):
                raw_topic = entry
                fmt = "plain"
                jp = None
                category = None
                availability = None
                last_seen = None
            else:
                continue

            if not raw_topic:
                continue

            field_name = f"heat_source__{name}__{slot}"
            # Slot-derived category inference: power_input/heat_output/pump_power → power
            # else default per the legacy convention.
            if category is None:
                if slot in ("power_input", "heat_output", "pump_power"):
                    category = "power"
                elif slot in ("flow_temp", "return_temp"):
                    category = "temperature"
                elif slot == "total_energy":
                    category = "energy"
                else:
                    category = "default"

            tm.input_mappings.append(TopicMapping(
                topic=_prefixed(prefix, raw_topic),
                field=field_name,
                room=None,
                payload_format=fmt,
                json_path=jp,
                category=category,
                availability=availability,
                last_seen=last_seen,
            ))

    # ── Per-room input topics ──
    room_mqtt = config.get("room_mqtt_topics", {})
    for room, topics in room_mqtt.items():
        if not isinstance(topics, dict):
            continue

        def _mapping_fields(raw_cfg: Any) -> Tuple[str, str, Optional[str], Optional[str], Optional[AvailabilitySpec], Optional[LastSeenSpec]]:
            """Extract (raw_topic, format, json_path, category, availability, last_seen)
            from a per-room topic config entry (string or dict)."""
            if isinstance(raw_cfg, dict):
                return (
                    str(raw_cfg.get("topic", "")),
                    raw_cfg.get("format", "plain"),
                    raw_cfg.get("json_path"),
                    raw_cfg.get("category"),
                    _build_availability_spec(raw_cfg.get("availability"), prefix),
                    _build_last_seen_spec(raw_cfg.get("last_seen")),
                )
            return (str(raw_cfg), "plain", None, None, None, None)

        # room_temp → room_temps[room] AND independent_sensors[room]
        if "room_temp" in topics:
            raw, fmt, jp, cat, avail, ls = _mapping_fields(topics["room_temp"])
            if raw:
                tm.input_mappings.append(TopicMapping(
                    topic=_prefixed(prefix, raw),
                    field="room_temp",
                    room=room,
                    payload_format=fmt,
                    json_path=jp,
                    category=cat or infer_category("room_temp", "room_temp"),
                    availability=avail,
                    last_seen=ls,
                ))

        # occupancy_sensor → occupancy_sensor_states[room]
        if "occupancy_sensor" in topics:
            raw, fmt, jp, cat, avail, ls = _mapping_fields(topics["occupancy_sensor"])
            if raw:
                tm.input_mappings.append(TopicMapping(
                    topic=_prefixed(prefix, raw),
                    field="occupancy_sensor",
                    room=room,
                    payload_format=fmt,
                    json_path=jp,
                    category=cat or infer_category("occupancy_sensor", "occupancy_sensor"),
                    availability=avail,
                    last_seen=ls,
                ))

        # valve_position → valve_positions[room] AND valve_positions_per_emitter
        # INSTRUCTION-224C: accept str OR list of str (mirrors 222B output-side
        # precedent). Each entry produces its own TopicMapping carrying an
        # emitter stem derived from the topic terminal component. Duplicate
        # stems within a room are rejected by validate_yaml.py at config-load.
        if "valve_position" in topics:
            raw_cfg = topics["valve_position"]
            if isinstance(raw_cfg, list):
                try:
                    normalised = _normalise_topic_field(raw_cfg)
                except ValueError as e:
                    raise ValueError(
                        f"room_mqtt_topics.{room}.valve_position: {e}"
                    ) from e
                seen_stems: Dict[str, str] = {}
                for entry in normalised:
                    stem = _mqtt_emitter_stem(entry)
                    if stem in seen_stems:
                        raise ValueError(
                            f"room_mqtt_topics.{room}.valve_position: duplicate "
                            f"emitter stem '{stem}' from topics "
                            f"['{seen_stems[stem]}', '{entry}'] — distinguish topic "
                            f"structure to produce unique terminal components"
                        )
                    seen_stems[stem] = entry
                    tm.input_mappings.append(TopicMapping(
                        topic=_prefixed(prefix, entry),
                        field="valve_position",
                        room=room,
                        payload_format="plain",
                        json_path=None,
                        category=infer_category("valve_position", "valve_position"),
                        availability=None,
                        last_seen=None,
                        emitter=stem,
                    ))
            else:
                raw, fmt, jp, cat, avail, ls = _mapping_fields(raw_cfg)
                if raw:
                    tm.input_mappings.append(TopicMapping(
                        topic=_prefixed(prefix, raw),
                        field="valve_position",
                        room=room,
                        payload_format=fmt,
                        json_path=jp,
                        category=cat or infer_category("valve_position", "valve_position"),
                        availability=avail,
                        last_seen=ls,
                        emitter=_mqtt_emitter_stem(raw),
                    ))

    # ── Away mode topic (always subscribe) ──
    tm.away_topic = _prefixed(prefix, "control/away")

    # ── Output topic mappings ──
    outputs = mqtt_cfg.get("outputs", {})
    if outputs.get("flow_temp"):
        tm.output_mappings.append(OutputMapping(
            topic=_prefixed(prefix, outputs["flow_temp"]),
            field="applied_flow",
        ))
    if outputs.get("mode"):
        tm.output_mappings.append(OutputMapping(
            topic=_prefixed(prefix, outputs["mode"]),
            field="applied_mode",
        ))
    # INSTRUCTION-280 — the dead config-output mapping for the per-source command
    # topic was removed here. Since INSTRUCTION-228A, per-source on/off commands
    # publish to command_topic_for_source(); nothing ever consumed the old MQTT
    # config-output topic mapping (write_outputs only matches applied_flow /
    # applied_mode / valve_setpoint / trv_setpoint). The internal OutputBlock
    # command signal (signal_bus.py) is a separate, live concern and is unchanged.

    # Per-room output topics
    # INSTRUCTION-222B — accept either string or list for valve_setpoint /
    # trv_setpoint. List form emits N OutputMappings, one per topic; the
    # publish loops in driver.py iterate output_mappings and fan out
    # naturally. _normalise_topic_field enforces shape (raises on empty
    # list, whitespace-only entries, non-string elements).
    for room, topics in room_mqtt.items():
        if not isinstance(topics, dict):
            continue
        for output_field in ("valve_setpoint", "trv_setpoint"):
            if output_field not in topics:
                continue
            try:
                normalised = _normalise_topic_field(topics[output_field])
            except ValueError as e:
                # Re-raise with room/field context. Top-level builder
                # invocation converts to SystemExit at config load.
                raise ValueError(
                    f"room_mqtt_topics.{room}.{output_field}: {e}"
                ) from e
            for topic in normalised:
                tm.output_mappings.append(OutputMapping(
                    topic=_prefixed(prefix, topic),
                    field=output_field,
                    room=room,
                ))

    return tm
