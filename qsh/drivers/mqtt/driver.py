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
from ..hot_water_payloads import classify_hot_water_payload
from .topic_map import (
    CAPABILITY_FIELDS,
    SYSTEM_INPUT_FIELDS,
    SYSTEM_STRING_INPUT_FIELDS,
    TopicMap,
    TopicMapping,
    build_topic_map,
    evaluate_availability_match,
    extract_json_value,
    get_control_topics,
    parse_payload,
    parse_payload_str,
    parse_payload_string,
    parse_timestamp,
    _prefixed,
)

logger = logging.getLogger(__name__)


# Tracks availability topics whose payloads have been warned about, to avoid
# log-spam when an upstream publisher keeps sending ambiguous values.
_AVAILABILITY_WARN_ONCE: set[str] = set()


# Signal-quality rank used for best-of resolution when multiple topics map to
# the same sq_key. Lower is better — "good" beats "stale" beats "unavailable".
_SQ_RANK: Dict[str, int] = {"good": 0, "stale": 1, "unavailable": 2}


# Per-room field → signal_quality dict prefix. Keeps room_temp / valve_position /
# occupancy_sensor mappings in distinct sq_key namespaces so a live occupancy
# sensor cannot mask a dead temp sensor (or vice versa).
_ROOM_FIELD_SQ_PREFIX: Dict[str, str] = {
    "room_temp": "room_temps",
    "valve_position": "valve_positions",
    "occupancy_sensor": "occupancy_sensors",
}


def _sq_key_for(mapping: "TopicMapping") -> str:
    """Derive the signal_quality dict key for a mapping.

    Per-room: "<field_group>.<room>" so occupancy and valve do not pollute
    room_temps. System-level: the field name, matching prior behaviour.
    Unknown per-room fields fall back to a generic "per_room.<field>.<room>"
    so they are still tracked and never collide with the room_temps key.
    """
    if mapping.room:
        prefix = _ROOM_FIELD_SQ_PREFIX.get(mapping.field)
        if prefix:
            return f"{prefix}.{mapping.room}"
        return f"per_room.{mapping.field}.{mapping.room}"
    return mapping.field


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

        # Per-sq_key last observed signal_quality. Seeded on first observation
        # (no log emitted for the seed); transitions thereafter log exactly once.
        self._previous_signal_quality: Dict[str, str] = {}

        # Per-sq_key last-logged multi-source conflict signature.  Keyed by
        # f"_conflict_{sq_key}"; value is the sorted (topic, quality) tuple.
        # Prevents repeating the same conflict log every cycle — logs once
        # on change, clears on agreement so a future disagreement re-fires.
        self._prev_sq_conflicts: Dict[str, tuple] = {}

        # One-shot latch for the comfort_temp startup audit log.  See
        # INSTRUCTION-105 — makes it trivially auditable on restart whether
        # the resolved comfort temp came from the MQTT cache or the internal
        # fallback (pid_target_internal).
        self._comfort_startup_logged: bool = False

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
        self._log_multi_source_advisory()
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

    def _log_multi_source_advisory(self) -> None:
        """Log once at setup when multiple topics map to the same sq_key.

        Bounded by the number of configured rooms/system fields, so a
        single INFO line per multi-source key is an acceptable startup
        cost. See INSTRUCTION-107.
        """
        tm = self._topic_map
        if not tm:
            return
        key_topics: Dict[str, List[str]] = {}
        for mapping in tm.input_mappings:
            sq_key = _sq_key_for(mapping)
            key_topics.setdefault(sq_key, []).append(mapping.topic)
        multi = {k: v for k, v in key_topics.items() if len(v) > 1}
        for sq_key, topics in multi.items():
            logger.info(
                "MQTT multi-source: %s has %d topics (%s) — "
                "will use best-of signal quality resolution",
                sq_key, len(topics), ", ".join(topics),
            )

    def _log_signal_quality_transition(
        self,
        sq_key: str,
        mapping: TopicMapping,
        new_quality: str,
        cache: Dict[str, Tuple[str, float]],
        staleness_defaults: Dict[str, Dict[str, int]],
        now: float,
    ) -> None:
        """Emit exactly one log line on a signal_quality transition.

        Seeding (first observation) does not log. Repeat readings do not log.
        Good transitions are INFO; stale/unavailable transitions are WARNING.
        """
        previous = self._previous_signal_quality.get(sq_key)
        if previous is None:
            self._previous_signal_quality[sq_key] = new_quality
            return
        if previous == new_quality:
            return

        thresholds = staleness_defaults.get(
            mapping.category, staleness_defaults["default"]
        )
        value_entry = cache.get(mapping.topic)
        age_s: Optional[float] = (now - value_entry[1]) if value_entry else None
        age_str = f"{age_s:.0f}s" if age_s is not None else "never"

        level = logging.INFO if new_quality == "good" else logging.WARNING
        logger.log(
            level,
            "MQTT signal_quality %s: %s → %s "
            "(topic=%s category=%s age=%s fresh=%ds unavailable=%ds)",
            sq_key,
            previous,
            new_quality,
            mapping.topic,
            mapping.category,
            age_str,
            thresholds["fresh"],
            thresholds["unavailable"],
        )
        self._previous_signal_quality[sq_key] = new_quality

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
        hot_water_active: bool = False  # overridden below if the topic is configured and has a live payload
        hw_active_value: Optional[bool] = None
        hw_active_live: bool = False
        hw_boolean_value: Optional[bool] = None
        hw_boolean_live: bool = False

        if tm:
            staleness_defaults = tm.staleness_defaults

            # Pass 1 — accumulate candidates per sq_key / per destination.
            # Multiple topics may map to the same sq_key (e.g. a primary and
            # backup room sensor). We gather every contributing topic here
            # and resolve best-of below.
            _sq_candidates: Dict[
                str, List[Tuple[str, Optional[str], TopicMapping]]
            ] = {}
            _room_temp_candidates: Dict[
                str, List[Tuple[float, str, TopicMapping]]
            ] = {}
            _system_value_candidates: Dict[
                str, List[Tuple[float, str, TopicMapping]]
            ] = {}

            for mapping in tm.input_mappings:
                sq_key = _sq_key_for(mapping)

                quality, payload_str, ts = _resolve_signal_quality(
                    mapping, cache, staleness_defaults, now
                )

                # Only accumulate sq for fields tracked before (room or system).
                tracked = (
                    bool(mapping.room)
                    or mapping.field in SYSTEM_INPUT_FIELDS.values()
                    or mapping.field in SYSTEM_STRING_INPUT_FIELDS.values()
                    or mapping.field.startswith("_shadow_")
                )
                if tracked:
                    _sq_candidates.setdefault(sq_key, []).append(
                        (quality, payload_str, mapping)
                    )

                # Availability-online with no value payload yet → no parsing.
                if payload_str is None:
                    continue

                # Parse value
                value = parse_payload(payload_str, mapping.payload_format, mapping.json_path)

                if mapping.room:
                    if mapping.field == "room_temp" and value is not None:
                        _room_temp_candidates.setdefault(mapping.room, []).append(
                            (value, quality, mapping)
                        )
                    elif mapping.field == "valve_position" and value is not None:
                        valve_positions[mapping.room] = value
                    elif mapping.field == "occupancy_sensor":
                        extracted = parse_payload_string(
                            payload_str, mapping.payload_format, mapping.json_path
                        )
                        if extracted is None:
                            occupancy_sensor_states[mapping.room] = "unavailable"
                        else:
                            payload_normalised = extracted.strip().lower()
                            if payload_normalised in _ON_PAYLOADS:
                                occupancy_sensor_states[mapping.room] = "on"
                            elif payload_normalised in _OFF_PAYLOADS:
                                occupancy_sensor_states[mapping.room] = "off"
                            else:
                                occupancy_sensor_states[mapping.room] = "unavailable"
                elif mapping.field.startswith("_shadow_"):
                    # Store in shadow dict, not InputBlock. JSON-extraction failure
                    # leaves the prior shadow value untouched (mirrors parse_payload's
                    # numeric semantics: None means "no usable reading this cycle").
                    extracted = parse_payload_string(
                        payload_str, mapping.payload_format, mapping.json_path
                    )
                    if extracted is not None:
                        self._shadow[mapping.field] = extracted
                elif mapping.field in SYSTEM_STRING_INPUT_FIELDS.values():
                    # Boolean/enum payload — parse via the shared three-valued
                    # classifier. Capability flag is written once post-loop.
                    extracted = parse_payload_string(
                        payload_str, mapping.payload_format, mapping.json_path
                    )
                    # Adding a new SYSTEM_STRING_INPUT_FIELDS entry requires a
                    # corresponding elif here — silent extraction without a handler
                    # would drop the field on the floor.
                    if mapping.field == "hot_water_active":
                        val, live = classify_hot_water_payload(extracted)
                        if val is not None:
                            hw_active_value = val
                        if live:
                            hw_active_live = True
                    elif mapping.field == "hot_water_boolean":
                        val, live = classify_hot_water_payload(extracted)
                        if val is not None:
                            hw_boolean_value = val
                        if live:
                            hw_boolean_live = True
                elif value is not None:
                    _system_value_candidates.setdefault(mapping.field, []).append(
                        (value, quality, mapping)
                    )

                # Track capabilities
                for config_key, cap_flag in CAPABILITY_FIELDS.items():
                    ib_field = SYSTEM_INPUT_FIELDS.get(config_key)
                    if mapping.field == ib_field and value is not None:
                        capabilities[cap_flag] = True

            # Pass 2 — resolve best-of per sq_key / room / system field.
            # Tie-breaker on equal quality: first candidate in
            # input_mappings order wins (Python's min() is stable).

            for sq_key, candidates in _sq_candidates.items():
                best_quality, _best_payload, best_mapping = min(
                    candidates, key=lambda c: _SQ_RANK.get(c[0], 99)
                )
                signal_quality[sq_key] = best_quality

                # Transition log uses the winning mapping's details. The
                # transition logger is keyed by sq_key (see __init__), so
                # logging the resolved quality matches its design.
                self._log_signal_quality_transition(
                    sq_key, best_mapping, best_quality, cache, staleness_defaults, now
                )

                # Multi-source conflict log — once per signature change.
                if len(candidates) > 1:
                    qualities = {c[2].topic: c[0] for c in candidates}
                    conflict_key = f"_conflict_{sq_key}"
                    if len(set(qualities.values())) > 1:
                        conflict_sig = tuple(sorted(qualities.items()))
                        if self._prev_sq_conflicts.get(conflict_key) != conflict_sig:
                            self._prev_sq_conflicts[conflict_key] = conflict_sig
                            topics_str = ", ".join(
                                f"{t}={q}" for t, q in sorted(qualities.items())
                            )
                            logger.info(
                                "MQTT signal_quality %s: multi-source conflict "
                                "resolved to '%s' (best-of: %s)",
                                sq_key, best_quality, topics_str,
                            )
                    else:
                        # All sources agree — clear so a future disagreement
                        # logs again.
                        self._prev_sq_conflicts.pop(conflict_key, None)

            for room, candidates in _room_temp_candidates.items():
                best_value, _best_q, _best_m = min(
                    candidates, key=lambda c: _SQ_RANK.get(c[1], 99)
                )
                room_temps[room] = best_value
                independent_sensors[room] = best_value

            for field_name, candidates in _system_value_candidates.items():
                best_value, _best_q, _best_m = min(
                    candidates, key=lambda c: _SQ_RANK.get(c[1], 99)
                )
                system_values[field_name] = best_value

        else:
            pass  # away/control resolved below via _resolve_mqtt_control

        # ── OR resolution for DHW demand (INSTRUCTION-126) ─────────────
        # hot_water_active is True iff at least one configured source
        # returned an ON-set payload. has_live_hot_water is asserted iff
        # at least one source produced an ON or LIVE-OFF reading —
        # UNAVAILABLE and UNRECOGNISED do not count. Single-sited write.
        _hw_contributions = [v for v in (hw_active_value, hw_boolean_value) if v is not None]
        if _hw_contributions:
            hot_water_active = any(_hw_contributions)
        if hw_active_live or hw_boolean_live:
            capabilities["has_live_hot_water"] = True

        # ── Check delta_t capability (derived from return temp + flow temp) ──
        has_live_flow = capabilities.get("has_live_flow", False)
        has_live_return = capabilities.get("has_live_return_temp", False)
        has_live_flow_rate = capabilities.get("has_live_flow_rate", False)
        has_live_hot_water = capabilities.get("has_live_hot_water", False)

        # Derive avg_open_frac from valve_positions if any zones are configured.
        # Valve positions are stored 0–100 by convention (matches heating_percs);
        # avg_open_frac is the mean divided by 100.0. Falls back to the InputBlock
        # dataclass default (0.75) when no valves are reporting — matches pre-fix
        # behaviour for installs without per-zone valves.
        if valve_positions:
            avg_open_frac = sum(valve_positions.values()) / (len(valve_positions) * 100.0)
            avg_open_frac = max(0.0, min(1.0, avg_open_frac))  # clamp defensively
        else:
            avg_open_frac = 0.75

        # Derive delta_t from flow − return when both are live.
        # Fall back to the signal_bus default (3.0) only when we genuinely
        # cannot compute — prevents InputBlock shipping a constant 3.0
        # regardless of live telemetry (observed on Alun's install).
        hp_flow_live_val = system_values.get("hp_flow_temp")
        hp_return_live_val = system_values.get("hp_return_temp")
        if (
            has_live_flow
            and has_live_return
            and hp_flow_live_val is not None
            and hp_return_live_val is not None
        ):
            computed_delta_t = hp_flow_live_val - hp_return_live_val
            has_live_delta_t = True
        else:
            computed_delta_t = 3.0
            has_live_delta_t = False

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
            "control_enabled",
            default=False,
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

        # One-time startup audit (INSTRUCTION-105).  If source="internal" and
        # value is 20.0 when the user set something else, the persistence bug
        # is still present.
        if not self._comfort_startup_logged:
            logger.info(
                "MQTT comfort_temp startup: %.1f°C (source=%s, internal_key=pid_target_internal)",
                comfort_temp_rv.value, comfort_temp_rv.source,
            )
            self._comfort_startup_logged = True

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
            avg_open_frac=avg_open_frac,
            outdoor_temp=system_values.get("outdoor_temp", 5.0),
            target_temp=comfort_temp_rv.value,
            hp_flow_temp=system_values.get("hp_flow_temp", 35.0),
            hp_return_temp=system_values.get("hp_return_temp", config.get("default_return_temp", 30.0)),
            hp_power=system_values.get("hp_power", 0.0),
            hp_cop=system_values.get("hp_cop", 3.5),
            delta_t=computed_delta_t,
            flow_rate=system_values.get("flow_rate", 0.0),
            solar_production=system_values.get("solar_production", 0.0),
            grid_power=system_values.get("grid_power", 0.0),
            battery_soc=system_values.get("battery_soc", config.get("default_battery_soc", 50.0)),
            current_rate=current_rate,
            export_rate=export_rate,
            control_enabled=dfan_rv.value,
            hot_water_active=hot_water_active,
            flow_min=flow_min_rv.value,
            flow_max=flow_max_rv.value,
            signal_quality=signal_quality,
            has_live_cop=capabilities.get("has_live_cop", False),
            has_live_power=capabilities.get("has_live_power", False),
            has_live_flow=has_live_flow,
            has_live_return_temp=has_live_return,
            has_live_flow_rate=has_live_flow_rate,
            has_live_delta_t=has_live_delta_t,
            has_live_hot_water=has_live_hot_water,
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

        # INSTRUCTION-125: fail-closed default as defence-in-depth. Primary
        # path is config.py YAML load which defaults missing control_enabled
        # to True on load; this fallback only activates on in-memory
        # corruption.
        control_enabled = config.get("control_enabled")
        if control_enabled is None:
            logger.warning(
                "control_enabled missing from config — defaulting to shadow (defence-in-depth)"
            )
            control_enabled = False

        prefix = config.get("mqtt", {}).get("topic_prefix", "")

        # ── Hardware commands (HP flow/mode) ──
        if outputs.hardware_changed:
            if control_enabled:
                for om in self._topic_map.output_mappings:
                    if om.field == "applied_flow":
                        self._mqtt.publish(om.topic, str(outputs.applied_flow))
                    elif om.field == "applied_mode":
                        self._mqtt.publish(om.topic, outputs.applied_mode)
            else:
                logger.debug(
                    "SHADOW MODE: suppressed HP command flow=%.1f mode=%s",
                    outputs.applied_flow, outputs.applied_mode,
                )

        # ── Heat source command ──
        if outputs.heat_source_changed and outputs.heat_source_command is not None:
            if control_enabled:
                for om in self._topic_map.output_mappings:
                    if om.field == "heat_source_command":
                        self._mqtt.publish(om.topic, outputs.heat_source_command)
            else:
                logger.debug(
                    "SHADOW MODE: suppressed heat_source_command → %s",
                    outputs.heat_source_command,
                )

        # ── Valve commands ──
        if outputs.valves_changed:
            if control_enabled:
                for om in self._topic_map.output_mappings:
                    if om.field == "valve_setpoint" and om.room and om.room in outputs.valve_setpoints:
                        self._mqtt.publish(om.topic, str(outputs.valve_setpoints[om.room]))
            else:
                logger.debug(
                    "SHADOW MODE: suppressed %d valve setpoint(s)",
                    len(outputs.valve_setpoints),
                )

        # ── Auxiliary boolean outputs (per-room aux actuators, INSTRUCTION-131B) ──
        if outputs.auxiliary_outputs_changed and outputs.auxiliary_outputs:
            aux_cfg = config.get("auxiliary_outputs", {})
            for room, state in outputs.auxiliary_outputs.items():
                room_aux = aux_cfg.get(room, {})
                if not room_aux.get("enabled"):
                    continue
                topic = room_aux.get("mqtt_topic")
                if not topic:
                    outputs.auxiliary_dispatch_failures.add(room)
                    continue
                if control_enabled:
                    payload = "ON" if state else "OFF"
                    try:
                        # retain=True: aux output is desired-state semantics, not
                        # event semantics. Reconnecting subscribers (or restarted
                        # brokers) must receive last commanded state immediately,
                        # otherwise relay state is blacked out until next demand
                        # transition (could be hours). Edge-triggered publish +
                        # retain=True is the standard HA-aware MQTT pattern for
                        # commanded states.
                        self._mqtt.publish(topic, payload, qos=1, retain=True)
                    except Exception as e:
                        logger.warning("MQTT aux dispatch failed for %s: %s", topic, e)
                        outputs.auxiliary_dispatch_failures.add(room)
                else:
                    logger.debug(
                        "SHADOW MODE: suppressed aux %s=%s → %s", room, state, topic
                    )

        # ── TRV setpoints ──
        # Gated on control_enabled. Shadow mode suppresses actuation but still
        # allows shadow-entity publishes below for operator visibility.
        if outputs.trv_setpoints:
            if control_enabled:
                for om in self._topic_map.output_mappings:
                    if om.field == "trv_setpoint" and om.room and om.room in outputs.trv_setpoints:
                        self._mqtt.publish(om.topic, str(outputs.trv_setpoints[om.room]))
            else:
                logger.debug(
                    "SHADOW MODE: suppressed %d TRV setpoint(s)",
                    len(outputs.trv_setpoints),
                )

        # Telemetry — not gated on control_enabled (shadow mode still publishes observable state)
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
