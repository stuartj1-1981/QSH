"""I/O driver protocol and factory for the QSH signal interface.

The driver layer is the ONLY code that touches external integrations.
The pipeline communicates with the outside world exclusively through
InputBlock and OutputBlock.
"""

from __future__ import annotations

from typing import Any, Dict, List, Protocol

from ..signal_bus import InputBlock, OutputBlock


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
