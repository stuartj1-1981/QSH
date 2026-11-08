"""System identification learned parameters endpoint."""

import math
from typing import Iterable, Optional

from fastapi import APIRouter, HTTPException

from ..state import shared_state
# Absolute import — avoids module-name shadowing between qsh.api.routes.sysid
# and qsh.sysid (V2 LOW-3).
# INSTRUCTION-416 — the badge bands import their constants from the source
# (no literals; the 214 mirror protocol's source side).
from qsh.sysid import SOLAR_CAPACITY_MIN_OBS, MIN_OBS_FOR_USE, CONFIDENCE_FULL_AT, U_PRIOR_CAP_MULT

router = APIRouter()


# INSTRUCTION-614 — the whole-house heat loss coefficient. The learned value
# is the sum of the effective U of the rooms: the U that the room losses and
# the forecast load values use. The design value is the configured peak_loss
# over (comfort_temp - peak_ext), read from the config now: the stored
# U priors are restored from the state file and do not follow a change of
# peak_loss (614-L1). Read only; no control path reads it.
def _finite(value) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _room_u_prior(sysid, room: str) -> Optional[float]:
    """The U prior of the room, or None when sysid holds no valid prior."""
    rooms = getattr(sysid, "rooms", None)
    if not isinstance(rooms, dict):
        return None
    prior = _finite(getattr(rooms.get(room), "u_prior", None))
    return prior if prior is not None and prior > 0.0 else None


def _ratio(value: Optional[float], prior: Optional[float]) -> Optional[float]:
    if value is None or prior is None or prior <= 0.0:
        return None
    return round(value / prior, 2)


def _positive(config: dict, key: str) -> Optional[float]:
    value = _finite(config.get(key)) if config else None
    return value if value is not None and value > 0.0 else None


def _installation_heat_loss(sysid, config: dict, room_names: Iterable[str]) -> dict:
    """The house values, over the configured rooms.

    The learned U is None when there is no room, or when any room gives no
    finite effective U: a partial sum is not a house value. The design U is
    None when peak_loss is not above 0 or the design temperature difference
    is not above 0. The ratio and the loss at design are None unless every
    room has a learned U, the rule of the forecast load U: a room at its prior
    pulls the ratio toward 1 (614-M1). The counts are over the rooms whose U
    and observations can be read.
    """
    names = list(room_names)
    u_sum = 0.0
    learned = 0
    above_cap = 0
    complete = bool(names)
    for room in names:
        try:
            u = _finite(sysid.effective_u(room))
            u_obs = sysid.room_observations(room, "u")
        except Exception:
            complete = False
            continue
        if isinstance(u_obs, int) and not isinstance(u_obs, bool) and u_obs >= MIN_OBS_FOR_USE:
            learned += 1
        if u is None:
            complete = False
            continue
        u_sum += u
        # The ratio as the room shows it, to 2 decimals.
        room_ratio = _ratio(u, _room_u_prior(sysid, room))
        if room_ratio is not None and room_ratio > U_PRIOR_CAP_MULT:
            above_cap += 1
    design_loss = _positive(config, "peak_loss")
    design_indoor = _finite(config.get("comfort_temp")) if config else None
    peak_ext = _finite(config.get("peak_ext")) if config else None
    design_delta = design_indoor - peak_ext if design_indoor is not None and peak_ext is not None else None
    if design_delta is not None and design_delta <= 0.0:
        design_delta = None
    u_learned = round(u_sum, 4) if complete else None
    u_design = (
        round(design_loss / design_delta, 4)
        if design_loss is not None and design_delta is not None else None
    )
    if u_learned is not None and u_design is not None and learned == len(names):
        ratio = round(u_sum * design_delta / design_loss, 2)
        loss_at_design = round(u_sum * design_delta, 1)
    else:
        ratio = loss_at_design = None
    return {
        "u_learned_kw_per_c": u_learned,
        "u_design_kw_per_c": u_design,
        "ratio": ratio,
        "design_loss_kw": design_loss,
        "design_delta_c": round(design_delta, 1) if design_delta is not None else None,
        "learned_loss_at_design_kw": loss_at_design,
        "rooms_total": len(names),
        "rooms_learned": learned,
        "rooms_above_cap": above_cap,
        "cap_mult": U_PRIOR_CAP_MULT,
    }


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
            "installation_heat_loss": None,
        }

    config = shared_state.get_config()
    room_areas = config.get('rooms', {}) if config else {}
    fixed_setpoints = config.get('room_fixed_setpoint', {}) if config else {}

    result = {}
    for room_name in room_areas:
        try:
            u_prior = _room_u_prior(sysid, room_name)
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
                # INSTRUCTION-614 — the design U of the room and the ratio of
                # the effective U to it. None when sysid holds no valid prior.
                "u_prior_kw_per_c": round(u_prior, 4) if u_prior is not None else None,
                "u_vs_design": _ratio(_finite(sysid.effective_u(room_name)), u_prior),
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
        "installation_heat_loss": _installation_heat_loss(sysid, config, room_areas),
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
        # INSTRUCTION-415 — merge the per-room U ledger into gate_stats
        # under distinct `room_`-prefixed names (the unprefixed u_qualified
        # key remains the process-scope counter; the per-room block is
        # authoritative for this room). INSTRUCTION-573B — the ledger is the
        # INSTRUCTION-419 event ledger.
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
            # INSTRUCTION-592 — the floor-lock window.
            "floor_window": {k: room_state.get(k) for k in _FLOOR_WINDOW_KEYS},
            # INSTRUCTION-600 — the last rejected floor/cap read (volatile).
            "u_event_last_rejected_value": room_state.get("u_event_last_rejected_value"),
            "u_event_last_rejected_rate": room_state.get("u_event_last_rejected_rate"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# INSTRUCTION-573B — the per-room U ledger is the INSTRUCTION-419 event
# ledger emitted by SystemIdentifier.get_room_state (the 415 per-cycle ledger
# is deleted with the per-cycle U read). The taxonomy is total: each event (a
# transition in the anchored direction, in U context) increments
# u_event_candidates and exactly one of the six classes after it. After the
# INSTRUCTION-592 split of the outlier class the count is qualified plus six
# rejection classes (window, sign, rate, no_c, floor, cap): seven keys in all.
_U_LEDGER_KEYS = (
    "u_event_candidates",
    "u_event_qualified",
    "u_event_rejected_window",
    "u_event_rejected_sign",
    "u_event_rejected_rate",
    "u_event_rejected_no_c",
    "u_event_rejected_floor",
    "u_event_rejected_cap",
)

# INSTRUCTION-592 — the floor-lock window, returned under its own additive key
# (not in _U_LEDGER_KEYS, which coerces every key to int).
_FLOOR_WINDOW_KEYS = (
    "u_floor_locked",
    "u_floor_window_start_ts",
    "u_floor_window_last_restart_ts",
    "u_floor_window_regime",
    "u_floor_window_candidates",
    "u_floor_window_band",
    "u_floor_window_floor_rejects",
    "u_floor_window_cap_rejects",
    "u_floor_window_qualified",
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
