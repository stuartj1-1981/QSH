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
from ...api.state import shared_state
from ...events import EventKind, EventSpec, get_annunciator
from ...occupancy.comfort_schedule import get_comfort_schedule_store
from .client import MQTTClient, MQTTClientConfig
from ..resolve import ResolvedValue, deep_get, _validate_range
from ..hot_water_payloads import (
    classify_hot_water_payload,
    resolve_hot_water_active,
    HW_STALE_HOLD_DEFAULT_S,
)
from .topic_map import (
    CAPABILITY_FIELDS,
    SYSTEM_INPUT_FIELDS,
    SYSTEM_STRING_INPUT_FIELDS,
    TopicMap,
    TopicMapping,
    build_topic_map,
    command_topic_for_source,
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


# INSTRUCTION-221C — register MQTT events. Idempotent for identical specs;
# singleton lookup at use site so test fixtures resetting the annunciator
# do not strand the references.
def _register_mqtt_events() -> None:
    ann = get_annunciator()
    ann.register(EventSpec(
        name="MQTT.control_topic_invalid_payload",
        kind=EventKind.LATCHED,
        payload_fields=("topic", "payload_excerpt"),
        latch_key=("topic",),
        default_level=logging.WARNING,
    ))
    ann.register(EventSpec(
        name="MQTT.control_enabled_missing",
        kind=EventKind.LATCHED,
        payload_fields=(),
        default_level=logging.WARNING,
    ))
    # INSTRUCTION-268 — comfort-temp writeback round-trip verification events.
    ann.register(EventSpec(
        name="COMFORT.writeback_unverified",
        kind=EventKind.LATCHED,
        payload_fields=("wrote", "read", "source", "topic", "elapsed_s", "client_unavailable"),
        latch_key=("topic",),
        default_level=logging.WARNING,
    ))
    ann.register(EventSpec(
        name="COMFORT.writeback_internal_fallback",
        kind=EventKind.OCCURRED,
        payload_fields=("wrote", "read", "elapsed_s", "internal_key"),
        default_level=logging.INFO,
    ))
    # INSTRUCTION-301 — hot_water_active last-valid hold across DHW-source comms
    # loss. LATCHED on held_value; age_s is diagnostic context only.
    ann.register(EventSpec(
        name="MQTT.hot_water_stale_lastvalid",
        kind=EventKind.LATCHED,
        payload_fields=("held_value", "age_s"),
        latch_key=("held_value",),
        default_level=logging.INFO,
    ))
    # INSTRUCTION-332 — outdoor last-valid hold across staleness / parse /
    # comms loss. Mirrors HA.outdoor_stale_lastvalid (sensor_fetcher.py:61-66)
    # with added diagnostics (age_s, reason). Singleton latch (no latch_key);
    # the payload is diagnostic context only (T-33).
    ann.register(EventSpec(
        name="MQTT.outdoor_stale_lastvalid",
        kind=EventKind.LATCHED,
        payload_fields=("temp", "age_s", "reason"),
        default_level=logging.INFO,
    ))
    # Cold-start fallback to 5.0 with no last-valid history available. WARNING
    # because 5.0 is a synthetic value, not a real measurement.
    ann.register(EventSpec(
        name="MQTT.outdoor_stale_no_history",
        kind=EventKind.LATCHED,
        payload_fields=("fallback",),
        default_level=logging.WARNING,
    ))


# INSTRUCTION-268 — writeback round-trip verification tolerance.
# Duplicated from qsh.api.routes.control to avoid a cross-layer import
# (driver should not import from API routes).
WRITEBACK_TOLERANCE_C: float = 0.05

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

        # INSTRUCTION-268 — set True when writeback deadline expires without
        # broker-sourced confirmation. Surfaced on CycleSnapshot via
        # state.py's getattr chain.
        self.comfort_temp_writeback_unverified: bool = False

        # INSTRUCTION-231B V2 — tracks the emitter stem of the most-recent
        # fresh-winning candidate per room for multi-emitter valve_position
        # resolution. Used in read_inputs' all-stale recovery branch to
        # mirror HA driver 231A's _last_winning_entity_per_room semantic.
        # Without this, the all-stale branch could walk backward in time
        # when the winning emitter changed between fresh cycles (V1 HIGH-1).
        # Instance-scoped because MQTTDriver is an instantiated class;
        # natural per-test isolation via fresh MQTTDriver(cfg) construction.
        self._last_winning_emitter_per_room: Dict[str, str] = {}

        # INSTRUCTION-301 — last-valid hold for hot_water_active across DHW-
        # source comms loss. Holds the last live-resolved value for a bounded
        # window when every source goes non-live, rather than collapsing to
        # False mid-DHW. Instance-scoped (per MQTTDriver); naturally isolated
        # per test via fresh MQTTDriver(cfg) construction.
        self._hw_last_valid_value: Optional[bool] = None
        self._hw_last_valid_ts: Optional[float] = None

        # INSTRUCTION-332 — last-valid hold for outdoor_temp across staleness /
        # parse / comms loss. Unbounded hold, exact HA-path parity (owner
        # decision 11 June 2026). Without it a no-candidate cycle collapses to a
        # synthetic 5.0 indistinguishable downstream from a real reading.
        # Instance-scoped (per MQTTDriver); naturally isolated per test.
        self._outdoor_last_valid: Optional[float] = None
        self._outdoor_last_valid_ts: Optional[float] = None

        # INSTRUCTION-329 D1 — last-published value for the retained
        # status/active_source annunciation topic. None → first cycle always
        # publishes; subsequent cycles publish only on change. Instance-scoped
        # (per MQTTDriver), naturally isolated per test.
        self._last_published_active_source: Optional[str] = None

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

        # INSTRUCTION-220C — include forecast topic in subscription set.
        # Inline extension of all_topics rather than topic_map registration:
        # topic_map services InputBlock-bound topics only (per topic_map module
        # docstring scope clarification); forecast is subscribe-only (not
        # InputBlock-bound — consumed via ctx.forecast_state by
        # ForecastController after 220D wires the Protocol).
        forecast_topic = (
            config.get("entities", {}).get("forecast_mqtt_topic", "").strip()
        )
        if forecast_topic:
            full_forecast_topic = (
                _prefixed(self._prefix, forecast_topic) if self._prefix else forecast_topic
            )
            if full_forecast_topic not in all_topics:
                all_topics.append(full_forecast_topic)
            logger.info(
                "MQTT forecast: subscribing to %s (configured via mqtt.inputs.forecast.topic)",
                full_forecast_topic,
            )

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

        # INSTRUCTION-225B — boot-time AUTO-on-restart contract log.
        from qsh import manual_state
        manual_state.init(config)
        _direct_count = len(manual_state.configured_direct_rooms(config))
        if _direct_count > 0:
            logger.info(
                "manual_state (mqtt): %d direct TRVs configured; all start in AUTO on restart "
                "(transient state, INSTRUCTION-225 V2)",
                _direct_count,
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
            # Publish mode "off" to the shared mode topic (existing safe state).
            for om in self._topic_map.output_mappings:
                if om.field == "applied_mode":
                    self._mqtt.publish(om.topic, "off")
                    break

            # 329 Task 5 — all-off is unambiguous and safe at shutdown: publish
            # "off" to every configured per-source flow_control.mode_topic and
            # every source's command topic, so no per-source topic retains a
            # stale "heat" after the process exits.
            _config = getattr(self, "_config", {}) or {}
            _prefix = _config.get("mqtt", {}).get("topic_prefix", "")
            _cmd_default_prefix = (
                f"{_prefix}/heat_source" if _prefix else "qsh/heat_source"
            )
            for _src in _config.get("heat_sources", []) or []:
                _src_mode = (_src.get("flow_control") or {}).get("mode_topic")
                if _src_mode:
                    self._mqtt.publish(_src_mode, "off")
                self._mqtt.publish(
                    command_topic_for_source(
                        _src, default_prefix=_cmd_default_prefix,
                    ),
                    "off",
                )

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
        _register_mqtt_events()
        ann = get_annunciator()
        full_topic = _prefixed(self._prefix, topic_suffix)
        entry = cache.get(full_topic)
        if entry is not None:
            raw_str = entry[0]  # (payload_str, timestamp)
            typed = validate(raw_str) if validate is not None else raw_str
            if typed is not None:
                # Validator returned non-None — bad payload (if any) is
                # resolved. Clear the latch for this topic. Per H5: only a
                # positive validator-success exits the latch; cache-absent
                # (handled below by the `entry is not None` gate) does NOT.
                ann.exited("MQTT.control_topic_invalid_payload", topic=full_topic)
                return ResolvedValue(
                    value=typed,
                    source="external",
                    external_id=full_topic,
                    external_raw=raw_str,
                )
            else:
                payload_excerpt = raw_str[:64] if raw_str else ""
                ann.entered(
                    "MQTT.control_topic_invalid_payload",
                    topic=full_topic,
                    payload_excerpt=payload_excerpt,
                )
        # Cache empty or invalid — use internal value via deep_get.
        # NB: cache-absent intentionally does NOT exit any latch (H5):
        # "no information available" is not "known resolved".
        internal = deep_get(self._config, internal_key, default)
        return ResolvedValue(
            value=internal,
            source="internal",
            external_id=full_topic if entry is not None else None,
            external_raw=None,
        )

    def _verify_pending_writeback(self, comfort_temp_rv, now: float) -> None:
        """INSTRUCTION-268 — write-and-readback verification for comfort_temp.

        Three-outcome decision tree:
          1. Matched + external source   -> clear pending, exit latch.
          2. Matched + internal source    -> clear pending, log fallback.
          3. Deadline expired, no match   -> enter latch, set unverified flag.

        If no pending writeback exists, this is a no-op.
        """
        pw = shared_state.get_pending_writeback("comfort_temp")
        if pw is None:
            return

        _register_mqtt_events()
        ann = get_annunciator()

        matched = abs(comfort_temp_rv.value - pw.value) <= WRITEBACK_TOLERANCE_C
        is_external = comfort_temp_rv.source == "external"
        expired = now >= pw.deadline

        if matched and is_external:
            # Outcome 1: broker echoed the write back. Round-trip confirmed.
            shared_state.clear_pending_writeback("comfort_temp")
            ann.exited("COMFORT.writeback_unverified", topic=pw.key)
            self.comfort_temp_writeback_unverified = False
        elif matched and not is_external:
            # Outcome 2: value matches but came from internal fallback, not
            # the broker. Clear pending (the value is correct) but log that
            # the broker path was not the source.
            shared_state.clear_pending_writeback("comfort_temp")
            ann.occurred(
                "COMFORT.writeback_internal_fallback",
                wrote=round(float(pw.value), 1),
                read=round(float(comfort_temp_rv.value), 1),
                elapsed_s=round(now - pw.written_at, 1),
                internal_key="pid_target_internal",
            )
        elif expired:
            # Outcome 3: deadline expired without a broker-sourced match.
            # Terminal hard-failure transition.
            ann.entered(
                "COMFORT.writeback_unverified",
                wrote=round(float(pw.value), 1),
                read=round(float(comfort_temp_rv.value), 1),
                source=comfort_temp_rv.source,
                topic=pw.key,
                elapsed_s=round(now - pw.written_at, 1),
                client_unavailable=pw.client_unavailable,
            )
            self.comfort_temp_writeback_unverified = True
            shared_state.clear_pending_writeback("comfort_temp")
        # else: no match yet, within deadline — do nothing, check next cycle.

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
        # INSTRUCTION-224C — per-emitter valve readings. Outer key: room.
        # Inner key: emitter stem from _mqtt_emitter_stem(topic). Aggregate
        # in valve_positions is recomputed as mean after the message loop.
        valve_positions_per_emitter: Dict[str, Dict[str, float]] = {}
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
            # INSTRUCTION-231B — valve_position candidates per room, in
            # declaration order, with quality so the post-loop resolution
            # step can apply the first-fresh-in-declaration-order rule
            # (parent INSTRUCTION-231 §"Driver-Parity Principle" — mirrors
            # the HA driver's 231A heating_entity list-form semantic).
            # Replaces 224C's mean-aggregation rule.
            _valve_position_candidates: Dict[
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
                    elif (
                        mapping.field == "valve_position"
                        and value is not None
                        and quality != "unavailable"
                    ):
                        # INSTRUCTION-231B — accumulate per-room candidates
                        # in declaration order (input_mappings preserves the
                        # topic_map list ordering from YAML). V2 LOW-2 fix:
                        # quality=="unavailable" candidates are presumed-
                        # untrustworthy (LWT offline / never-published /
                        # past the 7200s valve-unavailable threshold) and
                        # excluded at the routing site, NOT silently
                        # accumulated and skipped at resolution time. Post-
                        # loop resolution step picks first quality=="good"
                        # (first-fresh-in-declaration-order); supersedes
                        # 224C's mean-aggregation rule per parent §"Driver-
                        # Parity Principle". 224C's invariant (every
                        # valve_position mapping carries a non-None emitter)
                        # is preserved.
                        assert mapping.emitter is not None, (
                            f"valve_position mapping missing emitter for room "
                            f"{mapping.room}; topic_map.py Task 3 invariant violated"
                        )
                        _valve_position_candidates.setdefault(mapping.room, []).append(
                            (value, quality, mapping)
                        )
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

        # ── OR resolution for DHW demand (INSTRUCTION-126, amended by -301) ──
        # hot_water_active = OR across LIVE sources only; has_live_hot_water is
        # asserted iff at least one source produced an ON or LIVE-OFF reading —
        # UNAVAILABLE and UNRECOGNISED do not count. Single-sited write.
        # INSTRUCTION-301 — resolve from LIVE contributions only; hold last-
        # valid across non-live (comms-drop) periods within a bounded window
        # rather than voting False. A non-live UNAVAILABLE no longer forces
        # hot_water_active=False mid-DHW; a live OFF is respected immediately.
        _register_mqtt_events()
        _hw_ann = get_annunciator()
        _hw_sources = [
            (hw_active_value, hw_active_live),
            (hw_boolean_value, hw_boolean_live),
        ]
        _hw_now = time.time()
        _hw_hold_timeout = config.get("hot_water_stale_hold_s", HW_STALE_HOLD_DEFAULT_S)
        (
            hot_water_active,
            self._hw_last_valid_value,
            self._hw_last_valid_ts,
            _hw_used_hold,
        ) = resolve_hot_water_active(
            _hw_sources,
            self._hw_last_valid_value,
            self._hw_last_valid_ts,
            _hw_now,
            _hw_hold_timeout,
        )
        if _hw_used_hold:
            _hw_age_s = (
                _hw_now - self._hw_last_valid_ts
                if self._hw_last_valid_ts is not None else 0.0
            )
            _hw_ann.entered(
                "MQTT.hot_water_stale_lastvalid",
                held_value=hot_water_active,
                age_s=round(_hw_age_s, 1),
            )
        else:
            # Falling edge — live reading returned OR hold timed out. Clear
            # whichever held-value latch is set (at most one); the other is a
            # silent no-op.
            _hw_ann.exited("MQTT.hot_water_stale_lastvalid", held_value=True)
            _hw_ann.exited("MQTT.hot_water_stale_lastvalid", held_value=False)
        if hw_active_live or hw_boolean_live:
            capabilities["has_live_hot_water"] = True

        # ── Check delta_t capability (derived from return temp + flow temp) ──
        has_live_flow = capabilities.get("has_live_flow", False)
        has_live_return = capabilities.get("has_live_return_temp", False)
        has_live_flow_rate = capabilities.get("has_live_flow_rate", False)
        has_live_hot_water = capabilities.get("has_live_hot_water", False)

        # INSTRUCTION-231B V2 — replace 224C's mean aggregation with first-
        # fresh-in-declaration-order resolution with last-winner recovery.
        # Parent INSTRUCTION-231 §"Driver-Parity Principle" — same rule the
        # HA driver uses for operator-declared heating_entity list-form
        # (231A V2). Three-tier resolution:
        #
        #   Tier 1 (first-fresh):  iterate candidates in declaration order;
        #                          first quality=="good" wins. Update
        #                          self._last_winning_emitter_per_room.
        #
        #   Tier 2 (last-winner):  if no candidate is "good", look up the
        #                          most recent winning emitter for this
        #                          room and use its cached value if its
        #                          mapping is in this cycle's candidate list.
        #                          Mirrors HA V2's _last_winning_entity_per_room
        #                          recovery — prevents walking backward in
        #                          time when the winning emitter changed
        #                          between fresh cycles (V1 reviewer HIGH-1).
        #
        #   Tier 3 (cold-start):   if no winner has ever been recorded for
        #                          this room (genuinely fresh install,
        #                          first cycle), fall back to first
        #                          quality=="stale" in declaration order.
        #                          Defensive default for the never-fresh
        #                          edge case.
        #
        # Tier 1 candidates are guaranteed to have quality "good"; Tier 2
        # and 3 candidates have quality "stale" (V2 LOW-2 gate at Task 1c
        # excludes "unavailable" at the routing site).
        for _room, _candidates in _valve_position_candidates.items():
            # Tier 1 — first fresh wins.
            fresh = next(
                ((v, q, m) for (v, q, m) in _candidates if q == "good"),
                None,
            )
            if fresh is not None:
                v, _q, m = fresh
                valve_positions[_room] = round(float(v), 1)
                valve_positions_per_emitter[_room] = {m.emitter: float(v)}
                self._last_winning_emitter_per_room[_room] = m.emitter
                continue

            # Tier 2 — last-winner recovery.
            last_winner = self._last_winning_emitter_per_room.get(_room)
            if last_winner is not None:
                last_winner_entry = next(
                    (
                        (v, q, m)
                        for (v, q, m) in _candidates
                        if m.emitter == last_winner
                    ),
                    None,
                )
                if last_winner_entry is not None:
                    v, _q, m = last_winner_entry
                    valve_positions[_room] = round(float(v), 1)
                    valve_positions_per_emitter[_room] = {m.emitter: float(v)}
                    continue

            # Tier 3 — cold-start defensive: first stale-with-value.
            # Only reached when no winner has ever been recorded for this
            # room (fresh install, first-cycle-all-stale) OR when the
            # recorded winner's mapping is no longer present (operator
            # removed the topic from YAML between cycles).
            stale = next(
                ((v, q, m) for (v, q, m) in _candidates if q == "stale"),
                None,
            )
            if stale is not None:
                v, _q, m = stale
                valve_positions[_room] = round(float(v), 1)
                valve_positions_per_emitter[_room] = {m.emitter: float(v)}
                # Cold-start path: record this cycle's winner so the next
                # all-stale cycle has a Tier 2 anchor.
                self._last_winning_emitter_per_room[_room] = m.emitter
                continue

            # No candidates at all (all were "unavailable" and filtered at
            # the Pass 1 routing site, or the room has no valve_position
            # topics declared). Omit room entirely — matches the pre-224C
            # behaviour for rooms with no valve_position publisher.
            # per_emitter stays absent / empty for this room.

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

        # INSTRUCTION-268 — write-and-readback verification.
        self._verify_pending_writeback(comfort_temp_rv, now)

        # One-time startup audit (INSTRUCTION-105).  If source="internal" and
        # value is 20.0 when the user set something else, the persistence bug
        # is still present.
        if not self._comfort_startup_logged:
            logger.info(
                "MQTT comfort_temp startup: %.1f°C (source=%s, internal_key=pid_target_internal)",
                comfort_temp_rv.value, comfort_temp_rv.source,
            )
            self._comfort_startup_logged = True

        # INSTRUCTION-257 — Comfort-schedule-aware active comfort baseline.
        # The per-room override gate below must compare each room's resolved
        # comfort against the value the system is ACTIVELY targeting this
        # cycle, not the base configured comfort. When the global comfort
        # schedule is active, its resolved value is what the pipeline will
        # set ctx.target_temp to in sensor_controller._setup_room_targets.
        # Comparing against the base would emit overrides for every room
        # whose persisted pid_target_internal happens to differ from base —
        # silently masking the schedule for those rooms.
        #
        # External MQTT writes (room_comfort_rv.source == "external") still
        # win unconditionally below. This baseline change only affects the
        # implicit "internal value differs from base" branch.
        #
        # Coherence: ComfortScheduleStore.resolve is deterministic on its
        # timestamp argument. Passing `now` (which is also InputBlock.timestamp)
        # pins this resolve to the same instant the orchestrator-emitted
        # ctx.timestamp drives the sensor_controller resolve, eliminating
        # schedule-boundary races between the two callers within a cycle.
        _cs_temp = get_comfort_schedule_store().resolve(timestamp=now)
        active_comfort = _cs_temp if _cs_temp is not None else comfort_temp_rv.value

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
            # → schedule-active comfort (as default). Emitted into the overrides
            # map only when the resolved value is external OR differs from
            # the schedule-active comfort; otherwise the base target is already
            # correct. INSTRUCTION-257 — baseline is `active_comfort`, NOT
            # `comfort_temp_rv.value`, so persisted per-room values matching
            # the base do not silently override an active schedule.
            room_comfort_rv = self._resolve_mqtt_control(
                cache,
                f"control/{room_slug}/comfort_temp",
                f"room_internals.{room_slug}.pid_target_internal",
                default=active_comfort,
                validate=lambda s: _validate_range(s, 10.0, 30.0),
            )
            if (
                room_comfort_rv.source == "external"
                or room_comfort_rv.value != active_comfort
            ):
                per_room_comfort[room_slug] = room_comfort_rv.value

        # ── Per-source heat-source assembly (INSTRUCTION-241A Task 4) ──
        # Walk system_values for fields named "heat_source__<name>__<slot>"
        # and assemble into inputs.heat_sources[name] = HeatSourceReading(...).
        # Each source's HeatSourceReading defaults to the legacy flat-slot
        # values; only fields present in system_values are overwritten.
        from ...sensors import HeatSourceReading

        heat_sources_block: Dict[str, HeatSourceReading] = {}
        sources_cfg = config.get("heat_sources", []) or []
        for source_cfg in sources_cfg:
            name = source_cfg.get("name") or "heat_source"
            heat_sources_block.setdefault(name, HeatSourceReading(
                flow_temp=system_values.get("hp_flow_temp", 35.0),
                power=system_values.get("hp_power", 0.0),
                output=0.0,
                cop=system_values.get("hp_cop", 3.5),
                delta_t=computed_delta_t,
                return_temp=system_values.get("hp_return_temp", config.get("default_return_temp", 30.0)),
                flow_rate=system_values.get("flow_rate", 0.0),
                has_live_power=capabilities.get("has_live_power", False),
                has_live_cop=capabilities.get("has_live_cop", False),
                has_live_return_temp=has_live_return,
                has_live_flow_rate=has_live_flow_rate,
                has_live_delta_t=has_live_delta_t,
            ))

        for fkey, fval in list(system_values.items()):
            if not fkey.startswith("heat_source__"):
                continue
            # Format: heat_source__<name>__<slot> — split on the slot delimiter.
            # Source names cannot contain "__" by config validation (per config.py
            # name handling); slot vocabulary is fixed.
            try:
                _, name_slot = fkey.split("__", 1)
                name, slot = name_slot.rsplit("__", 1)
            except ValueError:
                continue
            reading = heat_sources_block.get(name)
            if reading is None:
                reading = HeatSourceReading()
                heat_sources_block[name] = reading
            if slot == "flow_temp":
                reading.flow_temp = fval
            elif slot == "power_input":
                reading.power = fval
                reading.has_live_power = True
            elif slot == "heat_output":
                reading.output = fval
            elif slot == "cop":
                reading.cop = fval
                reading.has_live_cop = True
            elif slot == "delta_t":
                reading.delta_t = fval
                reading.has_live_delta_t = True
            elif slot == "return_temp":
                reading.return_temp = fval
                reading.has_live_return_temp = True
            elif slot == "flow_rate":
                reading.flow_rate = fval
                reading.has_live_flow_rate = True
            elif slot == "total_energy":
                reading.total_energy = fval
            elif slot == "pump_power":
                reading.pump_power = fval

        # ── INSTRUCTION-332 — outdoor_temp last-valid hold + has_outdoor ──
        # Driver parity with the HA path (sensor_fetcher.py:1162-1186). A
        # cycle with no parsed outdoor candidate — quality "unavailable" (LWT
        # offline / age > threshold) OR a fresh-but-unparseable payload — must
        # ride the last live reading rather than collapsing to a synthetic 5.0
        # that is indistinguishable downstream and thrashes active_demand_kw.
        _register_mqtt_events()
        _oat_ann = get_annunciator()
        outdoor_declared = (
            any(m.field == "outdoor_temp" for m in tm.input_mappings)
            if tm else False
        )
        _oat_val = system_values.get("outdoor_temp")
        _oat_q = signal_quality.get("outdoor_temp")
        if _oat_val is not None and _oat_q == "good":
            # Fresh, parsed reading — use it, refresh the hold, flag measured.
            outdoor_temp = _oat_val
            self._outdoor_last_valid = _oat_val
            self._outdoor_last_valid_ts = now
            has_outdoor = True
            _oat_ann.exited("MQTT.outdoor_stale_lastvalid")
            _oat_ann.exited("MQTT.outdoor_stale_no_history")
        elif _oat_val is not None:
            # quality == "stale": the aged payload passes through (current
            # behaviour, not a substitution). has_outdoor=False so the
            # antifrost gate treats it as conservatively as the HA path; the
            # hold is NOT updated (refreshed on fresh readings only).
            outdoor_temp = _oat_val
            has_outdoor = False
            _oat_ann.exited("MQTT.outdoor_stale_lastvalid")
            _oat_ann.exited("MQTT.outdoor_stale_no_history")
        elif outdoor_declared:
            # No parsed candidate this cycle. q is never None when declared
            # (never-received resolves "unavailable"); a parse failure can
            # occur in either the good or stale band, hence two-valued reason.
            has_outdoor = False
            _oat_reason = "unavailable" if _oat_q == "unavailable" else "parse_failed"
            if self._outdoor_last_valid is not None:
                outdoor_temp = self._outdoor_last_valid
                _oat_age = (
                    now - self._outdoor_last_valid_ts
                    if self._outdoor_last_valid_ts is not None else 0.0
                )
                _oat_ann.entered(
                    "MQTT.outdoor_stale_lastvalid",
                    temp=round(outdoor_temp, 1),
                    age_s=int(_oat_age),
                    reason=_oat_reason,
                )
            else:
                outdoor_temp = 5.0
                _oat_ann.entered("MQTT.outdoor_stale_no_history", fallback=5.0)
        else:
            # No outdoor mapping configured — quiet hold-or-5.0 arm, mirroring
            # the HA no-entity branch (sensor_fetcher.py:1184-1186). No events.
            outdoor_temp = (
                self._outdoor_last_valid
                if self._outdoor_last_valid is not None else 5.0
            )
            has_outdoor = False

        return InputBlock(
            room_temps=room_temps,
            independent_sensors=independent_sensors,
            valve_positions=valve_positions,
            valve_positions_per_emitter={
                _r: dict(_em) for _r, _em in valve_positions_per_emitter.items()
            },
            avg_open_frac=avg_open_frac,
            outdoor_temp=outdoor_temp,
            has_outdoor=has_outdoor,
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
            heat_sources=heat_sources_block,
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
        _register_mqtt_events()
        ann = get_annunciator()
        control_enabled = config.get("control_enabled")
        if control_enabled is None:
            ann.entered("MQTT.control_enabled_missing")
            control_enabled = False
        else:
            ann.exited("MQTT.control_enabled_missing")

        prefix = config.get("mqtt", {}).get("topic_prefix", "")

        # ── Hardware commands (HP flow/mode) — active-source routed (279C) ──
        # Resolve active source from the single identity channel (parent
        # Decision 1); write_outputs has no ctx, but config["active_source_name"]
        # is written live every cycle by SSC.
        active_name = config.get("active_source_name")
        sources_by_name = {
            s.get("name", ""): s for s in config.get("heat_sources", [])
        }
        active_src = sources_by_name.get(active_name)

        from qsh.drivers.source_routing import resolve_source_routing
        routing = resolve_source_routing(config, active_src)

        # ── 329 D1: retained active-source annunciation ──────────────────
        # Publish the SSC-selected source to a retained status topic so back
        # ends can disambiguate transition traces (beta report). Edge-gated
        # on the last-published value; retain=True makes it survive both the
        # subscriber's reconnects and QSH restarts. NOT gated on
        # control_enabled — this is observability, not actuation (precedent:
        # the shadow/telemetry block below, "not gated on control_enabled").
        # The unprefixed shape is qsh/status/active_source (Task-3-style
        # empty-prefix default; _prefixed alone returns the bare suffix).
        # DEBUG-only log — no per-cycle operator-log line (T-33).
        if active_name:
            _active_topic = (
                f"{prefix}/status/active_source" if prefix
                else "qsh/status/active_source"
            )
            if active_name != getattr(self, "_last_published_active_source", None):
                self._mqtt.publish(
                    _active_topic, str(active_name), qos=1, retain=True,
                )
                self._last_published_active_source = active_name
                logger.debug("329 D1: published active_source=%s", active_name)

        if outputs.hardware_changed:
            if control_enabled:
                if not routing.dispatch_flow_mode:
                    # Suppress: non-primary active source with no actuator — do NOT
                    # fall through to the shared (primary) topics (parent §1 defect).
                    logger.debug(
                        "Active source '%s' unaddressable — suppressing continuous flow/mode publish",
                        active_name,
                    )
                elif (
                    routing.routed
                    and routing.control_method == "mqtt"
                    and routing.mqtt_flow_topic
                    and routing.mqtt_mode_topic
                ):
                    # Per-source addressing — publish verbatim to this source's topics
                    self._mqtt.publish(routing.mqtt_flow_topic, str(outputs.applied_flow))
                    self._mqtt.publish(routing.mqtt_mode_topic, outputs.applied_mode)
                else:
                    # Fall-back: existing shared output_mappings (prefixed) — unchanged path
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

        # ── 228A: per-source heat source commands ────────────────────────
        # No legacy fallback to heat_source_command. Single-source installs
        # receive a single-key dict synthesised by HardwareController.
        if outputs.source_changed and outputs.source_command:
            sources_by_name = {
                s.get("name", ""): s for s in config.get("heat_sources", [])
            }
            # 329 D4: default per-source command topic honours mqtt.topic_prefix.
            # Explicit source.mqtt.command_topic overrides remain verbatim
            # (command_topic_for_source handles that). Unprefixed installs:
            # byte-identical legacy default (qsh/heat_source/<slug>/command).
            _cmd_default_prefix = (
                f"{prefix}/heat_source" if prefix else "qsh/heat_source"
            )
            for source_name, cmd in outputs.source_command.items():
                src_cfg = sources_by_name.get(source_name)
                if src_cfg is None:
                    logger.warning(
                        "MQTT dispatch: unknown source '%s' — skipping",
                        source_name,
                    )
                    continue
                topic = command_topic_for_source(
                    src_cfg, default_prefix=_cmd_default_prefix,
                )
                # 329 D2: on retirement (cmd == "off"), also publish "off" to
                # the source's per-source mode topic verbatim — the continuous
                # flow/mode channel writes that topic while active, so without
                # this the MODE topic retains a stale "heat" after a mid-heat
                # switch (the tester's back end watches the MODE topic). The
                # mode_topic is consumed verbatim by resolve_source_routing
                # (source_routing.py:84-94, no prefixing), so the retirement
                # publish must match it exactly. The incoming source's "heat"
                # mode is NOT published here — the continuous channel owns it
                # (avoids a mode write racing ahead of its paired flow write).
                _mode_topic = (src_cfg.get("flow_control") or {}).get("mode_topic")
                if control_enabled:
                    self._mqtt.publish(topic, cmd, qos=1, retain=False)
                    if cmd == "off" and _mode_topic:
                        self._mqtt.publish(_mode_topic, "off")
                else:
                    logger.debug(
                        "SHADOW MODE: would publish %s -> %s", topic, cmd,
                    )
                    if cmd == "off" and _mode_topic:
                        logger.debug(
                            "SHADOW MODE: would publish %s -> off", _mode_topic,
                        )

        # ── Valve commands (MANUAL-aware per INSTRUCTION-225B) ──
        from qsh import manual_state

        # Build effective setpoints: pipeline output as base, MANUAL substitutions on top.
        # Also inject MANUAL rooms that the pipeline omitted from this cycle's dict, so
        # the override is re-asserted every cycle regardless of pipeline coverage.
        effective_setpoints: Dict[str, float] = dict(outputs.valve_setpoints)
        manual_rooms_active: set = set()
        for room in manual_state.configured_direct_rooms(config):
            entry = manual_state.get(room)
            if entry.mode == "MANUAL":
                # Defensive: position_pct cannot be None for a MANUAL entry per
                # set_manual's validation (225A Task 1), but the type is Optional[int]
                # at the dataclass level, so guard explicitly. Skip the room and log
                # rather than crash the publish loop on contract violation.
                if entry.position_pct is None:
                    logger.warning(
                        "manual_state contract violation: room %r MANUAL with position_pct=None; skipping publish",
                        room,
                    )
                    continue
                effective_setpoints[room] = float(entry.position_pct)
                manual_rooms_active.add(room)

        # Decide whether the publish loop runs at all.
        # Any MANUAL active forces the loop on (MANUAL bypasses shadow mode per parent §2.4).
        if outputs.valves_changed or manual_rooms_active:
            if control_enabled or manual_rooms_active:
                published_auto = 0
                published_manual = 0
                for om in self._topic_map.output_mappings:
                    if om.field != "valve_setpoint" or not om.room:
                        continue
                    if om.room not in effective_setpoints:
                        continue
                    room_in_manual = om.room in manual_rooms_active
                    if not control_enabled and not room_in_manual:
                        # Shadow mode active AND this room is AUTO — suppress this publish only.
                        continue
                    self._mqtt.publish(om.topic, str(effective_setpoints[om.room]))
                    if room_in_manual:
                        published_manual += 1
                    else:
                        published_auto += 1
                if published_manual:
                    logger.info(
                        "MANUAL override: published %d valve_setpoint(s) for %d room(s)",
                        published_manual, len(manual_rooms_active),
                    )
                if published_auto and not control_enabled:
                    # Defence-in-depth: this branch should be unreachable because
                    # control_enabled=False AND room not in manual_rooms_active is
                    # suppressed above. If it fires, log loud and continue.
                    logger.warning(
                        "MANUAL-aware gate inconsistency: %d AUTO publishes occurred under shadow mode",
                        published_auto,
                    )
            else:
                # Pure AUTO + shadow mode — original V1 behaviour.
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

        # 329 Task 5 — resolve the active source's routing once, and the
        # per-source command-topic default prefix, for the per-source publishes
        # added below. Active source from the single identity channel, falling
        # back to heat_sources[0] (cold-start / unset).
        from qsh.drivers.source_routing import resolve_source_routing

        _prefix = config.get("mqtt", {}).get("topic_prefix", "")
        _cmd_default_prefix = (
            f"{_prefix}/heat_source" if _prefix else "qsh/heat_source"
        )
        _heat_sources = config.get("heat_sources", []) or []
        _active_name = config.get("active_source_name")
        _by_name = {s.get("name", ""): s for s in _heat_sources}
        _active_src = _by_name.get(_active_name) or (
            _heat_sources[0] if _heat_sources else None
        )
        _active_resolved_name = (
            (_active_src or {}).get("name") if _active_src else None
        )
        _failsafe_routing = resolve_source_routing(config, _active_src)

        max_retries = 3
        retry_interval = 2  # seconds

        for attempt in range(1, max_retries + 1):
            try:
                logger.warning(
                    "FAILSAFE (attempt %d/%d): publishing flow=%.1f mode=%s",
                    attempt, max_retries, safe_flow, safe_mode,
                )
                # Shared output mappings — kept for maximal legacy reach.
                for om in self._topic_map.output_mappings:
                    if om.field == "applied_flow":
                        self._mqtt.publish(om.topic, str(safe_flow))
                    elif om.field == "applied_mode":
                        self._mqtt.publish(om.topic, safe_mode)

                # 329 Task 5 — the active source's per-source topics receive the
                # safe state when it is routed-mqtt (otherwise the shared topics
                # above ARE its actuator). Every NON-active source receives an
                # explicit "off" on its command topic and (when configured) its
                # mode topic — owner disposition 11 June 2026: mirror teardown's
                # all-off rationale and close the boot→first-edge and
                # crash-restart stale-retained-"heat" windows (recorded as
                # reviewer 328-V1 LOW-2, acknowledged at INSTRUCTION-328 V2 §1)
                # during the one event designed to drive safe state. "heat" is
                # NEVER published to a non-active source — a dual-source failsafe
                # must not light both burners.
                if (
                    _failsafe_routing.routed
                    and _failsafe_routing.control_method == "mqtt"
                    and _failsafe_routing.mqtt_flow_topic
                    and _failsafe_routing.mqtt_mode_topic
                ):
                    self._mqtt.publish(
                        _failsafe_routing.mqtt_flow_topic, str(safe_flow),
                    )
                    self._mqtt.publish(
                        _failsafe_routing.mqtt_mode_topic, safe_mode,
                    )
                for _src in _heat_sources:
                    if _src.get("name") == _active_resolved_name:
                        continue
                    self._mqtt.publish(
                        command_topic_for_source(
                            _src, default_prefix=_cmd_default_prefix,
                        ),
                        "off",
                        qos=1,
                        retain=False,
                    )
                    _src_mode = (_src.get("flow_control") or {}).get("mode_topic")
                    if _src_mode:
                        self._mqtt.publish(_src_mode, "off")

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

    def get_forecast_provider(self):
        """Return MQTTForecastProvider when mqtt.inputs.forecast.topic is
        configured (surfaced via config_entities["forecast_mqtt_topic"] by
        config.py per INSTRUCTION-220C Task 2); else NullForecastProvider.

        INSTRUCTION-220C activation of 220A's stub. Provider instance cached
        on self._forecast_provider after first construction. Per parent §2.6:
        this method is not invoked by main.py in production until 220D
        clearance — during the 220C->220D window the method exists and is
        callable from test code only.

        Loud-guard on pre-setup invocation (parent §2.6 + 220B V2 H-1
        disposition pattern): if get_forecast_provider() is called before
        self._mqtt is set (i.e., before setup()), raise RuntimeError —
        Protocol contract violation. Returning a stale NullForecastProvider
        would poison the cache permanently.
        """
        if hasattr(self, "_forecast_provider"):
            return self._forecast_provider
        # V2 M-1 fold: defensive hasattr pattern aligned with 220B V2's loud-guard.
        # MQTTDriver.__init__ does initialise self._mqtt = None (driver.py:203),
        # so `is None` check would work — but hasattr is robust to any future
        # __init__ refactor that defers initialisation.
        if not hasattr(self, "_mqtt") or self._mqtt is None:
            raise RuntimeError(
                "MQTTDriver.get_forecast_provider() called before setup() — "
                "Protocol contract violation. setup() must complete (establishing "
                "self._mqtt as a connected MQTTClient) before forecast provider "
                "construction."
            )
        forecast_topic = (
            self._config.get("entities", {}).get("forecast_mqtt_topic", "").strip()
        )
        if not forecast_topic:
            from ...forecast.providers.null import NullForecastProvider
            self._forecast_provider = NullForecastProvider()
        else:
            from ...forecast.providers.mqtt import MQTTForecastProvider
            self._forecast_provider = MQTTForecastProvider(
                mqtt_client=self._mqtt,
                topic=forecast_topic,
                topic_prefix=self._prefix,
            )
        return self._forecast_provider

    def wait(self) -> None:
        """Block for one cycle interval."""
        time.sleep(self._cycle_interval)

    # ── Manual override (INSTRUCTION-225B) ─────────────────────────────

    def apply_manual_position(self, room: str, position_pct: int, config: Dict) -> bool:
        """Publish an immediate MANUAL valve_setpoint for one room to MQTT.

        Fan-out over multi-topic rooms matches the AUTO write loop — every
        topic mapped to this room with field == 'valve_setpoint' receives the
        published value. Returns True if at least one topic was published,
        False on disconnected MQTT / indirect room / no matching mapping.
        Does not raise.
        """
        if not self._mqtt or not self._topic_map:
            logger.debug("MQTT not connected — MANUAL publish dropped for %s", room)
            return False

        try:
            from qsh import manual_state
            direct_rooms = set(manual_state.configured_direct_rooms(config))
        except Exception as e:  # noqa: BLE001 — defensive; never crash the hot path
            logger.warning("manual_state.configured_direct_rooms() failed: %s", e)
            return False

        if room not in direct_rooms:
            logger.info("Room %r is not a configured direct TRV; MANUAL publish skipped", room)
            return False

        pct = max(0, min(100, int(position_pct)))
        published = 0
        for om in self._topic_map.output_mappings:
            if om.field == "valve_setpoint" and om.room == room:
                try:
                    self._mqtt.publish(om.topic, str(float(pct)))
                    published += 1
                except Exception as e:  # noqa: BLE001
                    logger.warning("MQTT publish failed for %s -> %s: %s", room, om.topic, e)

        if published:
            logger.info("MANUAL: published %d topic(s) for %s at %d%%", published, room, pct)
        return published > 0

    def manual_state_snapshot(self, config: Dict) -> Dict[str, Any]:
        """Return MANUAL/AUTO state for every configured direct TRV."""
        from qsh import manual_state
        rooms = manual_state.configured_direct_rooms(config)
        return {r: manual_state.get(r) for r in rooms}
