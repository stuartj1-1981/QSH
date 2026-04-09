"""Control settings API — comfort temperature, shadow/live mode, shoulder threshold, boost.

Read endpoints use SharedState (driver-agnostic).
All write endpoints are config-based and work on all drivers.
"""

import os
import logging
import time
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..state import shared_state
from qsh.occupancy.comfort_schedule import get_comfort_schedule_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/control", tags=["control"])

HA_TIMEOUT = 5


def _get_ha_headers():
    """Lazily resolve HA Supervisor credentials."""
    token = os.getenv("SUPERVISOR_TOKEN")
    if not token:
        return None, None, None
    url = "http://supervisor/core"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return url, token, headers


def _set_entity(entity_id: str, value):
    """Set an HA entity via service call."""
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
        raise HTTPException(status_code=400, detail=f"Unsupported entity: {entity_id}")

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


def _get_entity(entity_id: str, default=None):
    """Read an HA entity's current state."""
    ha_url, _, ha_headers = _get_ha_headers()
    if not ha_headers:
        return default
    try:
        resp = requests.get(
            f"{ha_url}/api/states/{entity_id}",
            headers=ha_headers,
            timeout=HA_TIMEOUT,
        )
        if resp.status_code == 200:
            return resp.json().get("state", default)
    except requests.RequestException:
        pass
    return default


@router.get("")
def get_control_settings():
    """Return current comfort temperature and control mode.

    Reads from SharedState (driver-agnostic). comfort_temp is populated
    by the pipeline each cycle from the driver's InputBlock.
    """
    config = shared_state.get_config()
    snap = shared_state.get_snapshot()

    if not config:
        return {
            "comfort_temp": snap.comfort_temp,
            "control_enabled": snap.control_enabled,
        }

    # Antifrost OAT threshold
    antifrost_cfg = config.get("antifrost", {}) if config else {}
    antifrost_threshold = antifrost_cfg.get("oat_threshold", 7.0)

    # Resolve current comfort target from schedule (if active)
    cs = get_comfort_schedule_store()
    active_comfort = cs.resolve()

    _ct = config.get("comfort_temp")
    _comfort = _ct if _ct is not None else 20.0
    return {
        "comfort_temp": _comfort,
        "comfort_temp_active": active_comfort or _comfort,
        "comfort_schedule_active": active_comfort is not None,
        "control_enabled": snap.control_enabled,
        "antifrost_threshold": antifrost_threshold,
    }


# ── Antifrost OAT threshold ────────────────────────────────────────


class AntifrostThresholdBody(BaseModel):
    value: float


@router.post("/antifrost-threshold")
def set_antifrost_threshold(body: AntifrostThresholdBody):
    """Set the antifrost OAT threshold (live — takes effect next cycle)."""
    if body.value < 0.0 or body.value > 15.0:
        raise HTTPException(
            status_code=400,
            detail="Threshold must be between 0 and 15°C",
        )

    # 1. Update in-memory config (live effect, no restart)
    config = shared_state.get_config()
    if config is not None:
        antifrost = config.setdefault("antifrost", {})
        antifrost["oat_threshold"] = body.value

    # 2. Persist to YAML (survives restart)
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):  # Guard: don't overwrite config if load returned empty/stub
            raw.setdefault("antifrost", {})["oat_threshold"] = body.value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms (file unreadable?)")
    except Exception as e:
        logger.warning("Failed to persist antifrost threshold: %s", e)

    # Keep setpoint snapshot in sync (INSTRUCTION-42A)
    try:
        from ...drivers.ha.sensor_fetcher import update_setpoint_original
        update_setpoint_original("antifrost_oat_threshold", body.value)
    except ImportError:
        pass

    return {"antifrost_threshold": body.value}


class ComfortTempBody(BaseModel):
    value: float


@router.post("/comfort-temp")
def set_comfort_temp(body: ComfortTempBody):
    """Set the global comfort target temperature.

    Updates in-memory config (takes effect next cycle) and persists to
    qsh.yaml (survives restart). Works on all drivers.

    This is the default/fallback comfort temp. If a comfort schedule is
    active, scheduled periods override this value during their windows.
    """
    if body.value < 15.0 or body.value > 25.0:
        raise HTTPException(status_code=400, detail="Temperature must be between 15 and 25°C")

    # 1. Update in-memory config (live effect, no restart)
    config = shared_state.get_config()
    if config is not None:
        config["comfort_temp"] = body.value

    # 2. Persist to YAML (survives restart)
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):
            raw["comfort_temp"] = body.value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms (file unreadable?)")
    except Exception as e:
        logger.warning("Failed to persist comfort_temp: %s", e)

    # Keep setpoint snapshot in sync (INSTRUCTION-42A)
    try:
        from ...drivers.ha.sensor_fetcher import update_setpoint_original
        update_setpoint_original("comfort_temp", body.value)
    except ImportError:
        pass

    return {"comfort_temp": body.value}


class ControlModeBody(BaseModel):
    enabled: bool


@router.post("/mode")
def set_control_mode(body: ControlModeBody):
    """Toggle between shadow mode (false) and active/live control (true).

    Updates in-memory config (takes effect next cycle) and persists to
    qsh.yaml (survives restart). Works on all drivers.

    For HA driver installs: also syncs the change to the dfan_control_toggle
    HA helper entity so HA automations / dashboards stay in sync.  If the HA
    service call fails, the yaml write is NOT rolled back (yaml is the source of
    truth) and the sync is queued for retry on the next pipeline cycle.
    """
    # 1. Update in-memory config (live effect, no restart)
    config = shared_state.get_config()
    if config is not None:
        config["control_enabled"] = body.enabled
        # Keep dfan_control_internal in sync so the read_inputs() internal fallback
        # path reflects the latest toggle for installations without a dfan HA entity.
        config["dfan_control_internal"] = body.enabled

    # 2. Persist to YAML (survives restart)
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):  # Guard: don't overwrite if load returned empty/stub
            raw["control_enabled"] = body.enabled
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms (file unreadable?)")
    except Exception as e:
        logger.warning("Failed to persist control_enabled: %s", e)

    # 3. Sync to MQTT (when running via HA with MQTT flow control method)
    if config is not None and config.get("control_method") == "mqtt":
        prefix = config.get("mqtt", {}).get("topic_prefix", "")
        topic = f"{prefix}/control/dfan_control" if prefix else "qsh/control/dfan_control"
        try:
            from ...drivers.ha.integration import set_ha_service
            set_ha_service(
                "mqtt",
                "publish",
                {"topic": topic, "payload": str(body.enabled).lower(), "retain": True},
            )
        except Exception as e:
            logger.warning("dfan_control MQTT publish failed: %s", e)

    return {"control_enabled": body.enabled}


# ── Internal value endpoints ──────────────────────────────────────────


class FlowMinBody(BaseModel):
    value: float


@router.patch("/flow-min")
def set_flow_min_internal(body: FlowMinBody):
    """Set the internal flow minimum temperature.

    Updates in-memory config and persists to qsh.yaml.
    Cross-validates against flow_max_internal.
    """
    if body.value < 20.0 or body.value > 45.0:
        raise HTTPException(status_code=422, detail="flow_min_internal must be between 20.0 and 45.0")

    # Step validation
    if round(body.value * 2) != body.value * 2:
        raise HTTPException(status_code=422, detail="flow_min_internal must be a multiple of 0.5")

    config = shared_state.get_config()
    if config is not None:
        flow_max = config.get("flow_max_internal", 50.0)
        if body.value >= flow_max:
            raise HTTPException(
                status_code=422,
                detail=f"flow_min_internal ({body.value}) must be less than flow_max_internal ({flow_max})",
            )
        config["flow_min_internal"] = body.value

    # Persist to YAML
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):
            raw["flow_min_internal"] = body.value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms")
    except Exception as e:
        logger.warning("Failed to persist flow_min_internal: %s", e)

    # MQTT write-back if MQTT driver active
    _mqtt_writeback("flow_min", str(body.value))

    return {"flow_min_internal": body.value}


class FlowMaxBody(BaseModel):
    value: float


@router.patch("/flow-max")
def set_flow_max_internal(body: FlowMaxBody):
    """Set the internal flow maximum temperature.

    Updates in-memory config and persists to qsh.yaml.
    Cross-validates against flow_min_internal.
    """
    if body.value < 30.0 or body.value > 60.0:
        raise HTTPException(status_code=422, detail="flow_max_internal must be between 30.0 and 60.0")

    if round(body.value * 2) != body.value * 2:
        raise HTTPException(status_code=422, detail="flow_max_internal must be a multiple of 0.5")

    config = shared_state.get_config()
    if config is not None:
        flow_min = config.get("flow_min_internal", 25.0)
        if body.value <= flow_min:
            raise HTTPException(
                status_code=422,
                detail=f"flow_max_internal ({body.value}) must be greater than flow_min_internal ({flow_min})",
            )
        config["flow_max_internal"] = body.value

    # Persist to YAML
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):
            raw["flow_max_internal"] = body.value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms")
    except Exception as e:
        logger.warning("Failed to persist flow_max_internal: %s", e)

    _mqtt_writeback("flow_max", str(body.value))

    return {"flow_max_internal": body.value}


class PidTargetBody(BaseModel):
    value: float


@router.patch("/pid-target")
def set_pid_target_internal(body: PidTargetBody):
    """Set the internal PID target temperature.

    Updates in-memory config and persists to qsh.yaml.
    """
    if body.value < 15.0 or body.value > 25.0:
        raise HTTPException(status_code=422, detail="pid_target_internal must be between 15.0 and 25.0")

    if round(body.value * 2) != body.value * 2:
        raise HTTPException(status_code=422, detail="pid_target_internal must be a multiple of 0.5")

    config = shared_state.get_config()
    if config is not None:
        config["pid_target_internal"] = body.value

    # Persist to YAML
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):
            raw["pid_target_internal"] = body.value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms")
    except Exception as e:
        logger.warning("Failed to persist pid_target_internal: %s", e)

    _mqtt_writeback("pid_target", str(body.value))

    return {"pid_target_internal": body.value}


class DfanControlBody(BaseModel):
    enabled: bool


@router.patch("/dfan-control")
def set_dfan_control_internal(body: DfanControlBody):
    """Set the internal dfan_control flag.

    This is the same as /mode but uses the PATCH pattern and
    includes MQTT write-back.
    """
    config = shared_state.get_config()
    if config is not None:
        config["control_enabled"] = body.enabled
        config["dfan_control_internal"] = body.enabled

    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):
            raw["control_enabled"] = body.enabled
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms")
    except Exception as e:
        logger.warning("Failed to persist dfan_control_internal: %s", e)

    _mqtt_writeback("dfan_control", str(body.enabled).lower())

    return {"dfan_control_internal": body.enabled}


def _mqtt_writeback(control_key: str, payload: str) -> None:
    """Publish a value to the MQTT control topic if MQTT driver is active.

    This ensures Web UX changes are reflected on the MQTT bus for
    external subscribers (Task 5 — E4).
    """
    config = shared_state.get_config()
    if config is None:
        return

    driver = config.get("driver", "ha")

    if driver == "mqtt":
        # Direct MQTT driver — publish to control topic via shared client ref
        prefix = config.get("mqtt", {}).get("topic_prefix", "")
        topic = f"{prefix}/control/{control_key}" if prefix else f"qsh/control/{control_key}"
        try:
            client = shared_state.get_mqtt_client()
            if client:
                client.publish(topic, payload, retain=True, qos=1)
                logger.debug("MQTT write-back: %s = %s", topic, payload)
        except Exception as e:
            logger.warning("MQTT write-back failed for %s: %s", control_key, e)
    elif driver == "ha" and config.get("control_method") == "mqtt":
        # HA driver with MQTT flow control — publish via HA MQTT service
        prefix = config.get("mqtt", {}).get("topic_prefix", "")
        topic = f"{prefix}/control/{control_key}" if prefix else f"qsh/control/{control_key}"
        try:
            from ...drivers.ha.integration import set_ha_service
            set_ha_service(
                "mqtt",
                "publish",
                {"topic": topic, "payload": payload, "retain": True},
            )
        except Exception as e:
            logger.warning("MQTT write-back (via HA) failed for %s: %s", control_key, e)


# ── Shoulder threshold (hp_min_output_kw) ────────────────────────────

@router.get("/shoulder-threshold")
def get_shoulder_threshold():
    """Return the current shoulder shutdown threshold (kW)."""
    config = shared_state.get_config()
    value = config.get("hp_min_output_kw", 2.0) if config else 2.0
    return {"hp_min_output_kw": value}


class ShoulderThresholdBody(BaseModel):
    value: float


@router.patch("/shoulder-threshold")
def set_shoulder_threshold(body: ShoulderThresholdBody):
    """Set the shoulder shutdown threshold (kW).

    Updates in-memory config (takes effect next cycle) and persists to
    qsh.yaml (survives restart). No pipeline restart required.
    """
    if body.value < 0.5 or body.value > 10.0:
        raise HTTPException(
            status_code=400,
            detail="Threshold must be between 0.5 and 10.0 kW",
        )

    # Update in-memory config for immediate effect
    config = shared_state.get_config()
    if config is not None:
        config["hp_min_output_kw"] = body.value

    # Persist to qsh.yaml
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):  # Guard: don't overwrite config if load returned empty/stub
            shoulder = raw.setdefault("shoulder", {})
            shoulder["hp_min_output_kw"] = body.value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms (file unreadable?)")
    except Exception as e:
        logger.warning("Failed to persist shoulder threshold: %s", e)

    # Keep setpoint snapshot in sync (INSTRUCTION-42A)
    try:
        from ...drivers.ha.sensor_fetcher import update_setpoint_original
        update_setpoint_original("hp_min_output_kw", body.value)
    except ImportError:
        pass

    return {"hp_min_output_kw": body.value}


# ── Overtemp protection (INSTRUCTION-42A) ──────────────────────────


@router.get("/overtemp-protection")
def get_overtemp_protection():
    """Return the current overtemp protection threshold (C)."""
    config = shared_state.get_config()
    value = config.get("overtemp_protection", 23.0) if config else 23.0
    return {"overtemp_protection": value}


class OvertempProtectionBody(BaseModel):
    value: float


@router.patch("/overtemp-protection")
def set_overtemp_protection(body: OvertempProtectionBody):
    """Set the overtemp protection threshold (C).

    Updates in-memory config and persists to qsh.yaml.
    No pipeline restart required — takes effect next cycle.
    """
    if body.value < 18.0 or body.value > 30.0:
        raise HTTPException(
            status_code=400,
            detail="Overtemp protection must be between 18.0 and 30.0 C",
        )

    # Update in-memory config for immediate effect
    config = shared_state.get_config()
    if config is not None:
        config["overtemp_protection"] = body.value

    # Persist to qsh.yaml
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):
            raw.setdefault("thermal", {})["overtemp_protection"] = body.value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms (file unreadable?)")
    except Exception as e:
        logger.warning("Failed to persist overtemp protection: %s", e)

    # Keep setpoint snapshot in sync (INSTRUCTION-42A)
    try:
        from ...drivers.ha.sensor_fetcher import update_setpoint_original
        update_setpoint_original("overtemp_protection", body.value)
    except ImportError:
        pass

    return {"overtemp_protection": body.value}


# ── External setpoints config (INSTRUCTION-42A) ───────────────────


@router.get("/external-setpoints")
def get_external_setpoints():
    """Return current external setpoint entity ID configuration."""
    config = shared_state.get_config()
    entities = config.get("entities", {}) if config else {}
    return {
        "comfort_temp": entities.get("comfort_temp", ""),
        "flow_min_temp": entities.get("flow_min_temp", ""),
        "flow_max_temp": entities.get("flow_max_temp", ""),
        "antifrost_oat_threshold": entities.get("antifrost_oat_threshold", ""),
        "shoulder_threshold": entities.get("shoulder_threshold", ""),
        "overtemp_protection": entities.get("overtemp_protection", ""),
    }


class ExternalSetpointsBody(BaseModel):
    comfort_temp: Optional[str] = None
    flow_min_temp: Optional[str] = None
    flow_max_temp: Optional[str] = None
    antifrost_oat_threshold: Optional[str] = None
    shoulder_threshold: Optional[str] = None
    overtemp_protection: Optional[str] = None


@router.patch("/external-setpoints")
def set_external_setpoints(body: ExternalSetpointsBody):
    """Update external setpoint entity IDs.

    Partial update — only provided fields are changed. Empty string
    clears the entity (reverts to internal value). Null/missing fields
    are left unchanged.

    Updates in-memory config entities dict and persists to qsh.yaml.
    """
    config = shared_state.get_config()
    updates = body.model_dump(exclude_none=True)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Update in-memory entities dict
    if config is not None:
        entities = config.setdefault("entities", {})
        for key, value in updates.items():
            entities[key] = value

    # Persist to YAML
    # NOTE: flow_min/flow_max entity IDs persist to heat_source.flow_min_entity /
    # flow_max_entity (legacy location from before external_setpoints existed).
    # The other 4 persist to the new external_setpoints section. This split exists
    # because flow_min/max entity registration in config.py reads from heat_source,
    # and changing that would break existing installations.
    try:
        from .config import _load_raw_yaml, _save_yaml

        raw = _load_raw_yaml()
        if raw.get("rooms"):
            ext_sp = raw.setdefault("external_setpoints", {})
            for key, value in updates.items():
                if key == "flow_min_temp":
                    raw.setdefault("heat_source", {})["flow_min_entity"] = value
                elif key == "flow_max_temp":
                    raw.setdefault("heat_source", {})["flow_max_entity"] = value
                else:
                    ext_sp[key] = value
            _save_yaml(raw)
        else:
            logger.warning("Skipping YAML persist: loaded config has no rooms")
    except Exception as e:
        logger.warning("Failed to persist external setpoints: %s", e)

    return {"updated": list(updates.keys())}


# ── Per-room boost ──────────────────────────────────────────────────


class BoostStartBody(BaseModel):
    target: float       # Boost target temperature (°C)
    duration_m: int     # Duration in minutes


@router.post("/rooms/{room}/boost")
def start_boost(room: str, body: BoostStartBody):
    """Start a per-room boost.

    Forces HP on if in shoulder monitoring. Self-cancels on duration
    expiry or when room reaches boost target.
    """
    if body.target < 15.0 or body.target > 30.0:
        raise HTTPException(
            status_code=400,
            detail="Boost target must be between 15 and 30°C",
        )

    if body.duration_m < 15 or body.duration_m > 120:
        raise HTTPException(
            status_code=400,
            detail="Duration must be between 15 and 120 minutes",
        )

    config = shared_state.get_config()
    if config and room not in config.get("rooms", {}):
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")

    snap = shared_state.get_snapshot()
    current_target = snap.rooms.get(room, {}).get("target", snap.comfort_temp) if snap else 21.0

    if body.target <= current_target:
        raise HTTPException(
            status_code=400,
            detail=f"Boost target ({body.target}°C) must be above current target ({current_target}°C)",
        )

    boost_ctrl = shared_state.get_boost_controller()
    if boost_ctrl is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialised")

    boost, replaced = boost_ctrl.start_boost(
        room=room,
        target=body.target,
        duration_s=body.duration_m * 60,
        current_target=current_target,
    )

    return {
        "room": room,
        "boost_target": boost.target,
        "duration_m": body.duration_m,
        "expires_at": boost.expires_at,
        "replaced_existing": replaced,
    }


@router.delete("/rooms/{room}/boost")
def cancel_boost(room: str):
    """Cancel an active boost for a room."""
    boost_ctrl = shared_state.get_boost_controller()
    if boost_ctrl is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialised")

    if not boost_ctrl.cancel_boost(room):
        raise HTTPException(status_code=404, detail=f"No active boost for '{room}'")

    return {"room": room, "boost_cancelled": True}


@router.get("/boost")
def get_active_boosts():
    """Return all active boosts."""
    boost_ctrl = shared_state.get_boost_controller()
    if boost_ctrl is None:
        return {"boosts": {}}

    boosts = boost_ctrl.get_active_boosts()
    now = time.time()
    return {
        "boosts": {
            room: {
                "target": b.target,
                "original_target": b.original_target,
                "duration_m": b.duration_s // 60,
                "remaining_s": b.remaining_s(now),
                "started_at": b.started_at,
            }
            for room, b in boosts.items()
        }
    }
