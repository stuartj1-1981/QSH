"""qsh.swarm.consumers — Inbound prior consumption helpers.

INSTRUCTION-263B V5 housed the in-memory prior cache. 274C: consumer classes +
gate enforcement landed — four stateless translators from a prior_cache entry to
the payload a downstream live-sysid blend (274D) would consume.
"""

from .disturbance import DisturbanceConsumer
from .rl_benchmarks import RLBenchmarksConsumer
from .solar import SolarConsumer
from .sysid_priors import SysidPriorsConsumer

__all__ = [
    "SysidPriorsConsumer",
    "SolarConsumer",
    "DisturbanceConsumer",
    "RLBenchmarksConsumer",
]
