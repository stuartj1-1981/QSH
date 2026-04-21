"""Trend persistence buffer with optional InfluxDB seed.

Stores per-metric time series in ring buffers for 24h trend charts.
On startup, if InfluxDB historian is available, seeds with historical data
so trends survive restarts.

Thread-safe: shares the same lock pattern as SharedState.
"""

import logging
import threading
import time
from collections import deque
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# 24h at 30s cycles = 2880 entries per metric
DEFAULT_MAXLEN = 2880

# System-level metrics extracted from CycleSnapshot.
# INSTRUCTION-117E Task 2a: add source-aware fields. Legacy `hp_power_kw`
# and `hp_cop` remain for HP installs (type-gated at the historian writer —
# boiler installs do not emit them). `active_source_input_kw` is the new
# source-portable canonical.
SYSTEM_METRICS = [
    "outdoor_temp",
    "active_source_input_kw",
    "active_source_thermal_output_kw",
    "active_source_performance_value",
    "hp_power_kw",
    "hp_cop",
    "hp_flow_temp",
    "total_demand",
    "cost_today_pence",
    "energy_today_kwh",
]

# Per-room metrics extracted from CycleSnapshot.rooms
ROOM_METRICS = ["temp", "target", "valve"]

# Mapping from metric name to InfluxDB measurement + field
_INFLUX_METRIC_MAP: Dict[str, tuple] = {
    "outdoor_temp": ("qsh_system", "outdoor_temp"),
    "active_source_input_kw": ("qsh_system", "active_source_input_kw"),
    "active_source_thermal_output_kw": ("qsh_system", "active_source_thermal_output_kw"),
    "active_source_performance_value": ("qsh_system", "active_source_performance_value"),
    "hp_power_kw": ("qsh_system", "hp_power_kw"),
    "hp_cop": ("qsh_system", "cop"),
    "hp_flow_temp": ("qsh_system", "flow_temp"),
    "total_demand": ("qsh_system", "demand_kw"),
    "cost_today_pence": ("qsh_system", "tariff_rate"),
    "energy_today_kwh": ("qsh_system", "tariff_rate"),
}

_INFLUX_ROOM_METRIC_MAP: Dict[str, str] = {
    "temp": "temperature",
    "target": "target",
    "valve": "valve_pct",
}


class TrendBuffer:
    """Per-metric ring buffers for 24h trend data.

    Each metric (system or per-room) gets its own deque(maxlen=2880).
    Points are [{t: epoch, v: float}, ...].
    """

    def __init__(self, maxlen: int = DEFAULT_MAXLEN):
        self._lock = threading.Lock()
        self._maxlen = maxlen
        # system metrics: {metric_name: deque}
        self._system: Dict[str, deque] = {}
        # room metrics: {room_name: {metric_name: deque}}
        self._rooms: Dict[str, Dict[str, deque]] = {}

    def _get_system_deque(self, metric: str) -> deque:
        """Get or create a system metric deque. Must hold lock."""
        if metric not in self._system:
            self._system[metric] = deque(maxlen=self._maxlen)
        return self._system[metric]

    def _get_room_deque(self, room: str, metric: str) -> deque:
        """Get or create a room metric deque. Must hold lock."""
        if room not in self._rooms:
            self._rooms[room] = {}
        if metric not in self._rooms[room]:
            self._rooms[room][metric] = deque(maxlen=self._maxlen)
        return self._rooms[room][metric]

    def append(self, snapshot: Any) -> None:
        """Extract metrics from a CycleSnapshot and append to buffers."""
        ts = snapshot.timestamp
        is_hp = getattr(snapshot, "active_source_type", "heat_pump") == "heat_pump"
        with self._lock:
            # System metrics
            for metric in SYSTEM_METRICS:
                # INSTRUCTION-117E Task 2b: hp_power_kw / hp_cop are
                # type-gated — HP-only. Skip on boiler installs so the ring
                # buffer doesn't accumulate meaningless zero points.
                if metric in ("hp_power_kw", "hp_cop") and not is_hp:
                    continue
                val = _resolve_metric_value(snapshot, metric)
                if val is not None:
                    self._get_system_deque(metric).append({"t": ts, "v": val})

            # Additional HP metrics from snapshot attributes
            if hasattr(snapshot, "hp_flow_temp"):
                self._get_system_deque("hp_flow_temp").append(
                    {"t": ts, "v": snapshot.hp_flow_temp}
                )

            # Per-room metrics
            rooms = snapshot.rooms if hasattr(snapshot, "rooms") else {}
            for room_name, room_data in rooms.items():
                for metric in ROOM_METRICS:
                    val = room_data.get(metric)
                    if val is not None:
                        self._get_room_deque(room_name, metric).append(
                            {"t": ts, "v": val}
                        )

    def query(
        self,
        metric: str,
        hours: float = 24,
        room: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return trend points for a metric within the last `hours`.

        Args:
            metric: Metric name (e.g. "outdoor_temp", "temp", "valve")
            hours: Time window in hours (default 24)
            room: Room name for per-room metrics (None for system metrics)

        Returns:
            List of {t: epoch, v: float} dicts
        """
        cutoff = time.time() - (hours * 3600)
        with self._lock:
            if room:
                buf = self._rooms.get(room, {}).get(metric, deque())
            else:
                buf = self._system.get(metric, deque())
            return [p for p in buf if p["t"] >= cutoff]

    @property
    def size(self) -> int:
        """Total number of points across all buffers."""
        with self._lock:
            total = sum(len(d) for d in self._system.values())
            for room_deques in self._rooms.values():
                total += sum(len(d) for d in room_deques.values())
            return total

    def seed_from_influxdb(self, historian: Any) -> None:
        """Seed buffers with last 24h of data from InfluxDB.

        Called once on startup. If InfluxDB is unreachable, logs a warning
        and continues with empty buffers (graceful degradation).
        """
        if historian is None or not historian.is_active:
            logger.info("TrendBuffer: No active historian — starting empty")
            return

        client = getattr(historian, "_client", None)
        if client is None:
            logger.info("TrendBuffer: No InfluxDB client — starting empty")
            return

        try:
            self._seed_system_metrics(client)
            self._seed_room_metrics(client)
            logger.info("TrendBuffer: Seeded %d points from InfluxDB", self.size)
        except Exception as e:
            logger.warning("TrendBuffer: InfluxDB seed failed: %s", e)

    def _seed_system_metrics(self, client: Any) -> None:
        """Query system metrics from InfluxDB and populate buffers."""
        fields = [
            "outdoor_temp",
            "active_source_input_kw",
            "active_source_thermal_output_kw",
            "active_source_performance_value",
            "hp_power_kw",
            "cop AS hp_cop",
            "flow_temp AS hp_flow_temp",
            "demand_kw AS total_demand",
            "tariff_rate",
        ]
        query = (
            f'SELECT {", ".join(fields)} FROM qsh_system '
            f"WHERE time > now() - 24h"
        )
        try:
            result = client.query(query)
            points = list(result.get_points(measurement="qsh_system"))
        except Exception as e:
            logger.debug("TrendBuffer: system query failed: %s", e)
            return

        with self._lock:
            for point in points:
                ts = _parse_influx_time(point.get("time"))
                if ts is None:
                    continue

                _map = {
                    "outdoor_temp": "outdoor_temp",
                    "active_source_input_kw": "active_source_input_kw",
                    "active_source_thermal_output_kw": "active_source_thermal_output_kw",
                    "active_source_performance_value": "active_source_performance_value",
                    "hp_power_kw": "hp_power_kw",
                    "hp_cop": "hp_cop",
                    "hp_flow_temp": "hp_flow_temp",
                    "total_demand": "total_demand",
                    "tariff_rate": "cost_today_pence",
                }
                for influx_key, metric_name in _map.items():
                    val = point.get(influx_key)
                    if val is not None:
                        self._get_system_deque(metric_name).append(
                            {"t": ts, "v": float(val)}
                        )

    def _seed_room_metrics(self, client: Any) -> None:
        """Query room metrics from InfluxDB and populate buffers."""
        query = (
            'SELECT temperature, target, valve_pct FROM qsh_room '
            'WHERE time > now() - 24h GROUP BY room'
        )
        try:
            result = client.query(query)
        except Exception as e:
            logger.debug("TrendBuffer: room query failed: %s", e)
            return

        with self._lock:
            for (_, tags), points in result.items():
                room = tags.get("room", "")
                if not room:
                    continue
                for point in points:
                    ts = _parse_influx_time(point.get("time"))
                    if ts is None:
                        continue
                    influx_to_metric = {
                        "temperature": "temp",
                        "target": "target",
                        "valve_pct": "valve",
                    }
                    for influx_key, metric_name in influx_to_metric.items():
                        val = point.get(influx_key)
                        if val is not None:
                            self._get_room_deque(room, metric_name).append(
                                {"t": ts, "v": float(val)}
                            )


def _resolve_metric_value(snapshot: Any, metric: str) -> Optional[float]:
    """Resolve a SYSTEM_METRICS value from a CycleSnapshot.

    Source-aware metrics (INSTRUCTION-117E Task 2a) are derived from the
    source-aware snapshot fields; the legacy metrics continue to read their
    flat snapshot attribute directly.
    """
    if metric == "active_source_input_kw":
        return getattr(snapshot, "active_source_input_power_kw", None)
    if metric == "active_source_thermal_output_kw":
        return getattr(snapshot, "active_source_thermal_output_kw", None)
    if metric == "active_source_performance_value":
        perf = getattr(snapshot, "active_source_performance", None)
        return perf.value if perf is not None else None
    return getattr(snapshot, metric, None)


def _parse_influx_time(time_str: Optional[str]) -> Optional[float]:
    """Parse InfluxDB ISO timestamp to epoch seconds."""
    if not time_str:
        return None
    try:
        from datetime import datetime, timezone

        # InfluxDB returns ISO format like "2024-01-15T10:30:00Z"
        dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, AttributeError):
        return None


# Module-level singleton
trend_buffer = TrendBuffer()
