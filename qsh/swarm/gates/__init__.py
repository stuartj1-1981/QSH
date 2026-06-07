"""qsh.swarm.gates — LocalGate composition logic (NN-C / 274C scope).

The composition logic the 263B `gate_state.py` data structures deliberately
omitted ("no composition logic — consumer enforcement is NN-C scope", 263B
Target). Ships `LocalGateCache` (server-canonical per-subclass reader) and the
uniform `gate × presence × freshness` predicate `evaluate_gate` (soak is
server-canonical, discharged at gate==OPEN; D-5).
"""

from .enforcement import GateDecision, SwarmPriors, evaluate_gate
from .local_gate import LocalGateCache

__all__ = [
    "LocalGateCache",
    "evaluate_gate",
    "SwarmPriors",
    "GateDecision",
]
