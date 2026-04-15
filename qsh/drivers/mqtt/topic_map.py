"""Topic ↔ InputBlock/OutputBlock field mapping for the MQTT driver.

Builds subscription lists and field mappings from QSH config.
Handles plain numeric and JSON payload parsing.
"""

from __future__ import annotations

import json
import logging
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
}

# Fields that indicate capabilities when received
CAPABILITY_FIELDS = {
    "hp_cop": "has_live_cop",
    "hp_power": "has_live_power",
    "hp_return_temp": "has_live_return_temp",
    "flow_rate": "has_live_flow_rate",
    "solar_production": "has_solar",
    "battery_soc": "has_battery",
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
    """
    tm = TopicMap()
    mqtt_cfg = config.get("mqtt", {})
    prefix = mqtt_cfg.get("topic_prefix", "")

    # ── Resolve staleness defaults (built-ins merged with user overrides) ──
    tm.staleness_defaults = _merge_staleness_defaults(
        mqtt_cfg.get("staleness_defaults", {}) or {}
    )

    # ── System input topics ──
    inputs = mqtt_cfg.get("inputs", {})
    for config_key, topic_cfg in inputs.items():
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

        ib_field = SYSTEM_INPUT_FIELDS.get(config_key, f"_shadow_{config_key}")
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
                    payload_format="plain",
                    category=cat or infer_category("occupancy_sensor", "occupancy_sensor"),
                    availability=avail,
                    last_seen=ls,
                ))

        # valve_position → valve_positions[room]
        if "valve_position" in topics:
            raw, fmt, jp, cat, avail, ls = _mapping_fields(topics["valve_position"])
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
    if outputs.get("heat_source_command"):
        tm.output_mappings.append(OutputMapping(
            topic=_prefixed(prefix, outputs["heat_source_command"]),
            field="heat_source_command",
        ))

    # Per-room output topics
    for room, topics in room_mqtt.items():
        if not isinstance(topics, dict):
            continue
        if "valve_setpoint" in topics:
            raw = topics["valve_setpoint"] if isinstance(topics["valve_setpoint"], str) else str(topics["valve_setpoint"])
            tm.output_mappings.append(OutputMapping(
                topic=_prefixed(prefix, raw),
                field="valve_setpoint",
                room=room,
            ))
        if "trv_setpoint" in topics:
            raw = topics["trv_setpoint"] if isinstance(topics["trv_setpoint"], str) else str(topics["trv_setpoint"])
            tm.output_mappings.append(OutputMapping(
                topic=_prefixed(prefix, raw),
                field="trv_setpoint",
                room=room,
            ))

    return tm
