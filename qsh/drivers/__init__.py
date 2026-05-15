"""I/O driver protocol and factory for the QSH signal interface.

The driver layer is the ONLY code that touches external integrations.
The pipeline communicates with the outside world exclusively through
InputBlock and OutputBlock.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Protocol

from ..signal_bus import InputBlock, OutputBlock

if TYPE_CHECKING:
    from qsh.forecast.provider import ForecastProvider
    from qsh.manual_state import ManualEntry


class IODriver(Protocol):
    """Contract every QSH driver must satisfy."""

    def setup(self, config: Dict) -> Dict[str, Any]:
        """One-time startup. Returns initial state dict, e.g. {'prev_mode': 'heat'}."""
        ...

    def teardown(self, controllers: List) -> None:
        """Graceful shutdown — persist state, flush buffers."""
        ...

    def read_inputs(self, config: Dict) -> InputBlock:
        """Fetch all external signals. Called once per cycle before pipeline."""
        ...

    def write_outputs(self, outputs: OutputBlock, config: Dict) -> None:
        """Dispatch all control outputs. Called once per cycle after pipeline."""
        ...

    def wait(self) -> None:
        """Block until next cycle. HA: sleep(30). Mock: advance sim clock."""
        ...

    def apply_failsafe(self, config: Dict, safe_flow: float = 40.0, safe_mode: str = "heat") -> None:
        """Last-resort safe state when the main control loop crashes.

        Each driver implements its own failsafe mechanism. Failures are
        logged but never raised — we're already in error handling.
        """
        ...

    @property
    def is_realtime(self) -> bool:
        """True for wall-clock drivers, False for simulation."""
        ...

    def get_forecast_provider(self) -> "ForecastProvider":
        """Return this driver's forecast provider.

        Drivers without forecast capability for this install return a
        NullForecastProvider instance (never None — the Protocol contract
        must always return a provider). Called once during pipeline build
        in qsh.main; the returned instance is reused across cycles.

        INSTRUCTION-220A introduces this method with NullForecastProvider
        stubs on every driver. Subsequent sub-instructions (220B HA,
        220C MQTT, 220D Mock) replace the stubs with real providers.
        """
        ...

    def apply_manual_position(self, room: str, position_pct: int, config: Dict) -> bool:
        """Write a MANUAL position to a single direct TRV immediately.

        Bypasses cycle scheduling. Bypasses shadow mode (control_enabled).
        Subject to the hardware-protection slew and debounce of the underlying
        dispatcher. Returns True if the write was dispatched, False on
        hardware-unavailable / unknown-hardware-type. Does not raise.

        Drivers without direct-TRV hardware (e.g. mock without valve plumbing)
        may return False unconditionally; the manual-state mutation in the
        API layer is independent of this method's success.
        """
        ...

    def manual_state_snapshot(self, config: Dict) -> Dict[str, "ManualEntry"]:
        """Return the live manual-state map for inclusion in CycleSnapshot.

        Keys are room names from configured_direct_rooms(config); every such
        room appears in the result with at minimum the AUTO sentinel. Rooms
        not in configured_direct_rooms are omitted.
        """
        ...


def create_driver(config: Dict[str, Any]) -> IODriver:
    """Instantiate the correct I/O driver based on config['driver'].

    'ha'   — Home Assistant (default)
    'mock' — Digital twin / CI testing
    """
    driver_type = config.get("driver", "ha")

    if driver_type == "ha":
        from .ha import HADriver

        return HADriver()
    elif driver_type == "mqtt":
        from .mqtt import MQTTDriver

        return MQTTDriver(config)
    elif driver_type == "mock":
        from .mock_driver import MockDriver

        return MockDriver(config)
    else:
        raise SystemExit(f"Unknown driver type: '{driver_type}'. Valid: 'ha', 'mqtt', 'mock'")
