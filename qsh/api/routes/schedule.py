"""Schedule CRUD — read/write native schedule store for occupancy."""

import logging
from typing import Dict, List

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedule", tags=["schedule"])

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday")
WEEKENDS = ("saturday", "sunday")
ALL_DAYS = WEEKDAYS + WEEKENDS

# ── Internal format presets (OccupancyResolver-compatible) ──

PRESETS = {
    "weekday_9_to_5": {
        "weekday": "07:00-09:00,17:00-23:00",
        "weekend": "07:00-23:00",
    },
    "always_home": "always",
    "school_hours": {
        "weekday": "07:00-09:00,15:00-23:00",
        "weekend": "08:00-23:00",
    },
    "bedrooms_overnight": "21:00-23:59,00:00-08:00",
}


# ── Conversion helpers ──


def _blocks_to_timestr(blocks: List[dict]) -> str:
    """Convert [{from: "07:00:00", to: "23:00:00"}] → "07:00-23:00".

    - Strips seconds from HH:MM:SS → HH:MM
    - Joins multiple blocks with comma
    - Single block 00:00–23:59 (any seconds value) → "always"
    - Empty list → ""
    """
    if not blocks:
        return ""

    if len(blocks) == 1:
        f = blocks[0]["from"][:5]
        t = blocks[0]["to"][:5]
        if f == "00:00" and t == "23:59":
            return "always"

    parts = []
    for b in blocks:
        f = b["from"][:5]  # HH:MM:SS → HH:MM
        t = b["to"][:5]
        parts.append(f"{f}-{t}")
    return ",".join(parts)


def _timestr_to_blocks(timestr: str) -> List[dict]:
    """Reverse: "07:00-09:00,17:00-23:00" → [{from: "07:00:00", to: "09:00:00"}, ...].

    - Appends ":00" seconds to HH:MM → HH:MM:SS
    - "always" → [{from: "00:00:00", to: "23:59:59"}]
    - Empty string → []
    """
    if not timestr:
        return []

    if timestr.strip().lower() == "always":
        return [{"from": "00:00:00", "to": "23:59:59"}]

    blocks = []
    for part in timestr.split(","):
        part = part.strip()
        if not part:
            continue
        pieces = part.split("-")
        if len(pieces) != 2:
            continue
        f = pieces[0].strip()
        t = pieces[1].strip()
        # Append :00 if only HH:MM
        if len(f) == 5:
            f += ":00"
        if len(t) == 5:
            t += ":00"
        blocks.append({"from": f, "to": t})
    return blocks


def _week_schedule_to_internal(week: dict):
    """Convert frontend WeekSchedule to OccupancyResolver storage format.

    Collapsing logic (most compact valid representation):
    1. All 7 days identical → return that string
    2. Mon–Fri identical AND Sat–Sun identical → {"weekday": "...", "weekend": "..."}
    3. Otherwise → {"monday": "...", ...} (7 individual keys)
    """
    day_strs = {}
    for day in ALL_DAYS:
        blocks = week.get(day, [])
        day_strs[day] = _blocks_to_timestr(blocks)

    values = list(day_strs.values())

    # All 7 identical → single string
    # "" is valid (never occupied) — do NOT coerce to "always"
    if len(set(values)) == 1:
        return values[0]

    # Weekday/weekend split
    weekday_vals = [day_strs[d] for d in WEEKDAYS]
    weekend_vals = [day_strs[d] for d in WEEKENDS]
    if len(set(weekday_vals)) == 1 and len(set(weekend_vals)) == 1:
        return {"weekday": weekday_vals[0], "weekend": weekend_vals[0]}

    # Per-day (7 keys)
    return dict(day_strs)


def _internal_to_week_schedule(internal) -> dict:
    """Reverse: OccupancyResolver format → frontend WeekSchedule.

    Input forms:
    - str: uniform schedule, apply to all 7 days
    - dict with "weekday"/"weekend": expand to 7 days
    - dict with individual day names: map directly
    - dict with mixed keys: specific days take precedence, groups fill gaps
    """
    if isinstance(internal, str):
        blocks = _timestr_to_blocks(internal)
        return {day: list(blocks) for day in ALL_DAYS}

    if isinstance(internal, dict):
        result = {}
        for day in ALL_DAYS:
            if day in internal:
                result[day] = _timestr_to_blocks(internal[day])
            elif day in WEEKDAYS and "weekday" in internal:
                result[day] = _timestr_to_blocks(internal["weekday"])
            elif day in WEEKENDS and "weekend" in internal:
                result[day] = _timestr_to_blocks(internal["weekend"])
            else:
                result[day] = _timestr_to_blocks("always")
        return result

    # Fallback
    blocks = _timestr_to_blocks("always")
    return {day: list(blocks) for day in ALL_DAYS}


def _room_occupancy_sensor_descriptor(
    config: dict, room: str
) -> tuple[bool, str | None]:
    """Return (has_sensor, sensor_entity_or_topic) for a room.

    Driver-agnostic. Recognises both:
      • HA driver:   top-level config['room_occupancy_sensors'][room]
                     (string entity_id, or {'entity': '...'} dict)
      • MQTT driver: config['room_mqtt_topics'][room]['occupancy_sensor']
                     (post-loaded canonical shape — qsh/config.py:1028
                     extracts inline `rooms.<room>.mqtt_topics` from yaml
                     into this top-level mapping; consumed by
                     qsh/drivers/mqtt/topic_map.py:496);
                     also tolerates the inline yaml shape
                     config['rooms'][room]['mqtt_topics']['occupancy_sensor']
                     for tests / pre-load callers.
                     (string topic, or mapping dict with 'topic'/'raw' keys)

    Precedence (locked in by tests in this instruction): when both sources
    declare the same room — a partially-migrated install — the HA path wins
    to preserve historic behaviour. Falsy HA entries (empty string, None,
    {'entity': None}, {}) fall through to the MQTT path so a half-edited
    HA stub does not mask a live MQTT topic.

    For an MQTT mapping dict missing both 'topic' and 'raw' keys, the
    sensor is still considered declared but the entity label is reported
    as None — config-validation should normally prevent this shape.

    Returns (False, None) when neither source declares a sensor for the room.
    """
    # HA-style: top-level mapping written by qsh/drivers/ha/driver.py.
    ha_map = config.get("room_occupancy_sensors", {}) or {}
    ha_cfg = ha_map.get(room)
    if ha_cfg:
        if isinstance(ha_cfg, dict):
            entity = ha_cfg.get("entity")
            if entity:
                return True, entity
            # falsy entity → fall through to MQTT path
        else:
            return True, str(ha_cfg)

    # MQTT-style: post-loaded canonical location is config['room_mqtt_topics'].
    # Fall back to the inline yaml shape config['rooms'][room]['mqtt_topics']
    # in case a caller passes pre-load data (e.g. a test fixture).
    mqtt_topics = (config.get("room_mqtt_topics", {}) or {}).get(room) or {}
    if not isinstance(mqtt_topics, dict):
        mqtt_topics = {}
    if "occupancy_sensor" not in mqtt_topics:
        room_cfg = (config.get("rooms", {}) or {}).get(room)
        if isinstance(room_cfg, dict):
            inline = room_cfg.get("mqtt_topics", {}) or {}
            if isinstance(inline, dict):
                mqtt_topics = inline

    occ = mqtt_topics.get("occupancy_sensor")
    if occ:
        if isinstance(occ, dict):
            label = occ.get("topic") or occ.get("raw")
            return True, (str(label) if label else None)
        return True, str(occ)

    return False, None


# ── Routes ──


@router.get("")
def get_all_schedules():
    """Return occupancy schedules for all rooms."""
    from ..state import shared_state
    from ...occupancy.schedule_store import get_schedule_store

    config = shared_state.get_config()
    if not config:
        raise HTTPException(status_code=503, detail="Config not loaded")

    store = get_schedule_store()
    all_rooms = store.get_all()
    rooms_in_config = list(config.get("rooms", {}).keys())
    snap = shared_state.get_snapshot()

    result = {}
    for room in rooms_in_config:
        cfg = all_rooms.get(room)

        if cfg:
            schedule_week = _internal_to_week_schedule(cfg["schedule"])
            enabled = cfg.get("enabled", True)
        else:
            # Room has no schedule configured yet — default to always
            schedule_week = _internal_to_week_schedule("always")
            enabled = True

        # Current state from pipeline snapshot
        current_state = "unknown"
        if snap and snap.rooms:
            room_data = snap.rooms.get(room, {})
            current_state = room_data.get("occupancy", "occupied")

        has_sensor, sensor_entity = _room_occupancy_sensor_descriptor(config, room)

        result[room] = {
            "enabled": enabled,
            "schedule": schedule_week,
            "current_state": current_state,
            "has_occupancy_sensor": has_sensor,
            "occupancy_sensor_entity": sensor_entity,
        }

    return {"rooms": result}


@router.get("/{room}")
def get_room_schedule(room: str):
    """Return the occupancy schedule for a single room."""
    all_schedules = get_all_schedules()
    if room not in all_schedules["rooms"]:
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")
    return all_schedules["rooms"][room]


@router.put("/{room}")
def update_room_schedule(room: str, body: dict):
    """Update the occupancy schedule for a room."""
    from ..state import shared_state
    from ...occupancy.schedule_store import get_schedule_store

    config = shared_state.get_config()
    if not config:
        raise HTTPException(status_code=503, detail="Config not loaded")
    if room not in config.get("rooms", {}):
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")

    store = get_schedule_store()
    week_schedule = body.get("schedule")
    enabled = body.get("enabled")

    if week_schedule:
        internal = _week_schedule_to_internal(week_schedule)
        current = store.get_room(room)
        en = enabled if enabled is not None else (current.get("enabled", True) if current else True)
        try:
            store.set_room(room, internal, enabled=en)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    elif enabled is not None:
        store.set_enabled(room, enabled)

    return {"status": "ok", "room": room}


@router.post("/{room}/copy")
def copy_schedule(room: str, body: dict):
    """Copy a room's schedule to other rooms."""
    from ...occupancy.schedule_store import get_schedule_store

    store = get_schedule_store()
    source = store.get_room(room)
    if not source:
        raise HTTPException(status_code=404, detail=f"No schedule for {room}")

    targets = body.get("target_rooms", [])
    for target in targets:
        store.set_room(target, source["schedule"], enabled=source.get("enabled", True))

    return {"status": "ok", "copied_to": targets}


@router.post("/{room}/preset")
def apply_preset(room: str, body: dict):
    """Apply a schedule preset to a room."""
    from ..state import shared_state
    from ...occupancy.schedule_store import get_schedule_store

    config = shared_state.get_config()
    if not config:
        raise HTTPException(status_code=503, detail="Config not loaded")
    if room not in config.get("rooms", {}):
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")

    preset_name = body.get("preset", "always_home")
    if preset_name not in PRESETS:
        raise HTTPException(status_code=400, detail=f"Unknown preset: {preset_name}")

    store = get_schedule_store()
    internal = PRESETS[preset_name]
    store.set_room(room, internal, enabled=True)

    return {"status": "ok", "room": room, "preset": preset_name}
