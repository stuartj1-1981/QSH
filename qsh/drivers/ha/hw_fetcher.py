"""HA hot water data fetcher — moved from hw_aware.py to isolate HA dependency."""

import logging
from typing import Optional, Tuple

from .integration import fetch_ha_entity


def fetch_tank_data(water_heater_entity: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Fetch live target temperature and current tank temperature
    from the water_heater entity.

    Returns (live_target_temp, tank_current_temp) — either may be None.
    """
    if not water_heater_entity:
        return None, None

    try:
        raw_target = fetch_ha_entity(water_heater_entity, "temperature", default=None)
        live_target = None
        if raw_target is not None:
            try:
                live_target = float(raw_target)
                if live_target < 20 or live_target > 80:
                    live_target = None
            except (ValueError, TypeError):
                live_target = None

        raw_current = fetch_ha_entity(water_heater_entity, "current_temperature", default=None)
        tank_current = None
        if raw_current is not None:
            try:
                tank_current = float(raw_current)
                if tank_current < 0 or tank_current > 100:
                    tank_current = None
            except (ValueError, TypeError):
                tank_current = None

        return live_target, tank_current

    except Exception as e:
        logging.debug(f"Failed to fetch water_heater data: {e}")
        return None, None
