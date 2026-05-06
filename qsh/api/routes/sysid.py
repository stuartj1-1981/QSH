"""System identification learned parameters endpoint."""

from fastapi import APIRouter, HTTPException

from ..state import shared_state

router = APIRouter()


@router.get("/sysid")
def get_sysid():
    """Per-room learned thermal parameters and observation counts."""
    sysid = shared_state.get_sysid()
    if sysid is None:
        return {"error": "SysID not yet initialised", "rooms": {}}

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

    return {"rooms": result}


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
