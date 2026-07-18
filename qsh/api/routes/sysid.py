"""System identification learned parameters endpoint."""

from fastapi import APIRouter, HTTPException

from ..state import shared_state
# Absolute import — avoids module-name shadowing between qsh.api.routes.sysid
# and qsh.sysid (V2 LOW-3).
# INSTRUCTION-416 — the badge bands import their constants from the source
# (no literals; the 214 mirror protocol's source side).
from qsh.sysid import SOLAR_CAPACITY_MIN_OBS, MIN_OBS_FOR_USE, CONFIDENCE_FULL_AT

router = APIRouter()


@router.get("/sysid")
def get_sysid():
    """Per-room learned thermal parameters and observation counts."""
    sysid = shared_state.get_sysid()
    if sysid is None:
        # INSTRUCTION-227B Task 7 — State 1: whole envelope key is None when
        # sysid is not initialised. Frontend (227C) treats this as "no data
        # yet" — different from State 2 (sysid present, zero observations).
        return {
            "error": "SysID not yet initialised",
            "rooms": {},
            "installation_solar_capacity_kw": None,
        }

    config = shared_state.get_config()
    room_areas = config.get('rooms', {}) if config else {}
    fixed_setpoints = config.get('room_fixed_setpoint', {}) if config else {}

    result = {}
    for room_name in room_areas:
        try:
            result[room_name] = {
                "u_kw_per_c": round(sysid.effective_u(room_name), 4),
                "c_kwh_per_c": round(sysid.effective_c(room_name), 4),
                "u_observations": sysid.room_observations(room_name, 'u'),
                "c_observations": sysid.room_observations(room_name, 'c'),
                "c_source": sysid.c_source(room_name),
                "pc_fits": sysid.pc_fits(room_name),
                "solar_gain": round(sysid.solar_gain(room_name), 3),
                "confidence": _confidence_level(sysid, room_name),
                # INSTRUCTION-172 — surface the per-room fixed setpoint so the
                # UI can annotate "(fixed)" on the room target line.
                "fixed_setpoint": fixed_setpoints.get(room_name),
                # INSTRUCTION-420 — sensor-cadence classification struct for
                # the Engineering column and wizard advisory (advisory only;
                # never consulted by any deploy or control path).
                "sensor_cadence": sysid.sensor_cadence(room_name),
            }
        except Exception:
            result[room_name] = {"error": "Failed to read SysID for this room"}

    # INSTRUCTION-227B Task 7 — installation solar capacity envelope.
    # States 2/3/4 from the four-state contract:
    # - obs == 0 → value None, mature False (State 2)
    # - 0 < obs < SOLAR_CAPACITY_MIN_OBS → value=observed max, mature False (State 3)
    # - obs >= SOLAR_CAPACITY_MIN_OBS → value=observed max, mature True (State 4)
    obs = int(getattr(sysid, "solar_capacity_observations", 0) or 0)
    capacity = {
        "value": float(sysid.solar_capacity_kw_observed) if obs > 0 else None,
        "observations": obs,
        "mature": obs >= SOLAR_CAPACITY_MIN_OBS,
        "last_updated_ts": getattr(
            sysid, "solar_capacity_last_updated_ts", None
        ),
    }

    return {
        "rooms": result,
        "installation_solar_capacity_kw": capacity,
    }


@router.get("/sysid/{room}")
def get_sysid_room(room: str):
    """Detailed SysID state for a single room."""
    sysid = shared_state.get_sysid()
    if sysid is None:
        raise HTTPException(status_code=503, detail="SysID not initialised")

    config = shared_state.get_config()
    room_areas = config.get('rooms', {}) if config else {}
    fixed_setpoints = config.get('room_fixed_setpoint', {}) if config else {}

    if room not in room_areas:
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")

    try:
        # INSTRUCTION-415 — merge the per-room U-candidate ledger into
        # gate_stats under distinct `room_`-prefixed names (the unprefixed
        # u_qualified / u_rejected_rate keys remain the process-scope
        # counters; the per-room block is authoritative for this room).
        gate_stats = sysid.gate_stats(room)
        room_state = sysid.get_room_state(room)
        if not isinstance(room_state, dict):
            room_state = {}
        for key in _U_LEDGER_KEYS:
            gate_stats[f"room_{key}"] = int(room_state.get(key, 0) or 0)

        return {
            "room": room,
            "u_kw_per_c": round(sysid.effective_u(room), 4),
            "c_kwh_per_c": round(sysid.effective_c(room), 4),
            "u_observations": sysid.room_observations(room, 'u'),
            "c_observations": sysid.room_observations(room, 'c'),
            "c_source": sysid.c_source(room),
            "pc_fits": sysid.pc_fits(room),
            "solar_gain": round(sysid.solar_gain(room), 3),
            "gate_stats": gate_stats,
            "confidence": _confidence_level(sysid, room),
            # INSTRUCTION-172 — see /sysid endpoint above.
            "fixed_setpoint": fixed_setpoints.get(room),
            # INSTRUCTION-420 — see /sysid endpoint above.
            "sensor_cadence": sysid.sensor_cadence(room),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# INSTRUCTION-415 — the seven per-room U-candidate ledger classes emitted by
# SystemIdentifier.get_room_state. The taxonomy is total: for every room-cycle
# in U context, exactly one class increments.
_U_LEDGER_KEYS = (
    "u_qualified",
    "u_rejected_rate",
    "u_rejected_delta_ext",
    "u_rejected_no_c",
    "u_flat",
    "u_rejected_sign",
    "u_rejected_outlier",
)


@router.post("/sysid/{room}/reset")
def reset_sysid_room(room: str):
    """INSTRUCTION-422 — reset ONE room's learned sysid state to freshly-
    derived config priors. Every other room is untouched; the reset is
    audited (SYSID.room_reset) and persisted immediately. The response
    carries the discarded counts (`was`) and the re-derived priors (`now`)
    for the panel toast and audit trail."""
    sysid = shared_state.get_sysid()
    if sysid is None:
        raise HTTPException(status_code=503, detail="SysID not initialised")

    config = shared_state.get_config()
    room_areas = config.get('rooms', {}) if config else {}
    if room not in room_areas:
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")

    try:
        return sysid.reset_room(room)
    except KeyError:
        # Config lists the room but the estimator does not know it (e.g.
        # config edited since boot) — still a 404, not a 500.
        raise HTTPException(status_code=404, detail=f"Room '{room}' not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _confidence_level(sysid, room: str) -> str:
    """Per-room confidence badge (INSTRUCTION-416) — a count-of-evidence
    indicator over the room's OWN accepted U observations, nothing else:

        low:    fewer than MIN_OBS_FOR_USE (10) — the value in use is the prior
        medium: 10-99 — learned value in use, maturing
        high:   at least CONFIDENCE_FULL_AT (100)

    Passive-cooling fits are deliberately NOT consulted — they are C-side
    evidence, carried by the c_source column (the pre-416 formula's global
    PC arm floored every room at Medium on any box with two fits anywhere).
    323's continuous variance-based confidence deliberately stays a
    separate exported signal: the badge is a step function of evidence
    count so one tooltip sentence can define it truthfully. Integrity rule:
    the badge may consult only per-room evidence counts.
    """
    u_obs = sysid.room_observations(room, 'u')
    if u_obs >= CONFIDENCE_FULL_AT:
        return "high"
    if u_obs >= MIN_OBS_FOR_USE:
        return "medium"
    return "low"
