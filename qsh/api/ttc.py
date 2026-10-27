"""Per-room Newton's law of heating time-to-comfort solver.

Replaces the crude energy-bucket TTC with an analytical first-order
thermal model per room:

    C * dT/dt = Q_in - U * (T_room - T_outdoor)

Each deficit room is solved independently.  System TTC = max across rooms.
"""

import logging
import math
from typing import Dict, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# Thresholds of classify_recovery_state (INSTRUCTION-582).
# HP_RUNNING_KW: measured thermal output above which the solver treats the
# heat pump as running. AT_COMFORT_HOURS: time below which every room is at
# target. NO_DEMAND_PCT: capacity-bar percentage below which the bar reads
# as no demand.
HP_RUNNING_KW = 0.1
AT_COMFORT_HOURS = 0.05
NO_DEMAND_PCT = 1.0


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
    # INSTRUCTION-603A (FI-92) — emitter share, closed valves, per-room cause.
    flow_temp: Optional[float] = None,
    emitter_kw: Optional[Dict[str, float]] = None,
    emitter_exponents: Optional[Dict[str, float]] = None,
    closed_valve_rooms: Optional[Set[str]] = None,
    reasons: Optional[Dict[str, str]] = None,
) -> Tuple[float, Dict[str, float]]:
    """Calculate per-room time-to-comfort using Newton's law of heating.

    Returns:
        (system_ttc, per_room_dict) where:
        - system_ttc: the longest time over the rooms that recover; 0.0 with no room in deficit; -1.0 when rooms are in deficit and none recovers. reasons, when given, is filled with one of "at_comfort", "recovering", "no_heat", "cannot_reach" per room.
        - per_room_dict: {room: ttc} with 0.0 (at comfort), positive (hours),
          or -1.0 (cannot recover)
    """
    # --- Regime detection ---
    hp_running = hp_thermal_kw > HP_RUNNING_KW
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

    # INSTRUCTION-603A (FI-92(b)) — the prior U is shared by area only.
    sum_area = sum(room_areas.get(r, 0) for r in room_areas)

    # INSTRUCTION-603A (FI-92) — the emitter share of the recovery regime.
    # It is admitted when the regime is recovery, flow_temp is a finite
    # number and every room in deficit has a declared emitter output (0.0 is a
    # declaration: the room has no emitter). A room in closed_valve_rooms, or
    # with a declared output of 0.0, takes no share. Return temperature: flow
    # minus 5 C, as INSTRUCTION-593. When the share is not admitted, every
    # room keeps the demand share. A failure here keeps the demand share.
    closed = closed_valve_rooms or set()
    emitter_out: Dict[str, float] = {}
    emitter_share = False
    if (
        not equilibrium_regime
        and flow_temp is not None
        and math.isfinite(flow_temp)
        and emitter_kw
    ):
        try:
            from ..projection.emitter_model import DEFAULT_EXPONENT_RAD, emitter_output
            exps = emitter_exponents or {}
            emitter_share = True
            for room in room_areas:
                temp = room_temps.get(room)
                target = room_targets.get(room)
                if temp is None or target is None or temp >= target - deadband:
                    continue
                kw = emitter_kw.get(room)
                if kw is None or not math.isfinite(kw) or kw < 0.0:
                    emitter_share = False
                    break
                if room in closed or kw == 0.0:
                    emitter_out[room] = 0.0
                    continue
                emitter_out[room] = emitter_output(
                    rated_kw=kw, flow_temp=flow_temp, return_temp=flow_temp - 5.0,
                    room_temp=temp, exponent=exps.get(room, DEFAULT_EXPONENT_RAD),
                )
        except Exception as exc:  # noqa: BLE001 — the share is display only
            logger.debug("TTC: emitter share not used (%s)", exc)
            emitter_share = False
        if not emitter_share:
            emitter_out = {}
    total_emitter_out = sum(emitter_out.values())
    n_deficit = 0
    n_recovering = 0
    if reasons is None:
        reasons = {}

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
            reasons[room] = "at_comfort"
            continue

        deficit = effective_target - temp  # Always positive here
        n_deficit += 1

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
                    reasons[room] = "no_heat"
                    continue

            t_hours = min(t_hours, 48.0)
            per_room[room] = round(t_hours, 3)

            logger.debug(
                "TTC: %s=%.3fh [equilibrium] (deficit=%.2f, C=%.3f)",
                room, t_hours, deficit, c_val,
            )

            system_ttc = max(system_ttc, t_hours)
            n_recovering += 1
            reasons[room] = "recovering"
            continue

        # --- Recovery regime (or equilibrium outlier with deficit > 1.0) ---

        # --- C: thermal mass (kWh/degC) ---
        c_val = learned_c.get(room, area * thermal_mass_per_m2)

        # --- U: heat loss coefficient (kW/degC) ---
        u_val = learned_u.get(room)
        if u_val is None:
            if design_delta > 0 and sum_area > 0:
                whole_building_u = peak_loss / design_delta
                u_val = whole_building_u * (area / sum_area)
            else:
                # Last-resort fallback with 5 degC floor
                u_val = room_losses.get(room, 0.05) / max(temp - outdoor_temp, 5.0)
            # Ensure positive
            u_val = max(u_val, 0.001)

        # --- Q_in: demand-weighted with valve-share fallback ---
        if room in closed:
            q_in = 0.0
        elif emitter_share:
            q_in = (
                hp_thermal_kw * emitter_out.get(room, 0.0) / total_emitter_out
                if total_emitter_out > 0.0 else 0.0
            )
        elif room_demands and total_active_demand > 0.01:
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
            reasons[room] = "no_heat"
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
            reasons[room] = "cannot_reach"
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

        system_ttc = max(system_ttc, t_hours)
        n_recovering += 1
        reasons[room] = "recovering"

    # INSTRUCTION-603A (FI-92) — -1.0 only when no room in deficit recovers.
    if n_deficit > 0 and n_recovering == 0:
        system_ttc = -1.0
    return (system_ttc, per_room)


def classify_recovery_state(
    system_ttc: float,
    hp_thermal_kw: float,
    capacity_pct: float,
    min_load_pct: float,
    hot_water_active: bool = False,
    no_heat: bool = False,
    unreachable: bool = False,
) -> str:
    """Say what the time-to-comfort figure means.

    The solver returns -1.0 for two different causes: the heat pump gives no
    heat, or the heat pump runs and cannot reach the target. This function
    separates the two, so that the display does not read "insufficient
    capacity" when the heat pump is off because the demand is low.

    Returns one of:
        "insufficient_capacity" - heat pump runs, a room cannot reach target
        "at_comfort"            - heat pump runs, every room is at target
        "recovering"            - heat pump runs, system_ttc is the hours to go
        "hot_water"             - heat pump runs and heats the hot-water cylinder
        "no_heat"               - heat pump runs, every room that cannot reach
                                  target gets no heat
        "no_demand"             - heat pump off, demand below NO_DEMAND_PCT
        "below_minimum"         - heat pump off, demand below the minimum load
        "waiting"               - any other case: heat pump off with enough
                                  demand to start, or a figure that is not
                                  finite

    capacity_pct and min_load_pct are the two figures of the capacity bar.
    "at_comfort" is returned only when unreachable is False.
    """
    if hp_thermal_kw > HP_RUNNING_KW:
        # INSTRUCTION-603B — the heat goes to the cylinder, not to the rooms.
        if hot_water_active is True:
            return "hot_water"
        if not math.isfinite(system_ttc):
            return "waiting"
        # A room that cannot reach target is never shown as at comfort.
        if system_ttc < 0 or (system_ttc <= AT_COMFORT_HOURS and unreachable is True):
            return "no_heat" if no_heat is True else "insufficient_capacity"
        if system_ttc <= AT_COMFORT_HOURS:
            return "at_comfort"
        return "recovering"
    if capacity_pct < NO_DEMAND_PCT:
        return "no_demand"
    if capacity_pct < min_load_pct:
        return "below_minimum"
    return "waiting"
