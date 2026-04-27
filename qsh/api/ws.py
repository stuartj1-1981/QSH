"""WebSocket endpoint for live cycle data push.

Uses an asyncio.Event-based broadcast pattern:
- Each connected client waits on a shared event
- Pipeline thread calls notify_clients() after updating shared state
- All waiting clients wake, read the snapshot, and send it

No per-connection polling. Clients receive data within milliseconds of
the pipeline completing a cycle.

The uvicorn loop reference is captured by the first WebSocket handler to run
(`_ensure_initialised`). `notify_clients()` is callable from any thread and
uses that captured reference — `asyncio.get_event_loop()` is **not** safe
here because the pipeline thread has no running loop on Python 3.11+.

`_loop` and `_cycle_event` are written once and read many. Concurrent first-
connect coroutines on the same loop write identical values; CPython's GIL
makes the idempotent first-write safe without explicit locking.
"""

import asyncio
import logging
from typing import Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .state import build_heat_source_payload, build_hp_shim, shared_state

logger = logging.getLogger(__name__)

router = APIRouter()

# Broadcast infrastructure
_clients: Set[WebSocket] = set()
_loop: Optional[asyncio.AbstractEventLoop] = None
_cycle_event: Optional[asyncio.Event] = None


def _ensure_initialised() -> asyncio.Event:
    """Initialise the broadcast loop and event the first time a WS client connects.

    Must be called from inside the WebSocket handler — i.e. from a coroutine
    running on the uvicorn loop. asyncio.get_running_loop() is the supported
    cross-version way to obtain that loop reference.
    """
    global _loop, _cycle_event
    if _loop is None:
        _loop = asyncio.get_running_loop()
    if _cycle_event is None:
        _cycle_event = asyncio.Event()
    return _cycle_event


def notify_clients() -> None:
    """Called from the pipeline thread after SharedState.update().

    Thread-safe. Uses the loop reference captured by the first WebSocket
    handler — this avoids asyncio.get_event_loop() returning a non-running
    loop (or raising RuntimeError) when called from the main thread on
    Python 3.11+.
    """
    if _loop is None or _cycle_event is None:
        return  # No client has connected yet — nothing to notify.
    try:
        _loop.call_soon_threadsafe(_cycle_event.set)
    except RuntimeError:
        pass  # Loop stopped during shutdown.


@router.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    """Push cycle snapshot to client whenever the pipeline completes a cycle."""
    await ws.accept()
    _clients.add(ws)
    event = _ensure_initialised()
    logger.info("WebSocket client connected (%d total)", len(_clients))

    try:
        # Send current state immediately on connect
        snap = shared_state.get_snapshot()
        await ws.send_json(_format_snapshot(snap))
        last_cycle = snap.cycle_number

        while True:
            # Wait for pipeline to signal a new cycle (or timeout for keepalive)
            event.clear()
            try:
                await asyncio.wait_for(event.wait(), timeout=60.0)
            except asyncio.TimeoutError:
                # No cycle in 60s — send a keepalive ping
                await ws.send_json({"type": "keepalive"})
                continue

            snap = shared_state.get_snapshot()
            if snap.cycle_number != last_cycle:
                await ws.send_json(_format_snapshot(snap))
                last_cycle = snap.cycle_number

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("WebSocket error: %s", e)
    finally:
        _clients.discard(ws)
        logger.info("WebSocket client disconnected (%d remaining)", len(_clients))


def _format_snapshot(snap) -> dict:
    """Format CycleSnapshot for WebSocket transmission."""
    rooms_below = sum(
        1 for r in snap.rooms.values()
        if r['temp'] is not None and r['target'] is not None
        and r['temp'] < r['target'] - 0.3
    )
    return {
        "type": "cycle",
        "timestamp": snap.timestamp,
        "cycle_number": snap.cycle_number,
        "status": {
            "operating_state": snap.operating_state,
            "control_enabled": snap.control_enabled,
            "comfort_temp": snap.comfort_temp,
            "comfort_schedule_active": snap.comfort_schedule_active,
            "comfort_temp_active": snap.comfort_temp_active,
            "optimal_flow": round(snap.optimal_flow, 1),
            "applied_flow": round(snap.applied_flow, 1),
            "optimal_mode": snap.optimal_mode,
            "applied_mode": snap.applied_mode,
            "total_demand": round(snap.total_demand, 2),
            "outdoor_temp": round(snap.outdoor_temp, 1),
            "heat_source": build_heat_source_payload(snap),
            "comfort_pct": round((1 - rooms_below / max(len(snap.rooms), 1)) * 100, 0),
            "recovery_time_hours": snap.recovery_time_hours,
            "capacity_pct": snap.capacity_pct,
            "hp_capacity_kw": snap.hp_capacity_kw,
            "min_load_pct": snap.min_load_pct,
        },
        "hp": build_hp_shim(snap),
        "rooms": snap.rooms,
        "energy": {
            "current_rate": snap.current_rate,
            "cost_today_pence": round(snap.cost_today_pence, 1),
            "cost_yesterday_pence": round(snap.cost_yesterday_pence, 1),
            "energy_today_kwh": round(snap.energy_today_kwh, 2),
            "predicted_saving": round(snap.predicted_saving, 1),
            "predicted_energy_saving": round(snap.predicted_energy_saving, 2),
            "export_rate": snap.export_rate,
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
            "antifrost_override_active": snap.antifrost_override_active,
            "winter_equilibrium": snap.winter_equilibrium,
            "antifrost_threshold": snap.antifrost_threshold,
            "signal_quality": snap.signal_quality,
        },
        "boost": {
            "active": snap.boost_active,
            "rooms": snap.boost_rooms,
        },
        "away": {
            "active": snap.away_mode_active,
            "days": snap.away_days,
            "recovery_active": snap.recovery_active,
            "zones_recovering": snap.zones_recovering,
        },
        "source_selection": snap.source_selection,
    }
