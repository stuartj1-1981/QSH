"""MQTTDriver — direct MQTT broker I/O for QSH.

Implements the IODriver protocol. No Home Assistant dependency.
Reads InputBlock from MQTT topic cache, writes OutputBlock to MQTT topics.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from ...signal_bus import InputBlock, OutputBlock
from .client import MQTTClient, MQTTClientConfig
from ..resolve import ResolvedValue, deep_get, _validate_range
from .topic_map import (
    CAPABILITY_FIELDS,
    SYSTEM_INPUT_FIELDS,
    TopicMap,
    TopicMapping,
    build_topic_map,
    evaluate_availability_match,
    extract_json_value,
    get_control_topics,
    parse_payload,
    parse_payload_str,
    parse_timestamp,
    _prefixed,
)

logger = logging.getLogger(__name__)


# Tracks availability topics whose payloads have been warned about, to avoid
# log-spam when an upstream publisher keeps sending ambiguous values.
_AVAILABILITY_WARN_ONCE: set[str] = set()


def _resolve_signal_quality(
    mapping: TopicMapping,
    cache: Dict[str, Tuple[str, float]],
    staleness_defaults: Dict[str, Dict[str, int]],
    now: float,
) -> Tuple[str, Optional[str], Optional[float]]:
    """Resolve (signal_quality, payload_str, timestamp) for a mapping.

    Bridge-agnostic four-step resolution. The first step that returns is
    the answer.

      1. Availability check — if declared and a message has been received.
         Online → "good" (trumps any staleness timer; value payload passed
         through unchanged). Offline → "unavailable" (value payload
         discarded). Ambiguous → fall through.
      2. Last-seen age — if declared and the current value payload contains
         a parseable timestamp at the declared path.
      3. Arrival age — fallback to cached-message arrival age.
      4. Never received — no value entry and no authoritative availability.

    signal_quality is one of "good", "stale", "unavailable".
    payload_str and timestamp are None when no payload is usable this cycle.
    """
    value_entry = cache.get(mapping.topic)
    avail_entry = (
        cache.get(mapping.availability.topic) if mapping.availability else None
    )

    # ── Step 1: availability ───────────────────────────────────────────
    if mapping.availability is not None and avail_entry is not None:
        avail_payload = avail_entry[0]
        result = evaluate_availability_match(
            avail_payload, mapping.availability.online_match
        )
        if result is False:
            # Publisher asserts offline — discard any cached value payload.
            return ("unavailable", None, None)
        if result is True:
            # Publisher asserts online — trust over staleness timers.
            if value_entry is not None:
                return ("good", value_entry[0], value_entry[1])
            return ("good", None, None)
        # result is None → ambiguous: warn once, fall through.
        key = mapping.availability.topic
        if key not in _AVAILABILITY_WARN_ONCE:
            _AVAILABILITY_WARN_ONCE.add(key)
            logger.warning(
                "MQTT availability payload on %s could not be evaluated "
                "against match expression %r: %r",
                mapping.availability.topic,
                mapping.availability.online_match,
                avail_payload,
            )

    # Category threshold lookup — "default" is guaranteed by build_topic_map.
    thresholds = staleness_defaults.get(
        mapping.category, staleness_defaults["default"]
    )
    fresh = thresholds["fresh"]
    unavail = thresholds["unavailable"]

    # ── Step 2: last_seen age ──────────────────────────────────────────
    if mapping.last_seen is not None and value_entry is not None:
        ts_raw = extract_json_value(value_entry[0], mapping.last_seen.json_path)
        ts_last_seen = parse_timestamp(ts_raw, mapping.last_seen.format)
        if ts_last_seen is not None:
            age = now - ts_last_seen
            if age > unavail:
                return ("unavailable", None, None)
            if age > fresh:
                return ("stale", value_entry[0], value_entry[1])
            return ("good", value_entry[0], value_entry[1])
        # fall through to arrival age

    # ── Step 3: arrival age ────────────────────────────────────────────
    if value_entry is not None:
        age = now - value_entry[1]
        if age > unavail:
            return ("unavailable", None, None)
        if age > fresh:
            return ("stale", value_entry[0], value_entry[1])
        return ("good", value_entry[0], value_entry[1])

    # ── Step 4: never received ─────────────────────────────────────────
    return ("unavailable", None, None)


def _parse_bool_payload(s: str):
    """Parse MQTT boolean payload.  Returns True/False or None on invalid input.

    Accepts: true/false, 1/0, on/off (case-insensitive).
    Contract: never raises.
    """
    lo = s.lower()
    if lo in ("true", "1", "on"):
        return True
    if lo in ("false", "0", "off"):
        return False
    return None


class MQTTDriver:
    """MQTT implementation of the IODriver protocol."""

    is_realtime = True

    def __init__(self, config: Dict[str, Any]):
        self._config = config
        self._mqtt: Optional[MQTTClient] = None
        self._topic_map: Optional[TopicMap] = None
        self._cycle_interval = config.get("cycle_interval", 30)
        self._shadow: Dict[str, Any] = {}  # Shadow values (hp_heat_output, hp_mode_state)
        self._prefix: str = config.get("mqtt", {}).get("topic_prefix", "")
        self._last_resolved: Dict[str, Any] = {}  # ResolvedValue per control key, for 36C

        rooms = config.get("rooms", {})
        if not rooms:
            raise ValueError("MQTTDriver: config['rooms'] is empty — need at least one room")
        self._rooms = list(rooms.keys())

    # ── IODriver protocol ──────────────────────────────────────────────

    def setup(self, config: Dict) -> Dict[str, Any]:
        """Connect to MQTT broker, subscribe to all input topics."""
        mqtt_cfg = config.get("mqtt", {})

        client_config = MQTTClientConfig(
            broker=mqtt_cfg.get("broker", "localhost"),
            port=mqtt_cfg.get("port", 1883),
            username=mqtt_cfg.get("username", ""),
            password=mqtt_cfg.get("password", ""),
            tls=mqtt_cfg.get("tls", False),
            client_id=mqtt_cfg.get("client_id", "qsh"),
            keepalive=mqtt_cfg.get("keepalive", 60),
            topic_prefix=mqtt_cfg.get("topic_prefix", ""),
        )

        self._prefix = mqtt_cfg.get("topic_prefix", "")
        self._topic_map = build_topic_map(config)
        self._mqtt = MQTTClient(client_config)
        self._mqtt.connect()

        # Subscribe to sensor input topics + away topic (from topic_map)
        # plus all control topics (from get_control_topics).  Prefix is
        # applied here so the broker receives fully-qualified topic strings.
        control_topics = [
            _prefixed(self._prefix, t) for t in get_control_topics(config)
        ]
        all_topics = list(dict.fromkeys(self._topic_map.subscribe_topics + control_topics))
        self._mqtt.subscribe(all_topics)

        logger.info(
            "MQTTDriver: connected, subscribed to %d topics (%d control)",
            len(all_topics),
            len(control_topics),
        )

        # Dual-publish deprecation warning (36C Task 8)
        if config.get("mqtt_legacy_shadow_topics", True) and config.get("publish_mqtt_shadow", True):
            logger.warning(
                "Publishing MQTT shadow topics in both legacy (input_number.qsh_total_demand) "
                "and clean (total_demand) formats. Set mqtt_legacy_shadow_topics: false in "
                "qsh.yaml to disable legacy topics. Legacy topics will be removed in the "
                "next major version."
            )

        return {"prev_mode": "heat"}

    def teardown(self, controllers: List) -> None:
        """Graceful shutdown — save state, publish safe mode, disconnect."""
        try:
            from ...pipeline import save_pipeline_state
            save_pipeline_state(controllers)
        except Exception as e:
            logger.error("MQTTDriver: failed to save state on shutdown: %s", e)

        if self._mqtt and self._topic_map:
            # Publish mode "off" to mode topic (safe state)
            for om in self._topic_map.output_mappings:
                if om.field == "applied_mode":
                    self._mqtt.publish(om.topic, "off")
                    break

        if self._mqtt:
            self._mqtt.disconnect()

    def _resolve_mqtt_control(
        self,
        cache: Dict,
        topic_suffix: str,
        internal_key: str,
        default: Any,
        validate=None,
    ) -> ResolvedValue:
        """Read from auto-subscribed MQTT control topic cache, fall back to internal value.

        Args:
            cache:        Snapshot from get_cache_snapshot() — taken once per cycle.
            topic_suffix: Control topic without prefix, e.g. "control/flow_min".
            internal_key: Dot-notation key in config for the internal fallback
                          (uses deep_get so nested keys work).
            default:      Value when both MQTT cache and internal key are absent.
            validate:     Optional callable(raw_str) -> typed_value or None.
                          Contract: MUST never raise.  Returns None on invalid input.

        Returns:
            ResolvedValue with source="external" when MQTT cache hit+valid,
            source="internal" otherwise.
        """
        full_topic = _prefixed(self._prefix, topic_suffix)
        entry = cache.get(full_topic)
        if entry is not None:
            raw_str = entry[0]  # (payload_str, timestamp)
            typed = validate(raw_str) if validate is not None else raw_str
            if typed is not None:
                return ResolvedValue(
                    value=typed,
                    source="external",
                    external_id=full_topic,
                    external_raw=raw_str,
                )
            else:
                logger.warning(
                    "MQTT control topic %s: invalid payload '%s', using internal",
                    full_topic,
                    raw_str,
                )
        # Cache empty or invalid — use internal value via deep_get
        internal = deep_get(self._config, internal_key, default)
        return ResolvedValue(
            value=internal,
            source="internal",
            external_id=full_topic if entry is not None else None,
            external_raw=None,
        )

    def read_inputs(self, config: Dict) -> InputBlock:
        """Build InputBlock from MQTT topic cache."""
        now = time.time()
        cache = self._mqtt.get_cache_snapshot() if self._mqtt else {}
        tm = self._topic_map
        # Keep _config in sync with the config passed in (may differ on first call)
        self._config = config

        # ── Map cached values → InputBlock fields ──
        room_temps: Dict[str, float] = {}
        independent_sensors: Dict[str, float] = {}
        valve_positions: Dict[str, float] = {}
        occupancy_sensor_states: Dict[str, str] = {}
        signal_quality: Dict[str, str] = {}
        capabilities: Dict[str, bool] = {}

        # Normalise boolean-ish MQTT payloads to "on"/"off"
        _ON_PAYLOADS = {"true", "1", "on"}
        _OFF_PAYLOADS = {"false", "0", "off"}

        # System-level fields with defaults from InputBlock
        system_values: Dict[str, float] = {}

        if tm:
            staleness_defaults = tm.staleness_defaults
            for mapping in tm.input_mappings:
                # Signal quality key (matches prior behaviour).
                if mapping.room:
                    sq_key = f"room_temps.{mapping.room}"
                else:
                    sq_key = mapping.field

                quality, payload_str, ts = _resolve_signal_quality(
                    mapping, cache, staleness_defaults, now
                )

                # Only record sq for fields tracked before (room or system).
                if mapping.room:
                    signal_quality[sq_key] = quality
                elif mapping.field in SYSTEM_INPUT_FIELDS.values():
                    signal_quality[sq_key] = quality
                elif mapping.field.startswith("_shadow_"):
                    signal_quality[sq_key] = quality

                # Availability-online with no value payload yet → no parsing.
                if payload_str is None:
                    continue

                # Parse value
                value = parse_payload(payload_str, mapping.payload_format, mapping.json_path)

                if mapping.room:
                    if mapping.field == "room_temp" and value is not None:
                        room_temps[mapping.room] = value
                        independent_sensors[mapping.room] = value
                    elif mapping.field == "valve_position" and value is not None:
                        valve_positions[mapping.room] = value
                    elif mapping.field == "occupancy_sensor":
                        payload_normalised = payload_str.strip().lower()
                        if payload_normalised in _ON_PAYLOADS:
                            occupancy_sensor_states[mapping.room] = "on"
                        elif payload_normalised in _OFF_PAYLOADS:
                            occupancy_sensor_states[mapping.room] = "off"
                        else:
                            occupancy_sensor_states[mapping.room] = "unavailable"
                elif mapping.field.startswith("_shadow_"):
                    # Store in shadow dict, not InputBlock
                    self._shadow[mapping.field] = payload_str
                elif value is not None:
                    system_values[mapping.field] = value

                # Track capabilities
                for config_key, cap_flag in CAPABILITY_FIELDS.items():
                    ib_field = SYSTEM_INPUT_FIELDS.get(config_key)
                    if mapping.field == ib_field and value is not None:
                        capabilities[cap_flag] = True

        else:
            pass  # away/control resolved below via _resolve_mqtt_control

        # ── Check delta_t capability (derived from return temp + flow temp) ──
        has_live_return = capabilities.get("has_live_return_temp", False)
        has_live_flow_rate = capabilities.get("has_live_flow_rate", False)

        # ── Energy rates from config ──
        fallback_rates = config.get("fallback_rates", {})
        fixed_rates = config.get("fixed_rates") or {}
        if fixed_rates:
            current_rate = fixed_rates.get("import_rate", 0.245)
            export_rate = fixed_rates.get("export_rate", 0.15)
        else:
            current_rate = fallback_rates.get("standard", 0.245)
            export_rate = fallback_rates.get("export", 0.15)

        # ── Control topics via _resolve_mqtt_control (cache-first with internal fallback) ──
        away_rv = self._resolve_mqtt_control(
            cache,
            "control/away",
            "away_active_internal",
            default=False,
            validate=_parse_bool_payload,
        )
        self._last_resolved["away_mode"] = away_rv

        away_days_rv = self._resolve_mqtt_control(
            cache,
            "control/away_days",
            "away_days_internal",
            default=1.0,
            validate=lambda s: _validate_range(s, 0.0, 365.0),
        )
        self._last_resolved["away_days"] = away_days_rv

        dfan_rv = self._resolve_mqtt_control(
            cache,
            "control/dfan_control",
            "dfan_control_internal",
            default=True,
            validate=_parse_bool_payload,
        )
        self._last_resolved["dfan_control"] = dfan_rv

        flow_min_rv = self._resolve_mqtt_control(
            cache,
            "control/flow_min",
            "flow_min_internal",
            default=25.0,
            validate=lambda s: _validate_range(s, 20.0, 45.0),
        )
        self._last_resolved["flow_min"] = flow_min_rv

        flow_max_rv = self._resolve_mqtt_control(
            cache,
            "control/flow_max",
            "flow_max_internal",
            default=50.0,
            validate=lambda s: _validate_range(s, 30.0, 60.0),
        )
        self._last_resolved["flow_max"] = flow_max_rv

        comfort_temp_rv = self._resolve_mqtt_control(
            cache,
            "control/comfort_temp",
            "pid_target_internal",
            default=20.0,
            validate=lambda s: _validate_range(s, 10.0, 30.0),
        )
        self._last_resolved["comfort_temp"] = comfort_temp_rv

        # ── Per-room away and comfort_temp from control topics ──
        per_zone_away: Dict[str, float] = {}
        per_room_comfort: Dict[str, float] = {}
        for room_slug in config.get("rooms", {}):
            room_away_rv = self._resolve_mqtt_control(
                cache,
                f"control/{room_slug}/away",
                f"room_internals.{room_slug}.away_active_internal",
                default=False,
                validate=_parse_bool_payload,
            )
            if room_away_rv.value:
                room_days_rv = self._resolve_mqtt_control(
                    cache,
                    f"control/{room_slug}/away_days",
                    f"room_internals.{room_slug}.away_days_internal",
                    default=1.0,
                    validate=lambda s: _validate_range(s, 0.0, 365.0),
                )
                per_zone_away[room_slug] = room_days_rv.value

            # Per-room comfort override: MQTT cache → room's pid_target_internal
            # → system comfort_temp (as default). Emitted into the overrides
            # map only when the resolved value is external OR differs from
            # the system comfort; otherwise the base target is already correct.
            room_comfort_rv = self._resolve_mqtt_control(
                cache,
                f"control/{room_slug}/comfort_temp",
                f"room_internals.{room_slug}.pid_target_internal",
                default=comfort_temp_rv.value,
                validate=lambda s: _validate_range(s, 10.0, 30.0),
            )
            if (
                room_comfort_rv.source == "external"
                or room_comfort_rv.value != comfort_temp_rv.value
            ):
                per_room_comfort[room_slug] = room_comfort_rv.value

        return InputBlock(
            room_temps=room_temps,
            independent_sensors=independent_sensors,
            valve_positions=valve_positions,
            outdoor_temp=system_values.get("outdoor_temp", 5.0),
            target_temp=comfort_temp_rv.value,
            hp_flow_temp=system_values.get("hp_flow_temp", 35.0),
            hp_return_temp=system_values.get("hp_return_temp", config.get("default_return_temp", 30.0)),
            hp_power=system_values.get("hp_power", 0.0),
            hp_cop=system_values.get("hp_cop", 3.5),
            flow_rate=system_values.get("flow_rate", 0.0),
            solar_production=system_values.get("solar_production", 0.0),
            grid_power=system_values.get("grid_power", 0.0),
            battery_soc=system_values.get("battery_soc", config.get("default_battery_soc", 50.0)),
            current_rate=current_rate,
            export_rate=export_rate,
            control_enabled=dfan_rv.value,
            flow_min=flow_min_rv.value,
            flow_max=flow_max_rv.value,
            signal_quality=signal_quality,
            has_live_cop=capabilities.get("has_live_cop", False),
            has_live_power=capabilities.get("has_live_power", False),
            has_live_return_temp=has_live_return,
            has_live_flow_rate=has_live_flow_rate,
            has_live_delta_t=has_live_return,  # delta_t derived from return temp
            has_solar=capabilities.get("has_solar", False),
            has_battery=capabilities.get("has_battery", False),
            away_mode_active=away_rv.value,
            away_days=away_days_rv.value,
            per_zone_away=per_zone_away,
            per_room_comfort_overrides=per_room_comfort,
            occupancy_sensor_states=occupancy_sensor_states,
            timestamp=now,
        )

    def write_outputs(self, outputs: OutputBlock, config: Dict) -> None:
        """Publish OutputBlock to MQTT topics."""
        if not self._mqtt or not self._topic_map:
            return

        prefix = config.get("mqtt", {}).get("topic_prefix", "")

        # ── Hardware commands (HP flow/mode) ──
        if outputs.hardware_changed:
            for om in self._topic_map.output_mappings:
                if om.field == "applied_flow":
                    self._mqtt.publish(om.topic, str(outputs.applied_flow))
                elif om.field == "applied_mode":
                    self._mqtt.publish(om.topic, outputs.applied_mode)

        # ── Heat source command ──
        if outputs.heat_source_changed and outputs.heat_source_command is not None:
            for om in self._topic_map.output_mappings:
                if om.field == "heat_source_command":
                    self._mqtt.publish(om.topic, outputs.heat_source_command)

        # ── Valve commands ──
        if outputs.valves_changed:
            for om in self._topic_map.output_mappings:
                if om.field == "valve_setpoint" and om.room and om.room in outputs.valve_setpoints:
                    self._mqtt.publish(om.topic, str(outputs.valve_setpoints[om.room]))

        # ── TRV setpoints (always publish if configured) ──
        for om in self._topic_map.output_mappings:
            if om.field == "trv_setpoint" and om.room and om.room in outputs.trv_setpoints:
                self._mqtt.publish(om.topic, str(outputs.trv_setpoints[om.room]))

        # ── Shadow entities (dual-publish transition — 36C Task 8) ──
        if outputs.shadow_changed and config.get("publish_mqtt_shadow", True):
            def _shadow_base(p: str) -> str:
                return p if p else "qsh"

            base = _shadow_base(prefix)
            legacy_enabled = config.get("mqtt_legacy_shadow_topics", True)

            for key, value in outputs.shadow_entities.items():
                val_str = str(value)
                # Clean topic: strip entity type prefix and qsh_ prefix
                # e.g. "input_number.qsh_total_demand" → "total_demand"
                clean_key = key.split(".")[-1].replace("qsh_", "")
                self._mqtt.publish(f"{base}/shadow/{clean_key}", val_str)

                # Legacy topic (deprecated — removed in next major version)
                if legacy_enabled:
                    self._mqtt.publish(f"{base}/shadow/{key}", val_str)

            # Operating state (always clean form)
            self._mqtt.publish(f"{base}/shadow/operating_state", outputs.operating_state)

        # ── Notifications ──
        if outputs.notifications:
            notif_topic = f"{prefix}/notifications" if prefix else "qsh/notifications"
            for notif in outputs.notifications:
                self._mqtt.publish(notif_topic, json.dumps(notif))

    def apply_failsafe(self, config: Dict, safe_flow: float = 40.0, safe_mode: str = "heat") -> None:
        """Publish safe-state commands to MQTT with retry.

        Retry policy: 3 attempts, 2-second intervals, 5-second timeout per
        publish. If all retries fail, log at CRITICAL — the HP's native
        firmware continues on its own safety logic (antifreeze, overheat,
        flow/pressure limits). QSH's failsafe is an optimisation-layer
        courtesy, not a safety-critical interlock.
        """
        if not self._mqtt or not self._topic_map:
            logger.critical(
                "FAILSAFE: MQTT client or topic map not available — "
                "HP running on native controls"
            )
            return

        max_retries = 3
        retry_interval = 2  # seconds

        for attempt in range(1, max_retries + 1):
            try:
                logger.warning(
                    "FAILSAFE (attempt %d/%d): publishing flow=%.1f mode=%s",
                    attempt, max_retries, safe_flow, safe_mode,
                )
                for om in self._topic_map.output_mappings:
                    if om.field == "applied_flow":
                        self._mqtt.publish(om.topic, str(safe_flow))
                    elif om.field == "applied_mode":
                        self._mqtt.publish(om.topic, safe_mode)
                logger.warning("FAILSAFE: safe state published successfully")
                return
            except Exception as e:
                logger.error(
                    "FAILSAFE (attempt %d/%d) failed: %s",
                    attempt, max_retries, e,
                )
                if attempt < max_retries:
                    time.sleep(retry_interval)

        logger.critical(
            "FAILSAFE: all %d publish attempts failed — "
            "HP running on native firmware controls (antifreeze, overheat, "
            "flow/pressure limits). This is equivalent to QSH-not-installed state.",
            max_retries,
        )

    def wait(self) -> None:
        """Block for one cycle interval."""
        time.sleep(self._cycle_interval)
