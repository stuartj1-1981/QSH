"""In-memory ring buffer for cycle history.

Stores slim per-cycle records for trend charts. At 30s cycles:
- 24h = 2880 entries, 7d = 20160 entries (~4MB total). Acceptable.

Thread-safe: uses the same lock pattern as SharedState.
"""

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class HistoryEntry:
    """Slim per-cycle record for history storage."""
    timestamp: float = 0.0
    cycle_number: int = 0
    applied_flow: float = 0.0
    optimal_flow: float = 0.0
    total_demand: float = 0.0
    operating_state: str = ""
    applied_mode: str = ""
    optimal_mode: str = ""
    outdoor_temp: float = 0.0
    hp_power_kw: float = 0.0
    # INSTRUCTION-120B: None (→ JSON null) when HP off or performance in
    # sensor-loss fallback — carries the gated `snap.hp_cop` value
    # unchanged.
    hp_cop: Optional[float] = None
    hp_flow_temp: float = 0.0
    hp_return_temp: float = 0.0
    delta_t: float = 0.0
    cost_today_pence: float = 0.0
    energy_today_kwh: float = 0.0
    predicted_saving: float = 0.0
    rl_reward: float = 0.0
    rl_loss: float = 0.0
    rl_blend: float = 0.0
    det_flow: float = 0.0
    rl_flow: Optional[float] = None
    comfort_pct: float = 0.0
    rooms: Dict[str, Dict[str, Any]] = field(default_factory=dict)


# 7 days at 30s cycles
MAX_ENTRIES = 20160


class CycleHistory:
    """Thread-safe ring buffer of cycle history entries."""

    def __init__(self, maxlen: int = MAX_ENTRIES):
        self._lock = threading.Lock()
        self._buffer: deque[HistoryEntry] = deque(maxlen=maxlen)

    def append(self, entry: HistoryEntry):
        with self._lock:
            self._buffer.append(entry)

    def query(self, hours: float, metrics: Optional[List[str]] = None) -> List[dict]:
        """Return entries within the last `hours`, optionally filtered to specific metrics."""
        cutoff = time.time() - (hours * 3600)
        with self._lock:
            entries = [e for e in self._buffer if e.timestamp >= cutoff]

        if metrics:
            return [
                {"t": e.timestamp, **{m: getattr(e, m, None) for m in metrics}}
                for e in entries
            ]
        return [{"t": e.timestamp, **asdict(e)} for e in entries]

    def query_rooms(self, hours: float, fields: Optional[List[str]] = None) -> Dict[str, List[dict]]:
        """Return per-room history within the last `hours`."""
        cutoff = time.time() - (hours * 3600)
        with self._lock:
            entries = [e for e in self._buffer if e.timestamp >= cutoff]

        room_data: Dict[str, List[dict]] = {}
        valid_fields = fields or ["temp", "target", "valve", "occupancy"]

        for entry in entries:
            for room_name, room_info in entry.rooms.items():
                if room_name not in room_data:
                    room_data[room_name] = []
                point: dict = {"t": entry.timestamp}
                for f in valid_fields:
                    point[f] = room_info.get(f)
                room_data[room_name].append(point)

        return room_data

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._buffer)

    def seed_from_influxdb(self, historian: Any) -> None:
        """Seed the history buffer with last 24h of data from InfluxDB.

        Called once on startup so that 24h graphs are populated immediately
        after a restart rather than starting empty.
        """
        if historian is None or not historian.is_active:
            logger.info("CycleHistory: No active historian — starting empty")
            return

        client = getattr(historian, "_client", None)
        if client is None:
            logger.info("CycleHistory: No InfluxDB client — starting empty")
            return

        try:
            entries = self._query_and_build_entries(client)
            if entries:
                with self._lock:
                    for entry in entries:
                        self._buffer.append(entry)
                logger.info(
                    "CycleHistory: Seeded %d entries from InfluxDB", len(entries)
                )
            else:
                logger.info("CycleHistory: No historical data found in InfluxDB")
        except Exception as e:
            logger.warning("CycleHistory: InfluxDB seed failed: %s", e)

    def _query_and_build_entries(self, client: Any) -> List["HistoryEntry"]:
        """Query InfluxDB for system, room, and RL data; merge into HistoryEntry list."""
        from datetime import datetime, timezone

        def _parse_ts(time_str):
            if not time_str:
                return None
            try:
                dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                return dt.timestamp()
            except (ValueError, AttributeError):
                return None

        # ── Query system metrics ──
        sys_query = (
            "SELECT flow_temp, outdoor_temp, hp_power_kw, cop, delta_t, "
            "demand_kw, tariff_rate, return_temp, operating_state "
            "FROM qsh_system WHERE time > now() - 24h"
        )
        try:
            sys_result = client.query(sys_query)
            sys_points = list(sys_result.get_points(measurement="qsh_system"))
        except Exception as e:
            logger.debug("CycleHistory: system query failed: %s", e)
            sys_points = []

        # ── Query RL metrics ──
        rl_query = (
            "SELECT reward, loss, blend_factor, det_flow, rl_proposed_flow "
            "FROM qsh_rl WHERE time > now() - 24h"
        )
        try:
            rl_result = client.query(rl_query)
            rl_points = list(rl_result.get_points(measurement="qsh_rl"))
        except Exception as e:
            logger.debug("CycleHistory: RL query failed: %s", e)
            rl_points = []

        # ── Query room metrics ──
        room_query = (
            "SELECT temperature, target, valve_pct, occupancy "
            "FROM qsh_room WHERE time > now() - 24h GROUP BY room"
        )
        try:
            room_result = client.query(room_query)
        except Exception as e:
            logger.debug("CycleHistory: room query failed: %s", e)
            room_result = None

        # Build room data indexed by rounded timestamp
        # (round to nearest 30s to align with system points)
        room_by_ts: Dict[int, Dict[str, Dict[str, Any]]] = {}
        if room_result is not None:
            for (_, tags), points in room_result.items():
                room_name = tags.get("room", "")
                if not room_name:
                    continue
                for pt in points:
                    ts = _parse_ts(pt.get("time"))
                    if ts is None:
                        continue
                    ts_key = int(ts // 30) * 30  # round to 30s boundary
                    if ts_key not in room_by_ts:
                        room_by_ts[ts_key] = {}
                    room_by_ts[ts_key][room_name] = {
                        "temp": pt.get("temperature"),
                        "target": pt.get("target"),
                        "valve": pt.get("valve_pct", 0),
                        "occupancy": pt.get("occupancy", "unknown"),
                    }

        # Build RL data indexed by rounded timestamp
        rl_by_ts: Dict[int, dict] = {}
        for pt in rl_points:
            ts = _parse_ts(pt.get("time"))
            if ts is None:
                continue
            ts_key = int(ts // 30) * 30
            rl_by_ts[ts_key] = {
                "rl_reward": pt.get("reward", 0.0),
                "rl_loss": pt.get("loss", 0.0),
                "rl_blend": pt.get("blend_factor", 0.0),
                "det_flow": pt.get("det_flow", 0.0),
                "rl_flow": pt.get("rl_proposed_flow"),
            }

        # ── Merge into HistoryEntry objects ──
        entries: List[HistoryEntry] = []
        for pt in sys_points:
            ts = _parse_ts(pt.get("time"))
            if ts is None:
                continue
            ts_key = int(ts // 30) * 30

            rl = rl_by_ts.get(ts_key, {})
            rooms = room_by_ts.get(ts_key, {})

            # Compute comfort_pct from room data
            rooms_below = sum(
                1 for r in rooms.values()
                if r.get("temp") is not None and r.get("target") is not None
                and r["temp"] < r["target"] - 0.3
            )
            comfort_pct = round(
                (1 - rooms_below / max(len(rooms), 1)) * 100, 0
            )

            entry = HistoryEntry(
                timestamp=ts,
                applied_flow=pt.get("flow_temp", 0.0) or 0.0,
                optimal_flow=pt.get("flow_temp", 0.0) or 0.0,
                total_demand=pt.get("demand_kw", 0.0) or 0.0,
                outdoor_temp=pt.get("outdoor_temp", 0.0) or 0.0,
                hp_power_kw=pt.get("hp_power_kw", 0.0) or 0.0,
                hp_cop=pt.get("cop", 0.0) or 0.0,
                hp_flow_temp=pt.get("flow_temp", 0.0) or 0.0,
                hp_return_temp=pt.get("return_temp", 0.0) or 0.0,
                delta_t=pt.get("delta_t", 0.0) or 0.0,
                cost_today_pence=pt.get("tariff_rate", 0.0) or 0.0,
                operating_state=pt.get("operating_state") or "",
                rl_reward=rl.get("rl_reward", 0.0) or 0.0,
                rl_loss=rl.get("rl_loss", 0.0) or 0.0,
                rl_blend=rl.get("rl_blend", 0.0) or 0.0,
                det_flow=rl.get("det_flow", 0.0) or 0.0,
                rl_flow=rl.get("rl_flow"),
                comfort_pct=comfort_pct,
                rooms=rooms,
            )
            entries.append(entry)

        # Sort by timestamp (InfluxDB should return sorted, but be safe)
        entries.sort(key=lambda e: e.timestamp)
        return entries


def snapshot_to_history_entry(snap) -> HistoryEntry:
    """Convert a CycleSnapshot to a slim HistoryEntry."""
    rooms_below = sum(
        1 for r in snap.rooms.values()
        if r.get('temp') is not None and r.get('target') is not None
        and r['temp'] < r['target'] - 0.3
    )
    comfort_pct = round((1 - rooms_below / max(len(snap.rooms), 1)) * 100, 0)

    # Store slim room data
    slim_rooms = {}
    for name, room in snap.rooms.items():
        slim_rooms[name] = {
            'temp': room.get('temp'),
            'target': room.get('target'),
            'valve': room.get('valve', 0),
            'occupancy': room.get('occupancy', 'occupied'),
        }

    return HistoryEntry(
        timestamp=snap.timestamp,
        cycle_number=snap.cycle_number,
        applied_flow=snap.applied_flow,
        optimal_flow=snap.optimal_flow,
        total_demand=snap.total_demand,
        operating_state=snap.operating_state,
        applied_mode=snap.applied_mode,
        optimal_mode=snap.optimal_mode,
        outdoor_temp=snap.outdoor_temp,
        hp_power_kw=snap.hp_power_kw,
        hp_cop=snap.hp_cop,
        hp_flow_temp=snap.hp_flow_temp,
        hp_return_temp=snap.hp_return_temp,
        delta_t=snap.delta_t,
        cost_today_pence=snap.cost_today_pence,
        energy_today_kwh=snap.energy_today_kwh,
        predicted_saving=snap.predicted_saving,
        rl_reward=snap.rl_reward,
        rl_loss=snap.rl_loss,
        rl_blend=snap.rl_blend,
        det_flow=snap.det_flow,
        rl_flow=snap.rl_flow,
        comfort_pct=comfort_pct,
        rooms=slim_rooms,
    )


# Module-level singleton
cycle_history = CycleHistory()
