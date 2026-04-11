"""HA COP fetcher — moved from utils.py to isolate HA dependency."""

import logging
import time
import numpy as np

from .integration import fetch_ha_entity
from ...utils import safe_float

_last_cop_warning = 0


def get_reliable_cop(config, cop_history):
    """
    Get COP/efficiency with smart fallback.

    For heat pumps with COP sensor: live reading > history median > config default.
    For heat pumps without COP sensor: config default (heat_source_efficiency).
    For boilers: always returns config efficiency (0.85-0.95 typical).
    """
    global _last_cop_warning

    # TODO(F6): Migrate to read from ctx.active_source_efficiency
    # once COP fetcher is refactored to receive ctx instead of config.
    # Deprecation deadline: INSTRUCTION-18 or 2026-05-01, whichever first.
    default_efficiency = config.get("heat_source_efficiency", 3.5)

    if not config.get("has_cop_sensor") and not config["entities"].get("hp_cop"):
        return default_efficiency

    cop_entity = config["entities"].get("hp_cop")
    cop_raw = fetch_ha_entity(cop_entity, default=None)
    cop_value = safe_float(cop_raw, None)

    if cop_value is not None and 0.5 <= cop_value <= 10.0:
        logging.debug(f"COP from sensor: {cop_value:.2f}")
        return cop_value

    valid_history = [c for c in cop_history if 0.5 <= c <= 10.0]
    if valid_history:
        median_cop = float(np.median(valid_history))
        now = time.time()
        if now - _last_cop_warning >= 60:
            logging.debug(f"COP unavailable/invalid (raw='{cop_raw}'), using history median: {median_cop:.2f}")
            _last_cop_warning = now
        return median_cop

    logging.error(
        f"No valid COP data available (raw='{cop_raw}', history empty), "
        f"using configured efficiency: {default_efficiency}"
    )
    return default_efficiency
