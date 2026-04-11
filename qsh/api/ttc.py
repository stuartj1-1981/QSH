"""Per-room Newton's law of heating time-to-comfort solver.

Replaces the crude energy-bucket TTC with an analytical first-order
thermal model per room:

    C * dT/dt = Q_in - U * (T_room - T_outdoor)

Each deficit room is solved independently.  System TTC = max across rooms.
"""

import logging
import math
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)


def calculate_per_room_ttc(
    room_temps: Dict[str, float],
    room_targets: Dict[str, float],
    room_areas: Dict[str, float],
    outdoor_temp: float,
    hp_thermal_kw: float,
    valve_positions: Dict[str, float],
    learned_u: Dict[str, float],
    learned_c: Dict[str, float],
    room_losses: Dict[str, float],
    config: Dict,
    thermal_mass_per_m2: float,
    deadband: float = 0.5,
    # Multi-zone equilibrium parameters (INSTRUCTION-70)
    actual_loss: float = 0.0,
    room_demands: Optional[Dict[str, float]] = None,
    total_active_demand: float = 0.0,
    aggregate_heat_up: float = 0.0,
) -> Tuple[float, Dict[str, float]]:
    """Calculate per-room time-to-comfort using Newton's law of heating.

    Returns:
        (system_ttc, per_room_dict) where:
        - system_ttc: max across deficit rooms; -1.0 if any room cannot recover
        - per_room_dict: {room: ttc} with 0.0 (at comfort), positive (hours),
          or -1.0 (cannot recover)
    """
    # --- Regime detection ---
    hp_running = hp_thermal_kw > 0.1
    equilibrium_regime = (
        hp_running
        and actual_loss > 0.1          # Startup/dropout guard (F3)
        and aggregate_heat_up < 3.0    # Small total deficit across all rooms
        and hp_thermal_kw >= actual_loss * 0.7  # HP covering ≥70% of fabric loss
    )
    net_surplus_kw = hp_thermal_kw - actual_loss

    logger.debug(
        "TTC regime: %s (agg_heat_up=%.1f, hp=%.2f, loss=%.2f, net=%.2f)",
        "equilibrium" if equilibrium_regime else "recovery",
        aggregate_heat_up, hp_thermal_kw, actual_loss, net_surplus_kw,
    )

    # Pre-compute per-room deficits for equilibrium marginal path
    per_room_deficits: Dict[str, float] = {}
    for room in room_temps:
        temp = room_temps.get(room)
        target = room_targets.get(room)
        if temp is not None and target is not None:
            per_room_deficits[room] = max(0.0, target - temp - deadband)

    # Pre-compute valve share denominator (fallback for recovery)
    total_valve_frac = sum(
        v / 100.0 for v in valve_positions.values() if v > 0
    )

    # Design-condition U fallback parameters
    peak_loss = config.get("peak_loss", 5.0)
    peak_ext = config.get("peak_ext", -3.0)
    design_internal = config.get("overtemp_protection", 23.0)
    design_delta = design_internal - peak_ext

    facings = config.get("facings", {})

    # Pre-compute sum_af for U fallback
    sum_af = sum(
        room_areas.get(r, 0) * facings.get(r, 0.2)
        for r in room_areas
    )

    per_room: Dict[str, float] = {}
    system_ttc = 0.0

    for room, area in room_areas.items():
        temp = room_temps.get(room)
        target = room_targets.get(room)

        if temp is None or target is None:
            continue

        effective_target = target - deadband

        # Room already at comfort
        if temp >= effective_target:
            per_room[room] = 0.0
            continue

        deficit = effective_target - temp  # Always positive here

        # Assign room_demand once — used by both regime branches
        room_demand = room_demands.get(room, 0.0) if room_demands else 0.0

        # --- Equilibrium regime: small deficit → linear estimate ---
        if equilibrium_regime and deficit <= 1.0:
            c_val = learned_c.get(room, area * thermal_mass_per_m2)

            if net_surplus_kw > 0.01 and total_active_demand > 0.01 and room_demand > 0.01:
                # Building has net surplus — distribute by demand weight
                room_surplus = net_surplus_kw * (room_demand / total_active_demand)
                t_hours = (c_val * deficit) / room_surplus
            else:
                # Marginal equilibrium: HP time-shares across deficit rooms
                n_deficit_rooms = max(1, sum(1 for d in per_room_deficits.values() if d > 0))
                room_share = hp_thermal_kw / n_deficit_rooms
                if room_share > 0.01:
                    t_hours = (c_val * deficit) / room_share
                else:
                    per_room[room] = -1.0
                    system_ttc = -1.0
                    continue

            t_hours = min(t_hours, 48.0)
            per_room[room] = round(t_hours, 3)

            logger.debug(
                "TTC: %s=%.3fh [equilibrium] (deficit=%.2f, C=%.3f)",
                room, t_hours, deficit, c_val,
            )

            if system_ttc != -1.0:
                system_ttc = max(system_ttc, t_hours)
            continue

        # --- Recovery regime (or equilibrium outlier with deficit > 1.0) ---

        # --- C: thermal mass (kWh/degC) ---
        c_val = learned_c.get(room, area * thermal_mass_per_m2)

        # --- U: heat loss coefficient (kW/degC) ---
        u_val = learned_u.get(room)
        if u_val is None:
            if design_delta > 0 and sum_af > 0:
                whole_building_u = peak_loss / design_delta
                room_af = area * facings.get(room, 0.2)
                u_val = whole_building_u * (room_af / sum_af)
            else:
                # Last-resort fallback with 5 degC floor
                u_val = room_losses.get(room, 0.05) / max(temp - outdoor_temp, 5.0)
            # Ensure positive
            u_val = max(u_val, 0.001)

        # --- Q_in: demand-weighted with valve-share fallback ---
        if room_demands and total_active_demand > 0.01:
            q_in = hp_thermal_kw * (room_demand / total_active_demand) if room_demand > 0.01 else 0.0
        else:
            # Fallback to valve-share if room_demands unavailable
            valve_pct = valve_positions.get(room, 0)
            if valve_pct > 0 and total_valve_frac > 0 and hp_thermal_kw > 0:
                q_in = hp_thermal_kw * (valve_pct / 100.0) / total_valve_frac
            else:
                q_in = 0.0

        if q_in <= 0 or hp_thermal_kw <= 0:
            per_room[room] = -1.0
            logger.debug(
                "TTC: %s=-1.0 (no heat delivery: q_in=%.2f hp=%.2fkW)",
                room, q_in, hp_thermal_kw,
            )
            system_ttc = -1.0
            continue

        # --- Equilibrium temperature ---
        t_eq = outdoor_temp + q_in / u_val

        # Cannot reach comfort
        if t_eq <= effective_target:
            per_room[room] = -1.0
            logger.debug(
                "TTC: %s=-1.0 (Teq=%.1f <= target=%.1f, C=%.3f U=%.3f Q=%.2f)",
                room, t_eq, effective_target, c_val, u_val, q_in,
            )
            system_ttc = -1.0
            continue

        # --- Analytical solution ---
        numerator = t_eq - temp
        denominator = t_eq - effective_target
        t_hours = (c_val / u_val) * math.log(numerator / denominator)

        # Clamp to reasonable range
        t_hours = min(t_hours, 48.0)

        per_room[room] = round(t_hours, 3)

        logger.debug(
            "TTC: %s=%.1fh (C=%.3f U=%.3f Q=%.2f Teq=%.1f)",
            room, t_hours, c_val, u_val, q_in, t_eq,
        )

        if system_ttc != -1.0:
            system_ttc = max(system_ttc, t_hours)

    return (system_ttc, per_room)
