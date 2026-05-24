"""System status and per-room state endpoints."""

from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from qsh.config import HOUSE_CONFIG

from ..state import (
    build_heat_source_payload,
    build_hp_shim,
    serialise_tariff_providers_status,
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
    # INSTRUCTION-246 Task 10 — provenance discriminator for input_power_kw.
    # REQUIRED (not Optional) on the backend so a resolver bug emitting a
    # value outside this Literal set fails at FastAPI serialisation rather
    # than silently dropping the field. Frontend TS type at
    # frontend/src/types/api.ts:46 declares this Optional for old-server
    # forward-compat — backend strict + frontend forgiving is intentional
    # and matches the existing _Performance shape asymmetry.
    input_power_source: Literal["live", "legacy", "nameplate", "unknown"]
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

    # INSTRUCTION-193 Task 4: surface revocation flag for the UI banner.
    # Read live off the TelemetryService when wired in (post-startup);
    # falls back to the snapshot field (default False) when the service is
    # absent (test fixtures bypassing main.py, or telemetry opted out).
    telemetry = shared_state.get_telemetry()
    if telemetry is not None and hasattr(telemetry, "is_revoked"):
        try:
            telemetry_revoked = bool(telemetry.is_revoked())
        except Exception:
            telemetry_revoked = bool(snap.telemetry_revoked)
    else:
        telemetry_revoked = bool(snap.telemetry_revoked)

    # INSTRUCTION-255: surface last permanent telemetry failure for diagnostics.
    # Same wiring shape as telemetry_revoked above — reuse the resolved
    # telemetry reference. Best-effort: getter exceptions degrade to None
    # rather than 500ing the whole route.
    telemetry_last_failure: Optional[dict] = None
    if telemetry is not None and hasattr(telemetry, "get_last_permanent_failure"):
        try:
            telemetry_last_failure = telemetry.get_last_permanent_failure()
        except Exception:
            telemetry_last_failure = None
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
        "comfort_temp_effective": snap.comfort_temp_effective,
        "rooms_overridden_count": snap.rooms_overridden_count,
        "target_temp_fallback_active": snap.target_temp_fallback_active,
        "comfort_temp_writeback_unverified": snap.comfort_temp_writeback_unverified,
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
            # INSTRUCTION-191B: mode-resolved SCOP today-rolling.
            "daily_cop_combined": (
                round(snap.daily_cop_combined, 2)
                if snap.daily_cop_combined is not None else None
            ),
            "daily_cop_ch": (
                round(snap.daily_cop_ch, 2)
                if snap.daily_cop_ch is not None else None
            ),
            "daily_cop_hw": (
                round(snap.daily_cop_hw, 2)
                if snap.daily_cop_hw is not None else None
            ),
            "energy_today_kwh_ch": round(snap.energy_today_kwh_ch, 2),
            "energy_today_kwh_hw": round(snap.energy_today_kwh_hw, 2),
            "thermal_kwh_today_ch": round(snap.thermal_kwh_today_ch, 2),
            "thermal_kwh_today_hw": round(snap.thermal_kwh_today_hw, 2),
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
        # INSTRUCTION-150C V5 E-M1: per-fuel tariff provider state and the
        # backend-supported provider-kinds list (frontend gates radios on this).
        "tariff_providers_status": serialise_tariff_providers_status(
            snap.tariff_providers_status
        ),
        "available_provider_kinds": list(snap.available_provider_kinds),
        # INSTRUCTION-186 — read-only diagnostic surface for active control
        # routing path. Defensive default covers the early-startup window
        # where HOUSE_CONFIG["control_method"] may still be "pending"
        # (config.py:1686) before Octopus API init resolves it.
        "control_method": HOUSE_CONFIG.get("control_method", "unknown"),
        # INSTRUCTION-193 Task 4: telemetry revocation flag.
        "telemetry_revoked": telemetry_revoked,
        # INSTRUCTION-255: last permanent telemetry-push failure diagnostic.
        "telemetry_last_permanent_failure": telemetry_last_failure,
    }


@router.get("/status/rooms")
def get_rooms_status():
    """Per-room current state for the Rooms screen."""
    snap = shared_state.get_snapshot()
    return {
        "timestamp": snap.timestamp,
        "rooms": snap.rooms,
    }
