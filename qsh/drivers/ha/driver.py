"""Home Assistant I/O driver — wraps existing fetch/write functions.

Implements the IODriver protocol by delegating to the existing sensor,
hardware, and utility modules.  No new HA logic lives here; this is
strictly a mapping layer between InputBlock/OutputBlock and the legacy
function signatures.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from ...signal_bus import InputBlock, OutputBlock


class HADriver:
    """Home Assistant implementation of the IODriver protocol."""

    def __init__(self):
        self._cycle_interval = 30  # seconds between cycles

    # ── IODriver protocol ──────────────────────────────────────────────

    def setup(self, config: Dict) -> Dict[str, Any]:
        """One-time startup: init octopus."""
        from .hardware_dispatch import get_current_heat_source_mode
        from . import octopus as octopus_api

        # dfan_control_toggle is now read each cycle via resolve_value (INSTRUCTION-36A).
        # Changes in HA propagate within one cycle; Web UX changes sync back to HA.
        dfan_entity = config.get("entities", {}).get("dfan_control_toggle")
        if dfan_entity:
            logging.info(
                "dfan_control: live read from %s (bidirectional sync active)",
                dfan_entity,
            )

        # Dashboard push disabled — Web UX is the sole interface for Beta.
        # dashboard.py code retained for potential future use.
        logging.info("Dashboard: push disabled (Web UX is primary interface)")

        # Init Octopus direct API if configured
        if config.get("has_octopus"):
            octopus_cfg = config.get("octopus_config", {})
            octopus_api.init(
                api_key=octopus_cfg.get("api_key", ""),
                hp_euid=octopus_cfg.get("hp_euid", ""),
                account_number=octopus_cfg.get("account_number", ""),
                zone_entity_id=octopus_cfg.get("zone_entity_id", ""),
            )
            logging.info("Octopus Energy API initialized")

        prev_mode = get_current_heat_source_mode(config)
        self._cycle_interval = config.get("cycle_interval", 30)
        return {"prev_mode": prev_mode}

    def teardown(self, controllers: List) -> None:
        """Graceful shutdown — persist controller state."""
        try:
            from ...pipeline import save_pipeline_state

            save_pipeline_state(controllers)
        except Exception as e:
            logging.error(f"HADriver: failed to save state on shutdown: {e}")

    def wait(self) -> None:
        """Block for one cycle interval."""
        time.sleep(self._cycle_interval)

    def apply_failsafe(self, config: Dict, safe_flow: float = 40.0, safe_mode: str = "heat") -> None:
        """Apply safe defaults via HA Supervisor API."""
        from .hardware_dispatch import apply_failsafe as _ha_failsafe

        _ha_failsafe(config, safe_flow=safe_flow, safe_mode=safe_mode)

    @property
    def is_realtime(self) -> bool:
        return True

    # ── Read ───────────────────────────────────────────────────────────

    def read_inputs(self, config: Dict) -> InputBlock:
        """Fetch all external signals from Home Assistant."""
        from .integration import fetch_ha_entity
        from .sensor_fetcher import fetch_all_sensor_data, get_flow_temp_limits, resolve_external_setpoints
        from ...utils import safe_float, parse_rates_array, get_current_rate

        # Resolve external setpoint overrides into config dict (INSTRUCTION-42A)
        resolve_external_setpoints(config)

        # Comfort target from config (now holds resolved value — INSTRUCTION-24/42A)
        target_temp = config.get("comfort_temp", 20.0)

        # Fetch all sensor data via existing aggregator
        sensor_data = fetch_all_sensor_data(config, target_temp)

        # dfan_control: read from HA entity if configured, else fall back to
        # config["dfan_control_internal"] (default True).
        from ..resolve import resolve_value as _resolve_value
        control_enabled = _resolve_value(
            config,
            entity_key="entities.dfan_control_toggle",
            internal_key="dfan_control_internal",
            default=True,
            read_fn=lambda cfg, eid: fetch_ha_entity(eid, default=None) == "on",
        ).value
        # Ensure we have a definite bool (resolve_value may return None if
        # config key is absent and default wasn't used — shouldn't happen, but
        # be explicit for downstream callers that check truthiness).
        if control_enabled is None:
            control_enabled = True

        # Fetch tariff rates
        rates_entity = config["entities"].get("current_day_rates")
        tariff_rates = []
        if rates_entity:
            from datetime import datetime, timezone

            rates_raw = fetch_ha_entity(rates_entity, "rates", default=[])
            tariff_rates = parse_rates_array(rates_raw, suppress_warning=(datetime.now(timezone.utc).hour < 16))
            retry = 0
            while not tariff_rates and retry < 3:
                retry += 1
                logging.warning(f"HADriver: rates retry {retry}/3...")
                rates_raw = fetch_ha_entity(rates_entity, "rates", default=[])
                tariff_rates = parse_rates_array(rates_raw)

        # Pre-calculate current rate and export rate
        current_rate = (
            get_current_rate(tariff_rates) if tariff_rates else config.get("fallback_rates", {}).get("standard", 0.245)
        )
        export_rate = safe_float(config.get("export_rate", 0.15), 0.15)

        # Flow limits from HA entities
        flow_min, flow_max = get_flow_temp_limits(config)

        # Forecast state (if forecaster is available)
        forecast_state = self._fetch_forecast_state(config, sensor_data.outdoor_temp, current_rate, tariff_rates)

        # HW state (if HW-aware controller is available)
        hw_state = self._fetch_hw_state(config, sensor_data)

        # Build signal quality from stale sensor tracking
        signal_quality: Dict[str, str] = {}
        stale_rooms = sensor_data.stale_rooms if hasattr(sensor_data, "stale_rooms") else set()
        for room in sensor_data.room_temps:
            if room in stale_rooms:
                signal_quality[f"room_temps.{room}"] = "stale"
            else:
                signal_quality[f"room_temps.{room}"] = "good"

        stale_sensors = sensor_data.stale_sensors if hasattr(sensor_data, "stale_sensors") else {}
        for sensor_name in stale_sensors:
            signal_quality[sensor_name] = "stale"

        # ── Fetch away mode state ─────────────────────────────────────────
        away_active = config.get("away_active_internal", False)
        away_days = config.get("away_days_internal", 1.0)

        per_zone_away = {}
        occupancy_sensor_states: Dict[str, str] = {}

        for room in config.get("rooms", {}):
            # Per-zone away toggle + duration
            room_internals = config.get("room_internals", {})
            room_cfg = room_internals.get(room, {})
            zone_away = room_cfg.get("away_active_internal", False)
            if zone_away:
                zone_days = room_cfg.get("away_days_internal", 1.0)
                per_zone_away[room] = zone_days

            # Per-zone occupancy sensor (optional — raw binary state)
            occ_sensor_cfg = config.get("room_occupancy_sensors", {}).get(room)
            if occ_sensor_cfg:
                occ_sensor_entity = occ_sensor_cfg["entity"]
                raw = fetch_ha_entity(occ_sensor_entity, default="unavailable")
                if raw in ("on", "off"):
                    occupancy_sensor_states[room] = raw
                else:
                    occupancy_sensor_states[room] = "unavailable"
                signal_quality[f"occupancy_sensor.{room}"] = (
                    "good" if raw in ("on", "off") else "unavailable"
                )

        # ── Weather forecast for recovery COP estimation ──
        forecast_temps = None
        if away_active or per_zone_away:
            forecast_temps = self._fetch_weather_forecast()

        # ── Refrigerant / Modbus sensors (hp_modbus config section) ──
        hp_modbus = config.get("sensors", {}).get("hp_modbus", {})

        def _read_modbus_entity(key: str) -> Optional[float]:
            entity_id = hp_modbus.get(key)
            if not entity_id:
                return None
            raw = fetch_ha_entity(entity_id, default=None)
            if raw is None:
                return None
            try:
                return float(raw)
            except (TypeError, ValueError):
                return None

        _evaporator_temp = _read_modbus_entity("evaporator_outlet_c")
        _suction_pressure = _read_modbus_entity("suction_pressure_kpa")
        _compressor_freq = _read_modbus_entity("compressor_freq_hz")
        _defrost_valve = _read_modbus_entity("defrost_valve_pct")

        return InputBlock(
            # Temperatures
            room_temps=dict(sensor_data.room_temps),
            independent_sensors=dict(sensor_data.independent_sensors),
            trv_temps=dict(sensor_data.trv_temps),
            trv_setpoints=dict(sensor_data.trv_setpoints),
            outdoor_temp=sensor_data.outdoor_temp,
            target_temp=target_temp,
            # Heat source
            hp_flow_temp=sensor_data.hp_flow_temp,
            hp_return_temp=sensor_data.hp_return_temp,
            hp_power=sensor_data.hp_power,
            hp_cop=sensor_data.hp_cop,
            delta_t=sensor_data.delta_t,
            flow_rate=sensor_data.flow_rate,
            # Refrigerant / Modbus
            evaporator_temp=_evaporator_temp,
            suction_pressure_kpa=_suction_pressure,
            compressor_freq_hz=_compressor_freq,
            defrost_active=(_defrost_valve or 0) > 0,
            defrost_valve_pct=_defrost_valve,
            # Valve positions
            valve_positions=dict(sensor_data.heating_percs),
            avg_open_frac=sensor_data.avg_open_frac,
            # Energy
            tariff_rates=tariff_rates,
            solar_production=sensor_data.solar_production,
            grid_power=sensor_data.grid_power,
            battery_soc=sensor_data.battery_soc,
            # Energy (expanded)
            current_rate=current_rate,
            export_rate=export_rate,
            # System state
            control_enabled=control_enabled,
            hot_water_active=sensor_data.hot_water_active,
            # Flow limits
            flow_min=flow_min,
            flow_max=flow_max,
            # Forecast + HW
            forecast_state=forecast_state,
            hw_state=hw_state,
            # Signal quality
            signal_quality=signal_quality,
            # Capability flags
            has_live_cop=sensor_data.has_live_cop,
            has_live_delta_t=sensor_data.has_live_delta_t,
            has_live_power=sensor_data.has_live_power,
            has_live_return_temp=sensor_data.has_live_return_temp,
            has_live_flow_rate=sensor_data.has_live_flow_rate,
            has_solar=getattr(sensor_data, "has_solar", False),
            has_battery=getattr(sensor_data, "has_battery", False),
            # Away mode
            away_mode_active=away_active,
            away_days=away_days,
            per_zone_away=per_zone_away,
            forecast_temps=forecast_temps,
            # Occupancy
            occupancy_sensor_states=occupancy_sensor_states,
        )

    # ── Write ──────────────────────────────────────────────────────────

    def write_outputs(self, outputs: OutputBlock, config: Dict) -> None:
        """Dispatch control outputs to Home Assistant."""
        control_enabled = config.get("control_enabled")
        if control_enabled is None:
            control_enabled = True

        # ── Hardware commands (HP flow/mode + TRV setpoints) ──
        if outputs.hardware_changed:
            logging.debug("HADriver: dispatching hardware commands")

        # ── Shoulder heat source commands ──
        if outputs.heat_source_changed and outputs.heat_source_command is not None:
            from .hardware_dispatch import set_heat_source_mode

            if control_enabled:
                logging.info(f"HADriver: shoulder command → {outputs.heat_source_command}")
                set_heat_source_mode(
                    config,
                    outputs.heat_source_command,
                    dfan_control=True,
                )
            else:
                logging.debug(f"SHADOW MODE: suppressed shoulder command → {outputs.heat_source_command}")

        # ── Valve commands ──
        if outputs.valves_changed:
            from .valve_dispatch import update_type2_external_temperatures

            if outputs.type2_external_temps:
                update_type2_external_temperatures(
                    config,
                    outputs.type2_external_temps,
                    dfan_control=control_enabled,
                )

        # ── Notifications ──
        if outputs.notifications:
            from .integration import set_ha_service

            for notif in outputs.notifications:
                try:
                    notif_id = notif.get(
                        "notification_id",
                        f"qsh_{notif.get('title', 'info').lower().replace(' ', '_')}",
                    )
                    set_ha_service(
                        "persistent_notification",
                        "create",
                        {
                            "title": notif.get("title", "QSH"),
                            "message": notif.get("message", ""),
                            "notification_id": notif_id,
                        },
                    )
                except Exception as e:
                    logging.warning(f"HADriver: notification dispatch failed: {e}")

    # ── Helpers ────────────────────────────────────────────────────────

    def _fetch_forecast_state(self, config, outdoor_temp, current_rate, tariff_rates):
        """Fetch forecast state if forecast entity is configured."""
        if not config.get("entities", {}).get("forecast_weather"):
            return None
        try:
            from ...forecast import WeatherForecaster
            from .forecast_fetcher import fetch_forecast_from_ha

            if not hasattr(self, "_forecaster"):
                self._forecaster = WeatherForecaster(config, fetch_fn=fetch_forecast_from_ha)
            return self._forecaster.get_forecast_state(
                current_outdoor_temp=outdoor_temp,
                current_rate=current_rate,
                rates=tariff_rates,
            )
        except Exception as e:
            logging.debug(f"HADriver: forecast fetch failed: {e}")
            return None

    def _fetch_hw_state(self, config, sensor_data):
        """Fetch HW-aware state if HW config is enabled."""
        hw_cfg = config.get("hw_aware", {})
        if not hw_cfg.get("enabled", False):
            return None
        try:
            from ...hw_aware import HWAwareController
            from .integration import fetch_ha_entity
            from .hw_fetcher import fetch_tank_data

            if not hasattr(self, "_hw_controller"):
                self._hw_controller = HWAwareController(
                    config,
                    fetch_ha_entity_fn=fetch_ha_entity,
                    fetch_tank_data_fn=fetch_tank_data,
                )
            return self._hw_controller.get_state()
        except Exception as e:
            logging.debug(f"HADriver: HW state fetch failed: {e}")
            return None

    def _fetch_weather_forecast(self):
        """Fetch daily OAT forecast from HA weather entity.

        Returns list of daily low temperatures (°C) for the next 7 days,
        or None if the weather integration is unavailable.

        Uses the HA REST API weather.get_forecasts service which returns
        forecast data in the response body.
        """
        import os
        import requests as _requests

        token = os.getenv("SUPERVISOR_TOKEN")
        if not token:
            return None

        try:
            resp = _requests.post(
                "http://supervisor/core/api/services/weather/get_forecasts",
                json={
                    "entity_id": "weather.home",
                    "type": "daily",
                },
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                timeout=10,
            )
            if resp.status_code != 200:
                return None

            result = resp.json()
            # Response is {"weather.home": {"forecast": [...]}}
            forecasts = result.get("weather.home", {}).get("forecast", [])
            if not forecasts:
                return None

            temps = []
            for day in forecasts[:7]:
                temp_low = day.get("templow")
                if temp_low is not None:
                    temps.append(float(temp_low))
                else:
                    temp = day.get("temperature")
                    if temp is not None:
                        temps.append(float(temp))
            return temps if temps else None
        except Exception:
            return None
