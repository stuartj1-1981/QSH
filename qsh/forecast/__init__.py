"""qsh.forecast — driver-agnostic forecast provider package.

Public surface:
  ForecastProvider   — Protocol (qsh.forecast.provider).
  ForecastBundle     — driver-agnostic forecast snapshot dataclass.
  ForecastState      — per-cycle forecast state (qsh.forecast.state).

Drivers expose a ForecastProvider via IODriver.get_forecast_provider().
Pure-function parse + compute helpers live at qsh.forecast.parse and
qsh.forecast.compute. Per-driver provider implementations live under
qsh.forecast.providers.
"""

from qsh.forecast.provider import ForecastBundle, ForecastProvider
from qsh.forecast.state import ForecastState

__all__ = [
    "ForecastBundle",
    "ForecastProvider",
    "ForecastState",
]
