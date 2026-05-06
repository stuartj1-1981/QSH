"""QSH Projection — production helpers for first-order thermal projection.

Helpers in this subpackage are production code: they ship to the public image,
either compiled per ``scripts/release/submodule-compile-list.txt`` or — for
this package's ``__init__.py`` — source-shipped per the init-only-ship
whitelist in ``scripts/release/release-sync.sh``.

Per tenet T-31 (Production-Code Import-Graph Constraint, Governance Ledger
Entry 031): production code in this subpackage MUST NOT import from
namespaces excluded from the public ship (currently ``qsh.twin.*`` per
T-17). Excluded-namespace code MAY import from this subpackage — the
constraint is one-directional.

These helpers were relocated from ``qsh/twin/`` by INSTRUCTION-179 so they
ship cleanly without crossing the import-graph boundary.
"""

from .emitter_model import aggregate_emitter_output
from .heat_source_model import CopMap, HeatSourceFn, create_heat_source_model
from .trajectory import project_trajectory

__all__ = [
    "aggregate_emitter_output",
    "CopMap",
    "HeatSourceFn",
    "create_heat_source_model",
    "project_trajectory",
]
