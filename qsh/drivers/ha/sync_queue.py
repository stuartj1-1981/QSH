"""Transient HA sync retry queue.

Imported by both API routes (qsh.api.routes.control) and pipeline controllers
(qsh.pipeline.controllers.shadow_controller).  Neither imports the other, so
there is no circular dependency risk.

Contents are NEVER persisted to yaml — lost on restart by design.  Any key
stored in config risks being serialised to qsh.yaml by _save_yaml(), surviving
a restart, and triggering a spurious HA service call against a stale value on
next boot.  This module is the correct home for transient retry state.

Keys:
    "dfan_control"  →  bool  (desired control_enabled state pending HA sync)
"""

from typing import Any

# Keys → desired values pending HA sync.
# Cleared by shadow_controller on successful retry.
pending_ha_syncs: dict[str, Any] = {}
