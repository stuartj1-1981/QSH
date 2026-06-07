"""qsh.swarm.shadow_sysid — Parallel shadow sysid track + counterfactual reconciliation.

INSTRUCTION-274D. The shadow track (track.py) runs the live learning subset
against ungated received priors with strict isolation from live state;
reconciliation (reconciliation.py) emits per-cycle divergence records into the
201B counterfactual log channel.
"""

from .track import ShadowSysidTrack

__all__ = ["ShadowSysidTrack"]
