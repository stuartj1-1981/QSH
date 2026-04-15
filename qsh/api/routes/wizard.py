"""Setup wizard endpoints — config building, entity scanning, deployment."""

import logging
import os
import copy
import yaml
import requests
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import time as _time

from ...telemetry import CloudFlareTransport, DEFAULT_ENDPOINT

try:
    import paho.mqtt.client as _paho_mqtt
except ImportError:
    _paho_mqtt = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wizard", tags=["wizard"])

HA_TIMEOUT = 5


def _get_ha_headers():
    """Lazily resolve HA Supervisor credentials. Only called when an HA endpoint runs."""
    token = os.getenv("SUPERVISOR_TOKEN")
    if not token:
        return None, None, None
    url = "http://supervisor/core"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return url, token, headers

YAML_PATH = "/config/qsh.yaml"  # Primary write path (addon_config:rw mount)


# ── Pydantic models ──


class WizardValidateRequest(BaseModel):
    """Partial or complete config dict for validation."""

    config: Dict[str, Any]
    step: Optional[str] = None  # Which wizard step to validate (or None for full)


class WizardDeployRequest(BaseModel):
    """Complete config dict for deployment."""

    config: Dict[str, Any]


class OctopusTestRequest(BaseModel):
    api_key: str
    account_number: str


class EntityScanRequest(BaseModel):
    """Optional filters for entity scanning."""

    domain_filter: Optional[List[str]] = None
    keyword: Optional[str] = None


# ── Entity Scanner ──


def _fetch_all_entities() -> List[Dict]:
    """Fetch all HA entity states via REST API."""
    ha_url, _, ha_headers = _get_ha_headers()
    if not ha_headers:
        logger.warning("No SUPERVISOR_TOKEN — entity scan unavailable")
        return []
    try:
        resp = requests.get(
            f"{ha_url}/api/states",
            headers=ha_headers,
            timeout=HA_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error("Entity scan failed: %s", e)
        return []


def _score_entity(entity: Dict, slot: str, room: str = "") -> int:
    """Heuristic score for how well an entity matches a config slot.

    Higher score = better match. 0 = no match.
    """
    eid = entity.get("entity_id", "")
    attrs = entity.get("attributes", {})
    name = attrs.get("friendly_name", eid).lower()
    eid_lower = eid.lower()
    device_class = attrs.get("device_class", "")
    room_lower = room.lower().replace("_", " ")
    score = 0

    if slot == "trv_entity":
        if not eid.startswith("climate."):
            return 0
        score += 10
        if room_lower and room_lower in eid_lower:
            score += 20
        if room_lower and room_lower in name:
            score += 15
        if "trv" in eid_lower or "trv" in name:
            score += 10
        if "radiator" in name or "valve" in name:
            score += 5

    elif slot == "independent_sensor":
        if not eid.startswith("sensor."):
            return 0
        if device_class != "temperature":
            unit = attrs.get("unit_of_measurement", "")
            if "\u00b0C" not in unit and "\u00b0F" not in unit:
                return 0
        score += 10
        if room_lower and room_lower in eid_lower:
            score += 20
        if room_lower and room_lower in name:
            score += 15
        if "independent" in eid_lower or "room" in eid_lower:
            score += 5
        if "trv" in eid_lower or "valve" in eid_lower:
            score -= 5

    elif slot == "heating_entity":
        if not (eid.startswith("binary_sensor.") or eid.startswith("input_boolean.")):
            return 0
        score += 5
        if "heating" in eid_lower or "heat" in name:
            score += 10
        if room_lower and room_lower in eid_lower:
            score += 20

    elif slot == "occupancy_sensor":
        # Gate: HA convention is binary_sensor.* for occupancy/presence.
        # Known limitation: some ESPHome mmWave integrations expose occupancy
        # as a sensor.* entity with a binary attribute rather than a standalone
        # binary_sensor. Those won't be discovered here — user must enter manually.
        if not eid.startswith("binary_sensor."):
            return 0
        score += 5
        if "occupancy" in eid_lower or "presence" in eid_lower:
            score += 15
        if room_lower and room_lower in eid_lower:
            score += 20
        if room_lower and room_lower in name:
            score += 15
        if "motion" in eid_lower or "movement" in eid_lower:
            score += 5
        if "pir" in eid_lower or "mmwave" in eid_lower or "radar" in eid_lower:
            score += 5
        if "detector" in eid_lower or "sensor" in eid_lower:
            score += 2

    elif slot == "hp_flow_temp":
        if not eid.startswith("sensor."):
            return 0
        if "flow" in eid_lower and ("temp" in eid_lower or device_class == "temperature"):
            score += 25
        elif "leaving" in eid_lower and "water" in eid_lower:
            score += 20
        if "heat_pump" in eid_lower or "hp" in eid_lower or "ashp" in eid_lower:
            score += 10

    elif slot == "hp_power":
        if not eid.startswith("sensor."):
            return 0
        if device_class in ("power", "energy"):
            score += 10
        if "power" in eid_lower or "consumption" in eid_lower:
            score += 15
        if "heat_pump" in eid_lower or "hp" in eid_lower or "ashp" in eid_lower:
            score += 10

    elif slot == "hp_cop":
        if not eid.startswith("sensor."):
            return 0
        if "cop" in eid_lower:
            score += 30
        if "heat_pump" in eid_lower or "hp" in eid_lower:
            score += 10

    elif slot == "hp_heat_output":
        if not eid.startswith("sensor."):
            return 0
        if "heat_output" in eid_lower or "thermal_output" in eid_lower or "live_heat" in eid_lower:
            score += 25
        if device_class == "power":
            score += 5
        if "heat_pump" in eid_lower or "hp" in eid_lower or "ashp" in eid_lower:
            score += 10

    elif slot == "hp_total_energy":
        if not eid.startswith("sensor."):
            return 0
        if device_class == "energy":
            score += 10
        if "energy" in eid_lower and "total" in eid_lower:
            score += 20
        elif "energy" in eid_lower:
            score += 10
        if "heat_pump" in eid_lower or "hp" in eid_lower or "ashp" in eid_lower:
            score += 10

    elif slot == "hp_water_heater":
        if not eid.startswith("water_heater."):
            return 0
        score += 15
        if "heat_pump" in eid_lower or "octopus" in eid_lower:
            score += 10

    elif slot == "hp_return_temp":
        if not eid.startswith("sensor."):
            return 0
        if device_class == "temperature":
            score += 5
        if "return" in eid_lower or "secondary" in eid_lower:
            score += 20
        if "temp" in eid_lower:
            score += 5
        if "heat_pump" in eid_lower or "hp" in eid_lower or "ashp" in eid_lower:
            score += 10

    elif slot == "hp_flow_rate":
        if not eid.startswith("sensor."):
            return 0
        if "flow_rate" in eid_lower or "volumetric" in eid_lower:
            score += 25
        if "heat_pump" in eid_lower or "hp" in eid_lower or "ashp" in eid_lower:
            score += 10

    elif slot == "outdoor_temp":
        if eid.startswith("sensor."):
            if device_class == "temperature" or "\u00b0C" in attrs.get("unit_of_measurement", ""):
                score += 5
            if "outdoor" in eid_lower or "outside" in eid_lower or "external" in eid_lower:
                score += 25
        elif eid.startswith("weather."):
            score += 10
            if "home" in eid_lower:
                score += 5

    elif slot == "weather_forecast":
        if not eid.startswith("weather."):
            return 0
        score += 15
        if "home" in eid_lower:
            score += 10

    elif slot == "solar_production":
        if not eid.startswith("sensor."):
            return 0
        if "solar" in eid_lower or "pv" in eid_lower:
            score += 20
        if "production" in eid_lower or "power" in eid_lower:
            score += 10

    elif slot == "battery_soc":
        if not eid.startswith("sensor."):
            return 0
        if device_class == "battery":
            score += 10
        if "soc" in eid_lower or "state_of_charge" in eid_lower:
            score += 20
        elif "battery" in eid_lower:
            score += 10

    elif slot == "grid_power":
        if not eid.startswith("sensor."):
            return 0
        if device_class == "power":
            score += 10
        if "grid" in eid_lower:
            score += 20
        if "grid_power" in eid_lower or "import" in eid_lower:
            score += 10

    elif slot == "water_heater":
        if not eid.startswith("water_heater."):
            return 0
        score += 15
        if "heat_pump" in eid_lower or "cylinder" in eid_lower or "dhw" in eid_lower:
            score += 10

    elif slot == "hw_tank_top":
        if not eid.startswith("sensor."):
            return 0
        if device_class == "temperature":
            score += 5
        if "hot_water" in eid_lower or "tank" in eid_lower or "cylinder" in eid_lower:
            score += 15
        if "top" in eid_lower:
            score += 15

    elif slot == "hw_tank_bottom":
        if not eid.startswith("sensor."):
            return 0
        if device_class == "temperature":
            score += 5
        if "hot_water" in eid_lower or "tank" in eid_lower or "cylinder" in eid_lower:
            score += 15
        if "bottom" in eid_lower or "adc" in eid_lower:
            score += 15

    elif slot == "hw_schedule_entity":
        if not eid.startswith("binary_sensor."):
            return 0
        score += 5
        if "timeframe" in eid_lower or "hw" in eid_lower:
            score += 15
        if "hot_water" in eid_lower or "schedule" in eid_lower:
            score += 10

    return score


def _score_to_confidence(score: int) -> str:
    """Translate raw score to operator-facing confidence label.

    Thresholds are tied to _score_entity weighting (see lines 91-323 of this file).
    Expected score range per slot (empirically, as of 2026-04-14):
      - Perfect match (entity_id + friendly_name + device_class + unit all align): 30-55
      - Strong match (3 of 4 signals): 20-28
      - Weak match (1-2 signals): 8-15
      - Below threshold: 0 (filtered out in _scan_for_slot)
    If _score_entity scoring weights change, re-validate these thresholds
    against the new maximum possible score.
    """
    if score >= 25:
        return "high"
    if score >= 15:
        return "medium"
    return "low"


def _scan_for_slot(
    entities: List[Dict],
    slot: str,
    room: str = "",
    top_n: int = 5,
) -> List[Dict]:
    """Return top-N entity candidates for a config slot, ranked by score."""
    scored = []
    for entity in entities:
        s = _score_entity(entity, slot, room)
        if s > 0:
            eid = entity["entity_id"]
            attrs = entity.get("attributes", {})
            scored.append(
                {
                    "entity_id": eid,
                    "friendly_name": attrs.get("friendly_name", eid),
                    "score": s,
                    "confidence": _score_to_confidence(s),
                    "state": entity.get("state", "unknown"),
                    "device_class": attrs.get("device_class", ""),
                    "unit": attrs.get("unit_of_measurement", ""),
                }
            )
    # Deterministic ordering: primary by score DESC, secondary by entity_id ASC.
    # Secondary key breaks score ties stably across HA registry iteration order.
    scored.sort(key=lambda x: (-x["score"], x["entity_id"]))
    return scored[:top_n]


@router.post("/scan-entities")
def scan_entities(req: EntityScanRequest = EntityScanRequest()):
    """Scan HA for entity candidates matching QSH config slots."""
    from ..state import shared_state

    if not shared_state.is_ha_driver():
        raise HTTPException(status_code=501, detail="Entity scan requires HA driver")

    all_entities = _fetch_all_entities()
    if not all_entities:
        raise HTTPException(
            status_code=503,
            detail="Cannot reach HA API — check SUPERVISOR_TOKEN",
        )

    if req.domain_filter:
        allowed = set(req.domain_filter)
        all_entities = [
            e
            for e in all_entities
            if e.get("entity_id", "").split(".")[0] in allowed
        ]

    results = {
        "hp_flow_temp": _scan_for_slot(all_entities, "hp_flow_temp"),
        "hp_power": _scan_for_slot(all_entities, "hp_power"),
        "hp_cop": _scan_for_slot(all_entities, "hp_cop"),
        "hp_heat_output": _scan_for_slot(all_entities, "hp_heat_output"),
        "hp_total_energy": _scan_for_slot(all_entities, "hp_total_energy"),
        "hp_water_heater": _scan_for_slot(all_entities, "hp_water_heater"),
        "hp_return_temp": _scan_for_slot(all_entities, "hp_return_temp"),
        "hp_flow_rate": _scan_for_slot(all_entities, "hp_flow_rate"),
        "outdoor_temp": _scan_for_slot(all_entities, "outdoor_temp"),
        "weather_forecast": _scan_for_slot(all_entities, "weather_forecast"),
        "solar_production": _scan_for_slot(all_entities, "solar_production"),
        "battery_soc": _scan_for_slot(all_entities, "battery_soc"),
        "grid_power": _scan_for_slot(all_entities, "grid_power"),
        "water_heater": _scan_for_slot(all_entities, "water_heater"),
        "hw_tank_top": _scan_for_slot(all_entities, "hw_tank_top"),
        "hw_tank_bottom": _scan_for_slot(all_entities, "hw_tank_bottom"),
        "hw_schedule_entity": _scan_for_slot(all_entities, "hw_schedule_entity"),
    }

    return {"candidates": results, "total_entities": len(all_entities)}


@router.post("/scan-entities/{room}")
def scan_entities_for_room(room: str):
    """Scan HA entities for a specific room's config slots."""
    from ..state import shared_state

    if not shared_state.is_ha_driver():
        raise HTTPException(status_code=501, detail="Entity scan requires HA driver")

    all_entities = _fetch_all_entities()
    if not all_entities:
        raise HTTPException(status_code=503, detail="Cannot reach HA API")

    return {
        "room": room,
        "candidates": {
            "trv_entity": _scan_for_slot(all_entities, "trv_entity", room),
            "independent_sensor": _scan_for_slot(all_entities, "independent_sensor", room),
            "heating_entity": _scan_for_slot(all_entities, "heating_entity", room),
            "occupancy_sensor": _scan_for_slot(all_entities, "occupancy_sensor", room),
        },
    }


@router.post("/validate")
def validate_config(req: WizardValidateRequest):
    """Validate a partial or complete wizard config."""
    cfg = req.config
    errors = []
    warnings = []

    if req.step == "heat_source" or req.step is None:
        hs = cfg.get("heat_source", {})
        if not hs.get("type"):
            errors.append("heat_source.type is required")
        elif hs["type"] not in ("heat_pump", "gas_boiler", "oil_boiler"):
            errors.append(f"Invalid heat_source.type: {hs['type']}")

    if req.step == "rooms" or req.step is None:
        rooms = cfg.get("rooms", {})
        if not rooms:
            errors.append("At least one room is required")
        for name, rc in rooms.items():
            if not rc.get("area_m2"):
                errors.append(f"Room '{name}' missing area_m2")
            area = rc.get("area_m2", 0)
            if area and (area < 1 or area > 200):
                warnings.append(f"Room '{name}' area {area}m\u00b2 seems unusual")
            if cfg.get("driver") == "mqtt":
                mqtt_topics = rc.get("mqtt_topics", {})
                if not mqtt_topics.get("room_temp"):
                    errors.append(f"Room '{name}' missing mqtt_topics.room_temp")

    if req.step == "mqtt_broker" or (req.step is None and cfg.get("driver") == "mqtt"):
        mqtt_cfg = cfg.get("mqtt", {})
        broker = mqtt_cfg.get("broker", "")
        if not broker or not broker.strip():
            errors.append("MQTT broker address is required")
        port = mqtt_cfg.get("port", 1883)
        if port < 1 or port > 65535:
            errors.append(f"MQTT port must be in range [1, 65535], got {port}")

    if req.step == "sensors" or req.step is None:
        if cfg.get("driver") == "mqtt":
            mqtt_cfg = cfg.get("mqtt", {})
            inputs = mqtt_cfg.get("inputs", {})
            if not inputs.get("outdoor_temp"):
                warnings.append("No outdoor temperature topic — OAT will default to 5°C")
            if not inputs.get("hp_power"):
                warnings.append("No power sensor topic — observed_mode unavailable")
        else:
            hs = cfg.get("heat_source", {})
            sensors = hs.get("sensors", {})
            if not sensors.get("flow_temp"):
                warnings.append("No HP flow temp sensor — accuracy will be reduced")
            if not sensors.get("power_input"):
                warnings.append("No HP power sensor — COP monitoring unavailable")

    if req.step == "thermal" or req.step is None:
        thermal = cfg.get("thermal", {})
        peak = thermal.get("peak_loss_kw")
        if peak is not None:
            if peak < 0.5 or peak > 50:
                errors.append(f"peak_loss_kw={peak} outside valid range [0.5, 50.0]")

    if req.step == "energy" or req.step is None:
        energy_cfg = cfg.get("energy", {})
        if not energy_cfg.get("octopus") and not energy_cfg.get("fixed_rates"):
            warnings.append("No tariff configured — using fallback rates")

    if req.step == "hot_water" or req.step is None:
        hw_plan = cfg.get("hw_plan")
        if hw_plan and hw_plan not in ("W", "Y", "S", "S+", "C", "Combi"):
            errors.append(f"Invalid hw_plan: {hw_plan}")
        hw_tank = cfg.get("hw_tank", {})
        vol = hw_tank.get("volume_litres")
        if vol is not None and (vol < 10 or vol > 500):
            errors.append(f"hw_tank.volume_litres={vol} outside range [10, 500]")
        hw_pre = cfg.get("hw_precharge", {})
        factor = hw_pre.get("factor")
        if factor is not None and (factor < 0.0 or factor > 1.0):
            errors.append(f"hw_precharge.factor={factor} must be 0.0\u20131.0")

    if req.step == "telemetry_agreement" or req.step is None:
        telemetry = cfg.get("telemetry", {})
        agreed = telemetry.get("agreed")
        region = str(telemetry.get("region", "")).strip()
        if req.step == "telemetry_agreement":
            # Step-specific: user must have made an explicit choice
            if agreed is None:
                errors.append("Please make a selection for fleet data sharing")
            elif agreed and not region:
                errors.append("Please select or enter your region")
        elif req.step is None and agreed:
            # Full validation: if agreed, region must be present
            if not region:
                errors.append("Telemetry agreed but no region specified")

    if req.step == "disclaimer" or req.step is None:
        if req.step == "disclaimer":
            if not cfg.get("disclaimer_accepted"):
                errors.append("You must accept the disclaimer to proceed")
        elif req.step is None:
            # Full validation: disclaimer must be accepted
            if not cfg.get("disclaimer_accepted"):
                errors.append("Beta disclaimer must be accepted")

    if req.step is None:
        # Full validation — check cross-references
        rooms = cfg.get("rooms", {})
        persistent = cfg.get("thermal", {}).get("persistent_zones", [])
        for pz in persistent:
            if pz not in rooms:
                errors.append(f"Persistent zone '{pz}' is not a defined room")

        # Cross-reference checks for DHW
        hw_plan = cfg.get("hw_plan")
        hw_tank = cfg.get("hw_tank")
        if hw_plan in ("W", "Y", "S", "S+") and not hw_tank:
            warnings.append("Plumbing plan suggests a cylinder but hw_tank not configured")

        battery = cfg.get("battery", {})
        grid = cfg.get("grid", {})
        if battery.get("soc_entity") and not grid.get("power_entity"):
            warnings.append("Battery configured without grid power entity — grid-aware charging disabled")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


@router.post("/test-octopus")
def test_octopus(req: OctopusTestRequest):
    """Test Octopus Energy API connection."""
    api_key = req.api_key.strip()
    account = req.account_number.strip()

    if not api_key:
        return {"success": False, "message": "API key is empty"}
    if not account:
        return {"success": False, "message": "Account number is empty"}

    try:
        # Use REST API with Basic Auth (simpler & more reliable than GraphQL token exchange)
        url = f"https://api.octopus.energy/v1/accounts/{account}/"
        resp = requests.get(url, auth=(api_key, ""), timeout=15)

        if resp.status_code == 401:
            return {"success": False, "message": "Authentication failed: invalid API key"}
        if resp.status_code == 403:
            return {"success": False, "message": "Forbidden: API key cannot access this account"}
        if resp.status_code == 404:
            return {"success": False, "message": f"Account {account} not found"}
        if not resp.ok:
            return {"success": False, "message": f"API error: HTTP {resp.status_code}"}

        data = resp.json()

        # Parse properties → meter_points → agreements.
        # Import meter points have is_export == False (or absent).
        # Export meter points have is_export == True.
        # We want the IMPORT tariff, not Outgoing/export.
        # Collect all import candidates so we can detect and warn on multi-MPAN
        # setups (e.g., Economy 7 with separate day/night MPANs).
        import_tariffs: List[str] = []
        export_tariffs: List[str] = []
        for prop in data.get("properties", []):
            for mp in prop.get("electricity_meter_points", []):
                is_export = bool(mp.get("is_export", False))
                # Octopus API convention: agreements ordered chronologically, latest last.
                # If the API contract changes, this is the line to inspect.
                agreements = mp.get("agreements") or []
                if not agreements:
                    continue
                latest = agreements[-1]
                tariff_code = latest.get("tariff_code")
                if not tariff_code:
                    continue
                if is_export:
                    export_tariffs.append(tariff_code)
                else:
                    import_tariffs.append(tariff_code)

        account_number = data.get("number", account)
        export_tariff = export_tariffs[0] if export_tariffs else None

        if not import_tariffs:
            return {
                "success": False,
                "message": (
                    "No import tariff found on this Octopus account. "
                    "QSH optimises import cost — export-only accounts are not supported. "
                    "Add your import agreement in the Octopus dashboard and retry."
                ),
                "tariff_code": None,
                "export_tariff": export_tariff,
                "additional_import_tariffs": [],
                "account_number": account_number,
            }

        # Multi-import-meter-point case (Economy 7 day/night MPANs, dual-rate
        # installs). Take the first import tariff as the primary; surface the
        # rest so the operator can see the full picture.
        primary_import = import_tariffs[0]
        additional_imports = import_tariffs[1:]
        if additional_imports:
            logging.warning(
                "Octopus account %s has %d import meter points: %s. "
                "Using first (%s). Operator should verify in wizard review.",
                account_number, len(import_tariffs), import_tariffs, primary_import,
            )

        return {
            "success": True,
            "message": f"Connected. Import tariff: {primary_import}",
            "tariff_code": primary_import,
            "additional_import_tariffs": additional_imports,
            "export_tariff": export_tariff,
            "account_number": account_number,
        }
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {e}"}


# ── MQTT broker test and topic discovery ──────────────────────────────


class MqttTestRequest(BaseModel):
    broker: str
    port: int = 1883
    username: str = ""
    password: str = ""
    tls: bool = False
    client_id: str = "qsh-wizard"
    topic_prefix: str = ""


class MqttScanRequest(BaseModel):
    broker: str
    port: int = 1883
    username: str = ""
    password: str = ""
    tls: bool = False
    client_id: str = "qsh-wizard-scan"
    topic_prefix: str = ""
    filter_room: Optional[str] = None

    # New in INSTRUCTION-93B: bounded-window aggregation. Anything shorter than
    # 5 s reproduces the pre-93B pathology of missing delta publishers;
    # anything longer than 120 s blocks the wizard UI unacceptably.
    window_seconds: float = Field(default=30.0, ge=5.0, le=120.0)
    aggregate_json_fields: bool = True
    prefer_retained: bool = True


def _mqtt_connect_test(req: MqttTestRequest) -> dict:
    """Run MQTT connection test in a thread (blocking I/O)."""
    import threading
    paho = _paho_mqtt

    connected = threading.Event()
    result = {"success": False, "message": "Timeout"}

    def on_connect(client, userdata, flags, rc, properties=None):
        if rc == 0 or (hasattr(rc, 'value') and rc.value == 0):
            result["success"] = True
            result["message"] = "Connected successfully"
        else:
            result["success"] = False
            result["message"] = f"Connection refused (rc={rc})"
        connected.set()

    try:
        client = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=req.client_id)
        if req.username:
            client.username_pw_set(req.username, req.password)
        if req.tls:
            client.tls_set()
        client.on_connect = on_connect
        client.connect(req.broker, req.port, keepalive=10)
        client.loop_start()
        connected.wait(timeout=5.0)
        client.disconnect()
        client.loop_stop()
    except Exception as e:
        result = {"success": False, "message": str(e)}

    return result


# Keyword → QSH field mapping used by the wizard's broker-scan suggestion
# engine. Applied against both the topic path and per-JSON-key in the
# aggregated payload (INSTRUCTION-93B).
#
# Ordering matters: iteration stops at the first substring match, so the more
# specific compound keywords (flow_temp, outdoor, outside, …) must come before
# the generic ones (temp, temperature) to avoid "flow_temperature" being
# mis-mapped to outdoor_temp via the bare "temp" substring.
KEYWORD_SCORES = {
    "flow_temp": "hp_flow_temp", "flow": "hp_flow_temp",
    "return": "hp_return_temp",
    "cop": "hp_cop",
    "power": "hp_power", "watt": "hp_power",
    "valve": "valve_position",
    "outdoor": "outdoor_temp", "outside": "outdoor_temp",
    "temperature": "outdoor_temp", "temp": "outdoor_temp",
}


def _mqtt_scan_topics(req: MqttScanRequest) -> dict:
    """Subscribe to broker and aggregate per-topic state over a bounded window.

    Returns the result envelope directly ({"topics": [...], "scan_meta": {...}})
    so the route handler can forward it unchanged.
    """
    import threading
    paho = _paho_mqtt

    PAYLOAD_CAP = 20  # Sliding window: retain the latest N payloads per topic
                      # for field discovery. Finding #3: keep latest, not first,
                      # because late-arriving heartbeats carry full-state.
    state: Dict[str, Dict[str, Any]] = {}  # topic -> aggregation state
    connected = threading.Event()
    lock = threading.Lock()

    def on_connect(client, userdata, flags, rc, properties=None):
        prefix = req.topic_prefix
        sub_topic = f"{prefix}/#" if prefix else "#"
        client.subscribe(sub_topic, qos=0)
        connected.set()

    def on_message(client, userdata, msg):
        try:
            payload = msg.payload.decode("utf-8", errors="replace")
        except Exception:
            return
        is_retained = bool(getattr(msg, "retain", False))
        topic = msg.topic
        now = _time.time()
        with lock:
            entry = state.setdefault(topic, {
                "payloads": [],
                "retained_payload": None,
                "first_seen_ts": now,
                "last_seen_ts": now,
                "message_count": 0,
            })
            entry["payloads"].append(payload)
            # Finding #3: sliding window — keep the latest PAYLOAD_CAP payloads.
            # Field discovery benefits from late-arriving heartbeats, so we must
            # not discard them in favour of the earliest deltas.
            if len(entry["payloads"]) > PAYLOAD_CAP:
                entry["payloads"] = entry["payloads"][-PAYLOAD_CAP:]
            if is_retained and entry["retained_payload"] is None:
                entry["retained_payload"] = payload
            entry["last_seen_ts"] = now
            entry["message_count"] += 1

    started_at = _time.time()
    try:
        client = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=req.client_id)
        if req.username:
            client.username_pw_set(req.username, req.password)
        if req.tls:
            client.tls_set()
        client.on_connect = on_connect
        client.on_message = on_message
        client.connect(req.broker, req.port, keepalive=10)
        client.loop_start()
        if not connected.wait(timeout=5.0):
            client.loop_stop()
            return {"topics": [], "scan_meta": _scan_meta(started_at, 0, 0, req.window_seconds)}
        _time.sleep(req.window_seconds)
        client.disconnect()
        client.loop_stop()
    except Exception as exc:
        logger.warning("MQTT scan failed: %s", exc)
        return {"topics": [], "scan_meta": _scan_meta(started_at, 0, 0, req.window_seconds)}

    topics_out = _fold_scan_state(state, req)
    partial = sum(1 for t in topics_out if t["scan_completeness"] == "partial")
    return {
        "topics": topics_out,
        "scan_meta": _scan_meta(started_at, len(topics_out), partial, req.window_seconds),
    }


def _scan_meta(started_at: float, total: int, partial: int, window: float = 0.0) -> dict:
    """Build the scan_meta envelope returned alongside the topics list."""
    return {
        "started_at": started_at,
        "duration_s": _time.time() - started_at,
        "window_seconds": window,
        "total_topics": total,
        "partial_topics": partial,
    }


def _fold_scan_state(state: Dict[str, Dict[str, Any]], req: MqttScanRequest) -> List[dict]:
    """Fold per-topic aggregation state into the result rows."""
    import json

    results: List[dict] = []
    for topic, entry in state.items():
        if req.filter_room and req.filter_room.lower() not in topic.lower():
            continue
        if topic.startswith("$SYS"):
            continue

        payloads: List[str] = entry["payloads"]
        retained: Optional[str] = entry["retained_payload"]
        representative = retained if (req.prefer_retained and retained is not None) else payloads[-1]

        # JSON union across all captured payloads.
        # Finding #4: first-write-wins is correct for *field discovery* — the
        # union is illustrative of which keys the publisher emits, not
        # authoritative for the value on any given key. Consumers using the
        # aggregated payload for mapping purposes should look at the key set,
        # not the values.
        union_dict: Dict[str, Any] = {}
        any_json = False
        for p in payloads:
            try:
                parsed = json.loads(p)
            except (ValueError, TypeError):
                continue
            if not isinstance(parsed, dict):
                continue
            any_json = True
            for k, v in parsed.items():
                # Union semantics: first non-None wins. Later payloads do not
                # overwrite earlier keys, because we care about presence, not
                # the latest value (which is what `representative` already carries).
                if k not in union_dict and v is not None:
                    union_dict[k] = v
        aggregated_payload = json.dumps(union_dict) if (req.aggregate_json_fields and any_json) else None

        completeness = _classify_completeness(entry, payloads, any_json)

        is_numeric = False
        try:
            float(representative)
            is_numeric = True
        except (ValueError, TypeError):
            pass

        lower_topic = topic.lower()
        suggested = next((field for kw, field in KEYWORD_SCORES.items() if kw in lower_topic), None)

        suggested_fields_per_key: Optional[Dict[str, str]] = None
        if union_dict:
            suggested_fields_per_key = {}
            for key in union_dict.keys():
                for kw, field in KEYWORD_SCORES.items():
                    if kw in key.lower():
                        suggested_fields_per_key[key] = field
                        break
            if not suggested_fields_per_key:
                suggested_fields_per_key = None

        results.append({
            "topic": topic,
            "payload": representative[:200],
            "payloads_seen": entry["message_count"],
            "aggregated_payload": aggregated_payload,
            "retained": retained is not None,
            "scan_completeness": completeness,
            "is_numeric": is_numeric,
            "suggested_field": suggested,
            "suggested_fields_per_key": suggested_fields_per_key,
            "suggested_room": req.filter_room,
        })
    return results


def _classify_completeness(entry: Dict[str, Any], payloads: List[str], any_json: bool) -> str:
    """Classify a topic's scan result as retained | heartbeat | partial.

    - 'retained': publisher set retain=true on a full-state payload; we have a
      known-good snapshot regardless of window length.
    - 'heartbeat': no retained payload, but across captured messages we saw at
      least one payload whose JSON key set equals the union of all seen keys —
      i.e. a full-state heartbeat arrived inside the window.
    - 'partial': neither — operator may need to rescan with a longer window.
    """
    import json
    if entry["retained_payload"] is not None:
        return "retained"
    if not any_json:
        # Non-JSON (or single-message) topics are classified as 'heartbeat' when
        # at least one message was seen; there are no deltas to be partial over.
        return "heartbeat" if entry["message_count"] >= 1 else "partial"

    # Compute union key set.
    union_keys: set = set()
    per_message_keys: List[set] = []
    for p in payloads:
        try:
            parsed = json.loads(p)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            keys = set(parsed.keys())
            union_keys |= keys
            per_message_keys.append(keys)

    if not union_keys:
        return "partial"
    # Heartbeat iff any single message's key set equals the union.
    if any(mk == union_keys for mk in per_message_keys):
        return "heartbeat"
    return "partial"


@router.post("/test-mqtt")
async def test_mqtt_connection(req: MqttTestRequest):
    """Test MQTT broker connectivity."""
    import asyncio
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _mqtt_connect_test, req)
    return result


@router.post("/scan-mqtt-topics")
async def scan_mqtt_topics(req: MqttScanRequest):
    """Discover MQTT topics on broker with bounded-window field aggregation."""
    import asyncio
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _mqtt_scan_topics, req)
    return result  # {"topics": [...], "scan_meta": {...}}


@router.post("/deploy")
def deploy_config(req: WizardDeployRequest):
    """Write validated config to qsh.yaml and trigger pipeline restart."""
    # 1. Final validation
    validation = validate_config(
        WizardValidateRequest(config=req.config, step=None)
    )
    if not validation["valid"]:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Config validation failed",
                "errors": validation["errors"],
            },
        )

    # ── Telemetry: generate install_id before writing YAML (H1/H2 resolution) ──
    telemetry_cfg = req.config.get("telemetry", {})
    if telemetry_cfg.get("agreed") and not telemetry_cfg.get("install_id"):
        import uuid as _uuid
        telemetry_cfg["install_id"] = str(_uuid.uuid4())
        req.config["telemetry"] = telemetry_cfg
        logger.info("Wizard: generated install_id %s", telemetry_cfg["install_id"])

    # 2. Write YAML
    yaml_content = yaml.dump(
        req.config,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )

    header = (
        "# QSH Configuration — generated by Setup Wizard\n"
        "# Managed by QSH Web UI — manual edits will be overwritten on next save.\n\n"
    )

    try:
        os.makedirs(os.path.dirname(YAML_PATH), exist_ok=True)
        with open(YAML_PATH, "w") as f:
            f.write(header + yaml_content)
        logger.info("Wizard: wrote config to %s", YAML_PATH)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")

    # ── Telemetry registration (best-effort, single write-back for api_token) ──
    if telemetry_cfg.get("agreed"):
        install_id = telemetry_cfg["install_id"]
        region = telemetry_cfg.get("region", "")
        try:
            endpoint = telemetry_cfg.get("endpoint", DEFAULT_ENDPOINT)
            transport = CloudFlareTransport(endpoint)
            api_token = transport.register(install_id, region)

            if api_token:
                # Single read-modify-write for api_token only
                try:
                    with open(YAML_PATH, "r") as f:
                        written_config = yaml.safe_load(f) or {}
                    written_config.setdefault("telemetry", {})["api_token"] = api_token
                    yaml_out = yaml.dump(written_config, default_flow_style=False,
                                          allow_unicode=True, sort_keys=False)
                    with open(YAML_PATH, "w") as f:
                        f.write(header + yaml_out)
                    logger.info("Wizard: telemetry registered (token received)")
                except Exception as e:
                    logger.warning("Wizard: failed to write api_token: %s", e)
        except Exception as e:
            # Registration failure is non-fatal — will retry on startup
            logger.warning("Wizard: telemetry registration failed: %s — will retry on startup", e)

    # 3. Signal restart and force process exit
    #    In normal operation the main loop picks up the restart flag within 30s.
    #    In setup mode (first boot, no prior config) the main thread is blocked
    #    on api_thread.join() with no cycle loop, so the flag is never checked.
    #    Schedule a deferred os._exit(0) to guarantee the process exits and the
    #    HA supervisor restarts it with the new config. The short delay ensures
    #    the HTTP response reaches the client before the process dies.
    restart_flag = "/config/qsh_restart_requested"
    try:
        with open(restart_flag, "w") as f:
            f.write("1")
    except OSError:
        pass

    def _deferred_exit():
        import time
        time.sleep(1)  # Let the HTTP 200 response flush to the client
        logger.info("Wizard deploy: forcing process exit for restart")
        os._exit(0)

    import threading
    threading.Thread(target=_deferred_exit, name="wizard-restart", daemon=True).start()

    return {
        "deployed": True,
        "yaml_path": YAML_PATH,
        "message": "Configuration saved. Pipeline restarting...",
        "warnings": validation.get("warnings", []),
    }
