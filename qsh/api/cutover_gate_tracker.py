"""Cutover-gate state tracker — per (controller, scope) consecutive-cycles
holding count.

INSTRUCTION-208A V2 / parent INSTRUCTION-208 / design §9 Unit 11 NEW-LOW-2 V4.

Implements the cutover-state persistence rule per the design's
"flapping explicitly forbidden" discipline:

  - cycles_holding(controller, scope, all_pass) is called once per cycle
    per (controller, scope) tuple by the cutover-gate computation.
  - Returns the consecutive-cycles count that all_pass has held.
  - Resets to 0 only when all_pass is False.
  - Cycle-count semantics — wall-clock NOT used (robust against clock skew,
    DST transitions, NTP corrections).

V1 MEDIUM-1 resolution:
  - cycles_holding survives restart at its current count.
  - Resumes at the persisted value post-restart; does NOT restart at 0
    when the holding period was mid-flight at save time.

V2 MEDIUM-1 resolution — per-cycle TTL cache for cutover-gate computation
to amortise InfluxDB load under WebUX polling. Cache is keyed by cycle
timestamp; invalidation on cycle boundary AND on PATCH (operator flag flip).

State is owned by HistorianController via save_state / restore_state
(mirrors the 201A ForecastHistoryStore + 201B CounterfactualAccumulator
+ 201C AlarmADetector / AlarmBDetector persistence pattern).
"""

from threading import Lock
from typing import Dict, Optional, Tuple


class ForecastCutoverGateTracker:
    """Per (controller, scope) cycles_holding counter with mid-hold persistence."""

    def __init__(self) -> None:
        self._counts: Dict[Tuple[str, str], int] = {}
        self._lock = Lock()
        # V2 MEDIUM-1 — per-cycle TTL cache.
        self._cached_gates: Optional[dict] = None
        self._cache_timestamp: float = 0.0

    def cycles_holding(self, controller: str, scope: str, all_pass: bool) -> int:
        """Atomically: increment by 1 if all_pass else reset to 0; return new count."""
        with self._lock:
            key = (controller, scope)
            if all_pass:
                self._counts[key] = self._counts.get(key, 0) + 1
            else:
                self._counts[key] = 0
            return self._counts[key]

    def get_count(self, controller: str, scope: str) -> int:
        """Non-mutating read for diagnostic queries."""
        with self._lock:
            return self._counts.get((controller, scope), 0)

    def get_cached_gates(
        self, now_ts: float, cycle_period_s: float,
    ) -> Optional[dict]:
        """V2 MEDIUM-1 — return cached gate result if within cycle period."""
        with self._lock:
            if self._cached_gates is None:
                return None
            if (now_ts - self._cache_timestamp) >= cycle_period_s:
                return None
            return self._cached_gates

    def set_cached_gates(self, now_ts: float, gates_dict: dict) -> None:
        """V2 MEDIUM-1 — store the computed gate result + timestamp."""
        with self._lock:
            self._cached_gates = gates_dict
            self._cache_timestamp = now_ts

    def invalidate_cache(self) -> None:
        """V2 MEDIUM-1 — invalidate cache (called by PATCH endpoint on flag flip)."""
        with self._lock:
            self._cached_gates = None
            self._cache_timestamp = 0.0

    def to_dict(self) -> dict:
        """V1 MEDIUM-1: cycles_holding survives restart at its current count."""
        with self._lock:
            return {
                "counts": {f"{c}|{s}": v for (c, s), v in self._counts.items()}
            }

    def from_dict(self, data: dict) -> None:
        """V1 MEDIUM-1: restore at persisted count; do NOT restart at 0."""
        with self._lock:
            self._counts = {}
            for key, v in (data.get("counts", {}) or {}).items():
                if "|" in key:
                    c, s = key.split("|", 1)
                    self._counts[(c, s)] = int(v)


_default_tracker: Optional[ForecastCutoverGateTracker] = None
_default_tracker_lock = Lock()


def get_cutover_gate_tracker() -> ForecastCutoverGateTracker:
    """Module-level singleton accessor."""
    global _default_tracker
    with _default_tracker_lock:
        if _default_tracker is None:
            _default_tracker = ForecastCutoverGateTracker()
        return _default_tracker


def _reset_cutover_gate_tracker() -> None:
    """Test-only: reset the module-level singleton."""
    global _default_tracker
    with _default_tracker_lock:
        _default_tracker = None
