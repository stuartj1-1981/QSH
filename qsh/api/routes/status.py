"""System status and per-room state endpoints."""

from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from ..state import (
    build_heat_source_payload,
    build_hp_shim,
    shared_state,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schema (INSTRUCTION-117E Task 1c) — flat HeatSourceState with a
# closed Literal `type` discriminator. No discriminated-union wrapper: native
# Literal-enum validation rejects bad `type` and bad `performance.source`
# strings without any `Annotated[Union[...], Field(discriminator=...)]`
# plumbing. Per parent 117 V5 representation simplification.
# ---------------------------------------------------------------------------


class _Performance(BaseModel):
    value: float
    source: Literal["live", "config"]


class HeatSourceState(BaseModel):
    type: Literal["heat_pump", "gas_boiler", "lpg_boiler", "oil_boiler"]
    input_power_kw: float
    thermal_output_kw: Optional[float]
    thermal_output_source: Literal["measured", "computed", "unknown"]
    performance: _Performance
    flow_temp: float
    return_temp: float
    delta_t: float
    flow_rate: float


class HpState(BaseModel):
    power_kw: float
    cop: float
    flow_temp: float
    return_temp: float
    delta_t: float
    flow_rate: float


@router.get("/status")
def get_status():
    """Current cycle summary — the main home screen data source."""
    snap = shared_state.get_snapshot()
    rooms_below = sum(
        1 for r in snap.rooms.values()
        if r['temp'] is not None and r['target'] is not None
        and r['temp'] < r['target'] - 0.3
    )
    return {
        "timestamp": snap.timestamp,
        "cycle_number": snap.cycle_number,
        "operating_state": snap.operating_state,
        "control_enabled": snap.control_enabled,
        "setup_mode": shared_state.is_setup_mode(),
        "migration_pending": shared_state.get_migration_pending(),
        "driver": shared_state.get_driver_status(),
        "comfort_temp": snap.comfort_temp,
        "comfort_schedule_active": snap.comfort_schedule_active,
        "comfort_temp_active": snap.comfort_temp_active,
        "optimal_flow": round(snap.optimal_flow, 1),
        "applied_flow": round(snap.applied_flow, 1),
        "optimal_mode": snap.optimal_mode,
        "applied_mode": snap.applied_mode,
        "total_demand": round(snap.total_demand, 2),
        "outdoor_temp": round(snap.outdoor_temp, 1),
        "recovery_time_hours": snap.recovery_time_hours,
        "capacity_pct": snap.capacity_pct,
        "hp_capacity_kw": snap.hp_capacity_kw,
        "min_load_pct": snap.min_load_pct,
        "heat_source": build_heat_source_payload(snap),
        "hp": build_hp_shim(snap),
        "rooms_total": len(snap.rooms),
        "rooms_below_target": rooms_below,
        "comfort_pct": round(
            (1 - rooms_below / max(len(snap.rooms), 1)) * 100, 0
        ),
        "energy": {
            "current_rate": snap.current_rate,
            "export_rate": snap.export_rate,
            "cost_today_pence": round(snap.cost_today_pence, 1),
            "energy_today_kwh": round(snap.energy_today_kwh, 2),
            "predicted_saving": round(snap.predicted_saving, 1),
        },
        "away": {
            "active": snap.away_mode_active,
            "days": snap.away_days,
        },
        "engineering": {
            "det_flow": round(snap.det_flow, 1),
            "rl_flow": round(snap.rl_flow, 1) if snap.rl_flow else None,
            "rl_blend": round(snap.rl_blend, 3),
            "rl_reward": round(snap.rl_reward, 2),
            "rl_loss": round(snap.rl_loss, 4),
            "shoulder_monitoring": snap.shoulder_monitoring,
            "summer_monitoring": snap.summer_monitoring,
            "cascade_active": snap.cascade_active,
            "frost_cap_active": snap.frost_cap_active,
            "signal_quality": snap.signal_quality,
        },
        "source_selection": snap.source_selection,
    }


@router.get("/status/rooms")
def get_rooms_status():
    """Per-room current state for the Rooms screen."""
    snap = shared_state.get_snapshot()
    return {
        "timestamp": snap.timestamp,
        "rooms": snap.rooms,
    }
