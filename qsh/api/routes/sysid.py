"""System identification learned parameters endpoint."""

from fastapi import APIRouter, HTTPException

from ..state import shared_state
# Absolute import — avoids module-name shadowing between qsh.api.routes.sysid
# and qsh.sysid (V2 LOW-3).
from qsh.sysid import SOLAR_CAPACITY_MIN_OBS

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
        return {
            "room": room,
            "u_kw_per_c": round(sysid.effective_u(room), 4),
            "c_kwh_per_c": round(sysid.effective_c(room), 4),
            "u_observations": sysid.room_observations(room, 'u'),
            "c_observations": sysid.room_observations(room, 'c'),
            "c_source": sysid.c_source(room),
            "pc_fits": sysid.pc_fits(room),
            "solar_gain": round(sysid.solar_gain(room), 3),
            "gate_stats": sysid.gate_stats(room),
            "confidence": _confidence_level(sysid, room),
            # INSTRUCTION-172 — see /sysid endpoint above.
            "fixed_setpoint": fixed_setpoints.get(room),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _confidence_level(sysid, room: str) -> str:
    """Derive a human-readable confidence level from observation counts."""
    u_obs = sysid.room_observations(room, 'u')
    pc = sysid.pc_fits(room)
    if u_obs >= 100 and pc >= 5:
        return "high"
    elif u_obs >= 30 or pc >= 2:
        return "medium"
    else:
        return "low"
