"""HA forecast fetcher — moved from forecast.py to isolate HA dependency."""

import logging
from typing import Dict, List, Optional

from .integration import _call_forecast_service


def fetch_forecast_from_ha(forecast_entity: str) -> Optional[List[Dict]]:
    """
    Fetch hourly forecast via HA service call.

    Uses POST /api/services/weather/get_forecasts with type=hourly.
    Falls back to type=daily if hourly not available.
    """
    try:
        result = _call_forecast_service(forecast_entity, forecast_type="hourly")

        if result:
            return result

        result = _call_forecast_service(forecast_entity, forecast_type="daily")

        if result:
            logging.info("Weather forecast: hourly not available, using daily forecast")
            return result

        return None

    except Exception as e:
        logging.error(f"Weather forecast fetch error: {e}")
        return None
