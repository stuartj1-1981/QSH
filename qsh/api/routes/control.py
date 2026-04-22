"""Control settings API — comfort temperature, shadow/live mode, shoulder threshold, boost.

Read endpoints use SharedState (driver-agnostic).
All write endpoints are config-based and work on all drivers.
"""

import os
import logging
import time
from typing import Callable, Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..state import shared_state
from .config import _read_modify_write
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


def _update_config_key(key_path: str, value) -> Callable[[dict], dict]:
    """Build a transform that sets a single config key.

    key_path supports dot notation for nested keys:
    - "comfort_temp" -> raw["comfort_temp"] = value
    - "antifrost.oat_threshold" -> raw["antifrost"]["oat_threshold"] = value

    Raises HTTPException(503) on template/empty configs — callers MUST
    NOT succeed silently when the write cannot land. See INSTRUCTION-125
    review finding M1.
    """
    def transform(raw: dict) -> dict:
        if not raw.get("rooms"):
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Cannot persist {key_path}: config is template/empty. "
                    "Complete initial setup before writing."
                ),
            )
        parts = key_path.split(".")
        target = raw
        for part in parts[:-1]:
            target = target.setdefault(part, {})
        target[parts[-1]] = value
        return raw
    return transform


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
        _read_modify_write(_update_config_key("antifrost.oat_threshold", body.value))
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
        _read_modify_write(_update_config_key("comfort_temp", body.value))
    except Exception as e:
        logger.warning("Failed to persist comfort_temp: %s", e)

    # Keep pid_target_internal in sync for MQTT driver fallback (INSTRUCTION-105).
    # The MQTT driver's _resolve_mqtt_control() reads control/comfort_temp from
    # the broker cache and falls back to config["pid_target_internal"].  Without
    # this, a restart before the broker re-populates the retained topic reverts
    # comfort to the default (20.0).
    if config is not None:
        config["pid_target_internal"] = body.value
    try:
        _read_modify_write(_update_config_key("pid_target_internal", body.value))
    except Exception as e:
        logger.warning("Failed to persist pid_target_internal: %s", e)

    # Write the retained MQTT topic the driver actually reads.  Note the key
    # must be "comfort_temp" — the topic suffix the MQTT driver subscribes to
    # (control/comfort_temp).  Publishing to control/pid_target achieves
    # nothing because the driver does not read that topic.
    _mqtt_writeback("comfort_temp", str(body.value))

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

    Sync behaviour:
      - HA driver with dfan entity configured: writes
        `entities.dfan_control_toggle` (typically input_boolean.dfan_control)
        so the HA helper stays in lock-step with the yaml intent. If the
        service call fails, the yaml write is kept and the sync is queued
        in pending_ha_syncs; the ShadowController retries on the next cycle.
      - HA driver without dfan entity configured: no external write. The
        pipeline's read_inputs() uses resolve_value() with internal key
        `control_enabled` (INSTRUCTION-125), which this endpoint also
        writes. The next cycle picks up the new internal value.
      - MQTT driver (control_method == "mqtt"): publishes the new value
        on {prefix}/control/dfan_control with retain=True.

    The yaml write is the source of truth regardless of driver. A failed
    HA or MQTT sync never rolls back the yaml write; the pipeline
    reconciles on the next cycle via the resolver.

    Config prerequisites:
      - Any driver that expects MQTT retained publishes to propagate the
        toggle to external consumers MUST set `control_method: mqtt` in
        qsh.yaml. Without it, `set_control_mode` writes yaml and
        in-memory config only. The drivers' internal fallback reads
        `control_enabled` directly (INSTRUCTION-125) and picks up the
        change on the next cycle. Any external MQTT publisher on the
        {prefix}/control/dfan_control topic still wins via cache-first
        resolution — intentional "external wins" semantics.
    """
    # 1. Update in-memory config (live effect, no restart)
    config = shared_state.get_config()
    if config is not None:
        config["control_enabled"] = body.enabled

    # 2. Persist to YAML (survives restart)
    try:
        _read_modify_write(_update_config_key("control_enabled", body.enabled))
    except HTTPException:
        raise  # Task 6: safety-critical — caller must see 503
    except Exception as e:
        logger.warning("Failed to persist control_enabled: %s", e)

    # 3. Sync to HA helper entity (HA driver only; skip MQTT-only installs).
    # yaml is the source of truth — do NOT roll back the yaml write on HA
    # service failure.  The failure is recorded in pending_ha_syncs and the
    # ShadowController retries every cycle until it succeeds (see
    # qsh/pipeline/controllers/shadow_controller.py:61-83).
    driver = config.get("driver", "ha") if config is not None else "ha"
    if driver == "ha":
        from ...drivers.resolve import deep_get
        dfan_entity = deep_get(config or {}, "entities.dfan_control_toggle")
        if dfan_entity:
            try:
                _set_entity(dfan_entity, body.enabled)
            except HTTPException as e:
                # _set_entity raises HTTPException for HA service failures.
                # Treat as transient — record for retry.
                from ...drivers.ha.sync_queue import pending_ha_syncs
                pending_ha_syncs["dfan_control"] = body.enabled
                logger.warning(
                    "dfan_control HA sync failed (%s); queued for retry next cycle",
                    e.detail,
                )
            except Exception:
                # Defensive — unexpected error path. Use logger.exception so
                # the stack trace is captured; the HTTPException branch above
                # uses logger.warning because its `detail` is already a clean
                # summary and the exception type is expected.
                from ...drivers.ha.sync_queue import pending_ha_syncs
                pending_ha_syncs["dfan_control"] = body.enabled
                logger.exception(
                    "dfan_control HA sync failed (unexpected); queued for retry next cycle"
                )

    # 4. Sync to MQTT (when running via HA with MQTT flow control method)
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
        _read_modify_write(_update_config_key("flow_min_internal", body.value))
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
        _read_modify_write(_update_config_key("flow_max_internal", body.value))
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
        _read_modify_write(_update_config_key("pid_target_internal", body.value))
    except Exception as e:
        logger.warning("Failed to persist pid_target_internal: %s", e)

    _mqtt_writeback("pid_target", str(body.value))

    return {"pid_target_internal": body.value}


class DfanControlBody(BaseModel):
    enabled: bool


@router.patch("/dfan-control")
def set_dfan_control_internal(body: DfanControlBody):
    """Set the shadow/live toggle via PATCH.

    Functionally identical to POST /api/control/mode — retained as a
    separate endpoint for clients that prefer the PATCH pattern and for
    the MQTT write-back side-effect below. Returns
    {"control_enabled": bool}.
    """
    config = shared_state.get_config()
    if config is not None:
        config["control_enabled"] = body.enabled

    try:
        _read_modify_write(_update_config_key("control_enabled", body.enabled))
    except HTTPException:
        raise  # Task 6: safety-critical — caller must see 503
    except Exception as e:
        logger.warning("Failed to persist control_enabled: %s", e)

    _mqtt_writeback("dfan_control", str(body.enabled).lower())

    return {"control_enabled": body.enabled}


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
        _read_modify_write(_update_config_key("shoulder.hp_min_output_kw", body.value))
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
        _read_modify_write(_update_config_key("thermal.overtemp_protection", body.value))
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
        def _apply_external_setpoints(raw: dict) -> dict:
            if not raw.get("rooms"):
                return raw
            ext_sp = raw.setdefault("external_setpoints", {})
            for key, value in updates.items():
                if key == "flow_min_temp":
                    raw.setdefault("heat_source", {})["flow_min_entity"] = value
                elif key == "flow_max_temp":
                    raw.setdefault("heat_source", {})["flow_max_entity"] = value
                else:
                    ext_sp[key] = value
            return raw
        _read_modify_write(_apply_external_setpoints)
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
