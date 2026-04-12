"""Away mode API — toggle whole-house and per-zone away.

GET reads from SharedState (driver-agnostic).
PUT/write endpoints require HA driver — return 501 on non-HA until
a persistent AwayStateStore is implemented (INSTRUCTION-BR03-AWAY).
"""

import json
import math
import os
import logging
import time
import requests
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from qsh.paths import find_state_file, save_state_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/away", tags=["away"])

HA_TIMEOUT = 5
_AWAY_TIMESTAMPS_FILENAME = "away_timestamps.json"


# ── Activation Timestamp Helpers ──


def _load_timestamps() -> dict:
    """Load activation timestamps from persistent storage."""
    try:
        path = Path(find_state_file(_AWAY_TIMESTAMPS_FILENAME))
        if path.exists():
            return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load away timestamps: %s", e)
    return {}


def _save_timestamps(data: dict) -> None:
    """Write activation timestamps to persistent storage."""
    try:
        path = Path(os.path.join("/config", _AWAY_TIMESTAMPS_FILENAME))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        save_state_file(str(path))  # best-effort copy to /data/
    except OSError as e:
        logger.warning("Failed to save away timestamps: %s", e)


def _record_activation(key: str) -> None:
    """Store current time as activation timestamp for *key*.

    Only writes if *key* has no existing timestamp (OFF→ON transition).
    Mid-away duration changes (PUT with active=True while already active)
    must not reset the departure time.
    """
    ts = _load_timestamps()
    if key not in ts:
        ts[key] = time.time()
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
    elapsed_days = (time.time() - activated_at) / 86400.0
    remaining = days_set - elapsed_days
    # Round to nearest 0.5 day
    remaining = round(remaining * 2) / 2
    return max(remaining, 0.0)


def _get_ha_headers():
    """Lazily resolve HA Supervisor credentials."""
    token = os.getenv("SUPERVISOR_TOKEN")
    if not token:
        return None, None, None
    url = "http://supervisor/core"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return url, token, headers


def _slugify(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


def _mqtt_writeback(control_key: str, payload: str) -> None:
    """Publish to MQTT control topic if MQTT driver is active (36C Task 5)."""
    from ..state import shared_state

    config = shared_state.get_config()
    if config is None:
        return

    driver = config.get("driver", "ha")
    if driver != "mqtt":
        return

    prefix = config.get("mqtt", {}).get("topic_prefix", "")
    topic = f"{prefix}/control/{control_key}" if prefix else f"qsh/control/{control_key}"
    try:
        client = shared_state.get_mqtt_client()
        if client:
            client.publish(topic, payload, retain=True, qos=1)
    except Exception as e:
        logger.warning("MQTT write-back failed for %s: %s", control_key, e)


def _set_entity_state(entity_id: str, value: Any):
    """Set an HA entity's state via service call."""
    ha_url, _, ha_headers = _get_ha_headers()
    if not ha_headers:
        raise HTTPException(status_code=503, detail="No SUPERVISOR_TOKEN")

    if entity_id.startswith("input_boolean."):
        service = "turn_on" if value else "turn_off"
        payload = {"entity_id": entity_id}
        svc_domain = "input_boolean"
    elif entity_id.startswith("input_number."):
        service = "set_value"
        payload = {"entity_id": entity_id, "value": float(value)}
        svc_domain = "input_number"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported entity type: {entity_id}")

    try:
        resp = requests.post(
            f"{ha_url}/api/services/{svc_domain}/{service}",
            headers=ha_headers,
            json=payload,
            timeout=HA_TIMEOUT,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"HA service call failed: {e}")


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
    zones_recovering = snap.zones_recovering

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

    if shared_state.is_ha_driver():
        _set_entity_state("input_boolean.qsh_away_mode", active)
        if days is not None:
            _set_entity_state("input_number.qsh_days_away", days)
    else:
        # Non-HA path: write to internal config values
        config = shared_state.get_config()
        if not config:
            raise HTTPException(status_code=503, detail="Config not loaded")

        # 1. Update in-memory config (live effect, no restart)
        config["away_active_internal"] = active
        if days is not None:
            config["away_days_internal"] = float(days)

        # 2. Persist to YAML (survives restart)
        try:
            from .config import _load_raw_yaml, _save_yaml

            raw = _load_raw_yaml()
            if raw.get("rooms"):
                raw["away_active_internal"] = active
                if days is not None:
                    raw["away_days_internal"] = float(days)
                _save_yaml(raw)
            else:
                logger.warning("Skipping YAML persist: loaded config has no rooms")
        except Exception as e:
            logger.warning("Failed to persist away state: %s", e)

    # MQTT write-back for away state
    _mqtt_writeback("away", str(active).lower())
    if days is not None:
        _mqtt_writeback("away_days", str(float(days)))

    # Record or clear activation timestamp
    if active:
        _record_activation("whole_house")
    else:
        _clear_activation("whole_house")

    # If deactivating, clear per-zone aways too
    if not active:
        config = shared_state.get_config()
        if config:
            if shared_state.is_ha_driver():
                for room in config.get("rooms", {}).keys():
                    slug = _slugify(room)
                    _set_entity_state(f"input_boolean.qsh_{slug}_away", False)
                    _clear_activation(f"zone_{slug}")
            else:
                # Clear per-zone internals in-memory
                room_internals = config.get("room_internals", {})
                for room in config.get("rooms", {}).keys():
                    slug = _slugify(room)
                    room_cfg = room_internals.get(room, {})
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

    if shared_state.is_ha_driver():
        _set_entity_state(f"input_boolean.qsh_{slug}_away", active)
        if days is not None:
            _set_entity_state(f"input_number.qsh_{slug}_away_days", days)
    else:
        # Non-HA path: write to room_internals
        room_internals = config.setdefault("room_internals", {})
        room_cfg = room_internals.setdefault(room, {})
        room_cfg["away_active_internal"] = active
        if days is not None:
            room_cfg["away_days_internal"] = float(days)

    # MQTT write-back for per-zone away
    _mqtt_writeback(f"{room}/away", str(active).lower())
    if days is not None:
        _mqtt_writeback(f"{room}/away_days", str(float(days)))

    # Record or clear activation timestamp
    if active:
        _record_activation(f"zone_{slug}")
    else:
        _clear_activation(f"zone_{slug}")

    return {
        "set": room,
        "active": active,
        "days": days,
    }
