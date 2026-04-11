"""Topic ↔ InputBlock/OutputBlock field mapping for the MQTT driver.

Builds subscription lists and field mappings from QSH config.
Handles plain numeric and JSON payload parsing.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class TopicMapping:
    """Single MQTT topic → field mapping."""

    topic: str                      # Full MQTT topic (prefix already applied)
    field: str                      # InputBlock field name, e.g. "outdoor_temp"
    room: Optional[str] = None      # Room name for per-room fields, None for system
    payload_format: str = "plain"   # "plain" or "json"
    json_path: Optional[str] = None  # Dot-notation path for JSON payloads


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

    @property
    def subscribe_topics(self) -> List[str]:
        """All topics the driver needs to subscribe to."""
        topics = [m.topic for m in self.input_mappings]
        if self.away_topic:
            topics.append(self.away_topic)
        return topics

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

    # ── System input topics ──
    inputs = mqtt_cfg.get("inputs", {})
    for config_key, topic_cfg in inputs.items():
        if isinstance(topic_cfg, dict):
            raw_topic = topic_cfg.get("topic", "")
            fmt = topic_cfg.get("format", "plain")
            jp = topic_cfg.get("json_path")
        else:
            # Simple string form: just the topic
            raw_topic = str(topic_cfg)
            fmt = "plain"
            jp = None

        if not raw_topic:
            continue

        ib_field = SYSTEM_INPUT_FIELDS.get(config_key, f"_shadow_{config_key}")
        tm.input_mappings.append(TopicMapping(
            topic=_prefixed(prefix, raw_topic),
            field=ib_field,
            room=None,
            payload_format=fmt,
            json_path=jp,
        ))

    # ── Per-room input topics ──
    room_mqtt = config.get("room_mqtt_topics", {})
    for room, topics in room_mqtt.items():
        if not isinstance(topics, dict):
            continue

        # room_temp → room_temps[room] AND independent_sensors[room]
        if "room_temp" in topics:
            raw = topics["room_temp"] if isinstance(topics["room_temp"], str) else topics["room_temp"].get("topic", "")
            fmt = "plain"
            jp = None
            if isinstance(topics["room_temp"], dict):
                fmt = topics["room_temp"].get("format", "plain")
                jp = topics["room_temp"].get("json_path")
            if raw:
                tm.input_mappings.append(TopicMapping(
                    topic=_prefixed(prefix, raw),
                    field="room_temp",
                    room=room,
                    payload_format=fmt,
                    json_path=jp,
                ))

        # occupancy_sensor → occupancy_sensor_states[room]
        if "occupancy_sensor" in topics:
            raw = topics["occupancy_sensor"] if isinstance(topics["occupancy_sensor"], str) else topics["occupancy_sensor"].get("topic", "")
            if raw:
                tm.input_mappings.append(TopicMapping(
                    topic=_prefixed(prefix, raw),
                    field="occupancy_sensor",
                    room=room,
                    payload_format="plain",
                ))

        # valve_position → valve_positions[room]
        if "valve_position" in topics:
            raw = topics["valve_position"] if isinstance(topics["valve_position"], str) else topics["valve_position"].get("topic", "")
            fmt = "plain"
            jp = None
            if isinstance(topics["valve_position"], dict):
                fmt = topics["valve_position"].get("format", "plain")
                jp = topics["valve_position"].get("json_path")
            if raw:
                tm.input_mappings.append(TopicMapping(
                    topic=_prefixed(prefix, raw),
                    field="valve_position",
                    room=room,
                    payload_format=fmt,
                    json_path=jp,
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
