"""Away mode API — toggle whole-house and per-zone away.

GET reads from SharedState (driver-agnostic).
PUT/write endpoints require HA driver — return 501 on non-HA until
a persistent AwayStateStore is implemented (INSTRUCTION-BR03-AWAY).
"""

import logging
from typing import List

from fastapi import APIRouter, HTTPException

from ... import clock
from ...occupancy.away import load_away_stamps, save_away_stamps, stamp_value
from .control import _mqtt_writeback

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/away", tags=["away"])

# ── Activation Timestamp Helpers ──


def _load_timestamps() -> dict:
    """Load activation timestamps from persistent storage (INSTRUCTION-643:
    the store of qsh/occupancy/away.py, which the pipeline also reads)."""
    return load_away_stamps()


def _save_timestamps(data: dict) -> None:
    """Write activation timestamps to persistent storage (INSTRUCTION-643:
    the store of qsh/occupancy/away.py)."""
    save_away_stamps(data)


def _record_activation(key: str) -> None:
    """Store current time as activation timestamp for *key*.

    Only writes if *key* has no existing timestamp (OFF→ON transition).
    Mid-away duration changes (PUT with active=True while already active)
    must not reset the departure time.
    """
    ts = _load_timestamps()
    if key not in ts:
        ts[key] = clock.now()
        _save_timestamps(ts)


def _rearm_if_run_out(key: str, days) -> None:
    """INSTRUCTION-643 — remove the start time of *key* when its *days* (the
    days in force before this PUT, above 0) have run out: the Away now set
    is a new one, and _record_activation then starts it now."""
    try:
        d = float(days)
    except (TypeError, ValueError):
        return
    ts = _load_timestamps()
    stored = stamp_value(ts.get(key))
    if stored is not None and d > 0 and stored + d * 86400.0 <= clock.now():
        del ts[key]
        _save_timestamps(ts)


def _clear_activation(key: str) -> None:
    """Remove activation timestamp for *key*."""
    ts = _load_timestamps()
    if key in ts:
        del ts[key]
        _save_timestamps(ts)


def _days_remaining(key: str, days_set: float) -> float:
    """Compute remaining days, rounded to nearest 0.5, clamped >= 0.

    Falls back to *days_set* if no timestamp is stored (pre-update aways).
    """
    ts = _load_timestamps()
    activated_at = ts.get(key)
    if activated_at is None:
        return days_set
    elapsed_days = (clock.now() - activated_at) / 86400.0
    remaining = days_set - elapsed_days
    # Round to nearest 0.5 day
    remaining = round(remaining * 2) / 2
    return max(remaining, 0.0)


def _slugify(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


# ── Away State Read ──


@router.get("")
def get_away_state():
    """Return the current away mode state.

    Reads from SharedState (driver-agnostic). Away data is populated by
    SensorController each cycle from the driver's InputBlock.
    """
    from ..state import shared_state

    config = shared_state.get_config()
    snap = shared_state.get_snapshot()
    if not config:
        raise HTTPException(status_code=503, detail="Config not loaded")

    rooms = list(config.get("rooms", {}).keys())
    persistent_zones = config.get("persistent_zones", [])

    # Whole-house away state from pipeline snapshot (driver-agnostic)
    whole_house_active = snap.away_mode_active
    days_away = snap.away_days

    # Per-zone away states from pipeline snapshot
    comfort_temp = getattr(snap, "comfort_temp", None)
    per_zone = {}
    for room in rooms:
        zone_away_days = snap.per_zone_away.get(room, 0.0)
        # Room is active if present in per_zone_away dict (boolean ON in HA).
        # days=0 means indefinite, NOT inactive.
        zone_active = room in snap.per_zone_away

        # Room data from pipeline snapshot
        room_data = snap.rooms.get(room, {})

        # Derive effective setback depth from comfort_temp - target
        is_away = zone_active or whole_house_active
        target = room_data.get("target")
        if is_away and comfort_temp is not None and target is not None:
            depth = round(max(comfort_temp - target, 0.0), 1)
        else:
            depth = 0.0

        per_zone[room] = {
            "active": zone_active,
            "days": zone_away_days if zone_active else 1.0,
            "is_persistent": room in persistent_zones,
            "computed_depth_c": depth,
            "current_temp": room_data.get("temp"),
            "target_temp": room_data.get("target"),
            "occupancy_state": room_data.get("occupancy", "occupied"),
        }

    # Recovery status from pipeline
    recovery_active = snap.recovery_active

    # Compute recovery estimates per room
    recovery_rooms = {}
    if recovery_active:
        for room in rooms:
            room_data = snap.rooms.get(room, {})
            temp = room_data.get("temp")
            target = room_data.get("target")
            if temp is not None and target is not None and temp < target - 0.5:
                delta = target - temp
                est_minutes = int(delta / 0.5 * 15)
                recovery_rooms[room] = {
                    "current_temp": temp,
                    "target_temp": target,
                    "delta_c": round(delta, 1),
                    "estimated_minutes": est_minutes,
                }

    return {
        "whole_house": {
            "active": whole_house_active,
            "days": days_away,
            "days_remaining": _days_remaining("whole_house", days_away) if whole_house_active else None,
        },
        "per_zone": per_zone,
        "recovery": {
            "active": recovery_active,
            "rooms": recovery_rooms,
        },
        "operating_state": snap.operating_state,
    }


# ── Away State Write ──


@router.put("")
def set_away_mode(body: dict):
    """Set whole-house away mode.

    Expects body:
    {
      "active": true,
      "days": 3.0
    }

    HA driver: writes to HA helper entities.
    Non-HA (MQTT/mock): writes away_active_internal and away_days_internal
    to in-memory config and persists to qsh.yaml.
    """
    from ..state import shared_state

    active = body.get("active", False)
    days = body.get("days")

    # Update in-memory config (live effect, no restart).
    # Per INSTRUCTION-168 (HA Away Toggle Persistence Fix), config["away_active_internal"]
    # is now the canonical store for both HA and MQTT drivers. The pre-fix HA branch wrote
    # to input_boolean.qsh_away_mode / input_number.qsh_days_away; those helpers were
    # retired with INSTRUCTION-44 (HA helper auto-creation removal) and have no consumers.
    # Do not "restore" the HA branch on the assumption it was load-bearing — the HA
    # driver reads from this key at qsh/drivers/ha/driver.py:261-262.
    config = shared_state.get_config()
    if not config:
        raise HTTPException(status_code=503, detail="Config not loaded")

    prior_days = config.get("away_days_internal")
    config["away_active_internal"] = active
    if days is not None:
        config["away_days_internal"] = float(days)

    # Persist to YAML (survives restart).
    # _apply_away is intentionally inline as a closure capturing `active` and `days` from
    # the enclosing PUT-handler scope — these per-call values are what read_modify_write
    # applies to the YAML. Do not promote module-level.
    try:
        from .config import read_modify_write

        def _apply_away(raw: dict) -> dict:
            raw["away_active_internal"] = active
            if days is not None:
                raw["away_days_internal"] = float(days)
            return raw
        read_modify_write(_apply_away)
    except Exception as e:
        logger.warning("Failed to persist away state: %s", e)

    # MQTT write-back for away state
    _mqtt_writeback("away", str(active).lower())
    if days is not None:
        _mqtt_writeback("away_days", str(float(days)))

    # Record or clear activation timestamp
    if active:
        _rearm_if_run_out("whole_house", prior_days)
        _record_activation("whole_house")
    else:
        _clear_activation("whole_house")

    # If deactivating, clear per-zone aways too
    if not active:
        config = shared_state.get_config()
        if config:
            # Per-zone state is in-memory-only by design — see Task 2 comment.
            room_internals = config.setdefault("room_internals", {})
            for room in config.get("rooms", {}).keys():
                slug = _slugify(room)
                room_cfg = room_internals.setdefault(room, {})
                room_cfg["away_active_internal"] = False
                _clear_activation(f"zone_{slug}")

    return {
        "set": "whole_house",
        "active": active,
        "days": days,
        "message": "Away mode "
        + ("activated" if active else "deactivated")
        + ". Pipeline will update on next cycle (~30s).",
    }


@router.put("/{room}")
def set_zone_away(room: str, body: dict):
    """Set per-zone away mode for a single room.

    Expects body:
    {
      "active": true,
      "days": 7.0
    }

    HA driver: writes to HA helper entities.
    Non-HA (MQTT/mock): writes per-room away_active_internal and
    away_days_internal to in-memory config (room_internals dict).
    """
    from ..state import shared_state

    config = shared_state.get_config()
    if not config or room not in config.get("rooms", {}):
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")

    active = body.get("active", False)
    days = body.get("days", 1.0)
    slug = _slugify(room)

    # Per-zone away state is intentionally ephemeral on disk: writes only to the
    # in-memory config["room_internals"] map, not to qsh.yaml. This mirrors the
    # pre-fix non-HA branch behaviour and keeps this fix narrowly scoped to the
    # whole-house round-trip. Whether per-zone away should persist across addon
    # restarts is a separate decision — see INSTRUCTION-168 → Future Work for the
    # persistence follow-up.
    room_internals = config.setdefault("room_internals", {})
    room_cfg = room_internals.setdefault(room, {})
    prior_days = room_cfg.get("away_days_internal")
    room_cfg["away_active_internal"] = active
    if days is not None:
        room_cfg["away_days_internal"] = float(days)

    # MQTT write-back for per-zone away
    _mqtt_writeback(f"{room}/away", str(active).lower())
    if days is not None:
        _mqtt_writeback(f"{room}/away_days", str(float(days)))

    # Record or clear activation timestamp
    if active:
        _rearm_if_run_out(f"zone_{slug}", prior_days)
        _record_activation(f"zone_{slug}")
    else:
        _clear_activation(f"zone_{slug}")

    return {
        "set": room,
        "active": active,
        "days": days,
    }


def end_expired_away(whole_house: bool, rooms: List[str]) -> None:
    """INSTRUCTION-643 — switch off each Away scope whose days ran out, by
    the operator's own path: the PUT handlers above, with active false and
    no days. The main loop calls it when the pipeline asks for an end; an
    end that does not take is asked for again (AWAY_END_RETRY_S)."""
    if whole_house:
        set_away_mode({"active": False})
    for room in rooms:
        try:
            set_zone_away(room, {"active": False, "days": None})
        except HTTPException as e:
            logger.warning("AWAY: end of the away of room %s failed: %s", room, e.detail)
