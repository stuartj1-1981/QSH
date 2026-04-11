"""
QSH Dashboard Generator

Auto-generates a fully populated HA Lovelace dashboard from HOUSE_CONFIG.
No manual editing required  -  every entity is resolved from the tester's qsh.yaml.

Primary delivery: push_dashboard() creates/updates a storage-mode dashboard
via the HA API. Dashboard appears in the sidebar automatically.

Fallback: write_dashboard() writes YAML to disk for manual import.

Usage:
    from .dashboard import push_dashboard, write_dashboard
    push_dashboard(HOUSE_CONFIG)  # API push (preferred)
    write_dashboard(HOUSE_CONFIG)  # File fallback
"""

import json
import logging
import os
import yaml
from typing import Dict, List, Optional

from ...utils import slugify


# HA Supervisor API
HA_URL = "http://supervisor/core"
TOKEN = os.getenv("SUPERVISOR_TOKEN")
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"} if TOKEN else None
TIMEOUT = 15

# Dashboard identity
DASHBOARD_URL_PATH = "qsh-dashboard"
DASHBOARD_TITLE = "QSH"
DASHBOARD_ICON = "mdi:home-thermometer"

DASHBOARD_OUTPUT_PATHS = [
    "/addon_configs/local_quantum_swarm_heating/qsh_dashboard.yaml",
    "/config/qsh/qsh_dashboard.yaml",
]


# =============================================================================
# API DASHBOARD PUSH (Primary method)
# =============================================================================


def push_dashboard(config: Dict) -> bool:
    """
    Push dashboard to HA via WebSocket API (storage mode).

    Creates the dashboard if it doesn't exist, then saves the config.
    Dashboard appears in the sidebar automatically. No manual steps.

    Falls back to write_dashboard() on failure.

    Returns True if successfully pushed via API.
    """
    if not TOKEN:
        logging.warning("Dashboard: No SUPERVISOR_TOKEN - falling back to file")
        write_dashboard(config)
        return False

    lovelace_config = _generate_lovelace_config(config)

    if _ws_push_dashboard(lovelace_config):
        logging.info("Dashboard: live in HA sidebar")
        return True

    # API failed - fall back to file
    logging.warning("Dashboard: API push failed - falling back to file write")
    write_dashboard(config)
    return False


def _generate_lovelace_config(config: Dict) -> dict:
    """
    Generate Lovelace config as a dict for the API.

    Returns dict with 'views' key, ready for lovelace/config/save.
    """
    views = [
        _view_home(config),
        _view_rooms(config),
        _view_schedule(config),
        _view_away(config),
        _view_engineering(config),
        _view_energy(config),
    ]
    if config.get("rooms"):
        views.append(_view_balancing(config))
    return {"views": views}


def _ws_push_dashboard(lovelace_config: dict) -> bool:
    """
    Create (if needed) and save dashboard config via WebSocket API.

    Single WebSocket session handles: list → create → save.
    """
    try:
        import websocket
    except ImportError:
        logging.warning(
            "Dashboard: websocket-client not installed - "
            "cannot push dashboard via API. "
            "Run: pip install websocket-client"
        )
        return False

    ws_url = "ws://supervisor/core/websocket"
    ws = None
    msg_id = 0

    def next_id():
        nonlocal msg_id
        msg_id += 1
        return msg_id

    def ws_call(ws, payload):
        """Send a WS command and return the response."""
        ws.send(json.dumps(payload))
        return json.loads(ws.recv())

    try:
        ws = websocket.create_connection(ws_url, timeout=TIMEOUT)

        # Step 1: Receive auth_required
        msg = json.loads(ws.recv())
        if msg.get("type") != "auth_required":
            logging.warning(f"Dashboard WS: unexpected message: {msg.get('type')}")
            return False

        # Step 2: Authenticate
        ws.send(
            json.dumps(
                {
                    "type": "auth",
                    "access_token": TOKEN,
                }
            )
        )
        msg = json.loads(ws.recv())
        if msg.get("type") != "auth_ok":
            logging.warning(f"Dashboard WS: auth failed: {msg}")
            return False

        logging.debug("Dashboard WS: authenticated")

        # Step 3: Check if dashboard exists
        msg = ws_call(
            ws,
            {
                "id": next_id(),
                "type": "lovelace/dashboards/list",
            },
        )
        dashboard_exists = False
        if msg.get("success"):
            existing = [d.get("url_path") for d in (msg.get("result") or [])]
            dashboard_exists = DASHBOARD_URL_PATH in existing

        # Step 4: Create dashboard if needed
        if not dashboard_exists:
            msg = ws_call(
                ws,
                {
                    "id": next_id(),
                    "type": "lovelace/dashboards/create",
                    "url_path": DASHBOARD_URL_PATH,
                    "title": DASHBOARD_TITLE,
                    "icon": DASHBOARD_ICON,
                    "show_in_sidebar": True,
                },
            )
            if msg.get("success"):
                logging.info(f"Dashboard: created '{DASHBOARD_URL_PATH}'")
            else:
                logging.warning(f"Dashboard WS: create failed: {msg}")
                return False
        else:
            logging.debug("Dashboard: already exists")

        # Step 5: Save config
        msg = ws_call(
            ws,
            {
                "id": next_id(),
                "type": "lovelace/config/save",
                "url_path": DASHBOARD_URL_PATH,
                "config": lovelace_config,
            },
        )
        if msg.get("success"):
            logging.info("Dashboard: config saved via WebSocket")
            return True
        else:
            logging.warning(f"Dashboard WS: config save failed: {msg}")
            return False

    except Exception as e:
        logging.warning(f"Dashboard WS: error: {e}")
        return False
    finally:
        if ws:
            try:
                ws.close()
            except Exception:
                pass


def generate_dashboard(config: Dict) -> str:
    """
    Generate full Lovelace YAML from HOUSE_CONFIG.

    Returns YAML with all views, ready for HA Raw Configuration Editor.
    """
    lovelace_config = _generate_lovelace_config(config)
    return yaml.dump(lovelace_config, default_flow_style=False, sort_keys=False, allow_unicode=True)


def write_dashboard(config: Dict) -> Optional[str]:
    """Generate and write dashboard YAML to disk (fallback method)."""
    # Write full dashboard format with views: wrapper for YAML-mode compatibility
    lovelace_config = _generate_lovelace_config(config)
    yaml_str = yaml.dump(lovelace_config, default_flow_style=False, sort_keys=False, allow_unicode=True)

    for path in DASHBOARD_OUTPUT_PATHS:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(_HEADER_COMMENT)
                f.write(yaml_str)
            logging.info(f"Dashboard written to: {path}")
            return path
        except (OSError, PermissionError) as e:
            logging.debug(f"Cannot write dashboard to {path}: {e}")
            continue

    logging.warning("Could not write dashboard file.")
    return None


_HEADER_COMMENT = """\
# =============================================================================
# QSH Dashboard  -  Auto-generated from your qsh.yaml
# =============================================================================
# To install:
#   1. Settings -> Dashboards -> Add Dashboard (name: "QSH")
#   2. Open it -> pencil icon -> (TM) menu -> Raw Configuration Editor
#   3. Ctrl+A (select all) -> Paste this entire file -> Save
#
# Re-generated each time QSH starts. Manual edits will be overwritten.
# =============================================================================

"""


# =============================================================================
# Constants used by views
# =============================================================================


_PAUSE_STATES = (
    "HW Active", "HW Pre-Charge", "HW Recovery",
    "Defrost", "Oil Recovery", "Short Cycle Pause",
)
# Jinja template: prominent banner when pipeline is paused, empty otherwise
_PAUSE_BANNER_TEMPLATE = (
    "{%- set state = states('input_text.qsh_operating_state') -%}"
    "{%- set paused = ["
    + ",".join(f"'{s}'" for s in _PAUSE_STATES)
    + "] -%}"
    "{%- if state in paused -%}"
    "### ⚠️ Pipeline Paused: {{ state }}"
    "{%- endif -%}"
)


# =============================================================================
# VIEW: Home
# =============================================================================


def _view_home(config: Dict) -> dict:
    """Home view — system overview with status, room mini-cards, and today summary."""
    entities = config.get("entities", {})
    rooms = config.get("rooms", {})
    zone_sensor_map = config.get("zone_sensor_map", {})
    cards: List[Dict] = []

    # 1. Pause banner
    cards.append({"type": "markdown", "content": _PAUSE_BANNER_TEMPLATE})

    # 2. Status card
    status_entities: List[Dict] = [
        {
            "entity": "input_text.qsh_operating_state",
            "name": "Operating State",
            "icon": "mdi:information-outline",
        },
        {"entity": "input_select.qsh_shadow_mode", "name": "HP Command"},
    ]
    cards.append({
        "type": "entities",
        "show_header_toggle": False,
        "entities": status_entities,
    })
    # Conditional: QSH Recommendation when control is off
    cards.append({
        "type": "conditional",
        "conditions": [{"entity": "input_boolean.dfan_control", "state": "off"}],
        "card": {
            "type": "entities",
            "show_header_toggle": False,
            "entities": [{
                "entity": "input_select.qsh_optimal_mode",
                "name": "QSH Recommendation",
                "icon": "mdi:lightbulb-on-outline",
            }],
        },
    })

    # 3. Quick stats — glance card
    glance_entities: List[Dict] = [
        {"entity": "input_number.qsh_shadow_flow", "name": "Flow"},
    ]
    if entities.get("outdoor_temp"):
        glance_entities.append({"entity": entities["outdoor_temp"], "name": "Outdoor"})
    if entities.get("hp_energy_rate"):
        glance_entities.append({"entity": entities["hp_energy_rate"], "name": "Power"})
    if entities.get("hp_cop"):
        glance_entities.append({"entity": entities["hp_cop"], "name": "COP"})
    cards.append({"type": "glance", "entities": glance_entities})

    # 4. Control
    cards.append({
        "type": "entities",
        "title": "Control",
        "show_header_toggle": False,
        "entities": [
            {"entity": "input_boolean.dfan_control", "name": "Active Control", "icon": "mdi:radiator"},
            {"entity": "input_number.flow_min_temperature", "name": "Flow Min"},
            {"entity": "input_number.flow_max_temperature", "name": "Flow Max"},
        ],
    })

    # 5. System health — gauge for HP output if configured
    hp_output = entities.get("hp_output")
    if hp_output:
        cards.append({
            "type": "gauge",
            "entity": hp_output,
            "name": "System Capacity",
        })

    # 6. Room mini-cards — grid of markdown cards with Jinja
    if rooms:
        room_cards: List[Dict] = []
        for room in rooms:
            slug = slugify(room)
            pretty = room.replace("_", " ").title()

            # Resolve temperature entity
            sensor_key = zone_sensor_map.get(room)
            if sensor_key and entities.get(sensor_key):
                temp_line = f"🌡️ {{{{ states('{entities[sensor_key]}') }}}}°C / {{{{ states('input_number.qsh_shadow_{slug}_setpoint') }}}}°C"
            elif entities.get(f"{room}_temp_set_hum"):
                trv_ent = entities[f"{room}_temp_set_hum"]
                if isinstance(trv_ent, list):
                    trv_ent = trv_ent[0]
                temp_line = f"🌡️ {{{{ state_attr('{trv_ent}', 'current_temperature') }}}}°C / {{{{ states('input_number.qsh_shadow_{slug}_setpoint') }}}}°C"
            else:
                temp_line = f"🌡️ — / {{{{ states('input_number.qsh_shadow_{slug}_setpoint') }}}}°C"

            # Valve line (optional)
            valve_entity = entities.get(f"{room}_heating")
            if valve_entity:
                extra_line = f"\nValve: {{{{ states('{valve_entity}') }}}}% · {{{{ states('input_text.qsh_occupancy_{slug}') }}}}"
            else:
                extra_line = f"\n{{{{ states('input_text.qsh_occupancy_{slug}') }}}}"

            content = f"**{pretty}**\n{temp_line}{extra_line}"
            room_cards.append({"type": "markdown", "content": content})

        cards.append({"type": "grid", "columns": 3, "cards": room_cards})

    # 7. Today summary — grid of markdown cards
    summary_cards: List[Dict] = [
        {"type": "markdown", "content": "💰 {{ states('input_number.qsh_hp_cost_today_p') | round(0) }}p"},
        {"type": "markdown", "content": "⚡ {{ states('input_number.qsh_hp_energy_today') | round(1) }} kWh"},
    ]
    if entities.get("predicted_saving") or True:
        # input_number.qsh_predicted_saving is a core entity, always present
        summary_cards.append({"type": "markdown", "content": "📉 {{ states('input_number.qsh_predicted_saving') | round(0) }}p"})
    summary_cards.append({"type": "markdown", "content": "📊 {{ states('input_number.qsh_hp_cost_yesterday') | round(0) }}p"})
    cards.append({"type": "grid", "columns": 3, "cards": summary_cards})

    # 8. Away toggle
    cards.append({
        "type": "entities",
        "show_header_toggle": False,
        "entities": [
            {"entity": "input_boolean.qsh_away_mode", "name": "Away Mode", "icon": "mdi:home-export-outline"},
        ],
    })

    return {"title": "QSH", "path": "qsh", "icon": "mdi:home-thermometer", "cards": cards}


# =============================================================================
# VIEW: Rooms
# =============================================================================


def _view_rooms(config: Dict) -> dict:
    """Rooms view — per-room entities, temperature history, SysID table."""
    rooms = config.get("rooms", {})
    entities = config.get("entities", {})
    zone_sensor_map = config.get("zone_sensor_map", {})
    cards: List[Dict] = []

    # 1. Room grid — each room is a vertical-stack with entities + optional history
    if rooms:
        room_stacks: List[Dict] = []
        for room in rooms:
            slug = slugify(room)
            pretty = room.replace("_", " ").title()
            room_entities: List[Dict] = []

            # Temperature sensor
            sensor_key = zone_sensor_map.get(room)
            has_independent_sensor = bool(sensor_key and entities.get(sensor_key))
            if has_independent_sensor:
                room_entities.append({
                    "entity": entities[sensor_key],
                    "name": "Temperature",
                })
            elif entities.get(f"{room}_temp_set_hum"):
                trv_ent = entities[f"{room}_temp_set_hum"]
                if isinstance(trv_ent, list):
                    trv_ent = trv_ent[0]
                room_entities.append({
                    "entity": trv_ent,
                    "name": "Temperature",
                    "attribute": "current_temperature",
                })

            # Setpoint
            room_entities.append({
                "entity": f"input_number.qsh_shadow_{slug}_setpoint",
                "name": "Setpoint",
            })

            # Valve (optional)
            valve_entity = entities.get(f"{room}_heating")
            if valve_entity:
                room_entities.append({
                    "entity": valve_entity,
                    "name": "Valve",
                })

            # Occupancy
            room_entities.append({
                "entity": f"input_text.qsh_occupancy_{slug}",
                "name": "Occupancy",
            })

            stack_cards: List[Dict] = [{
                "type": "entities",
                "title": pretty,
                "show_header_toggle": False,
                "entities": room_entities,
            }]

            # Per-room temp history (independent sensors only)
            if has_independent_sensor:
                stack_cards.append({
                    "type": "history-graph",
                    "title": f"{pretty} (24h)",
                    "hours_to_show": 24,
                    "entities": [{"entity": entities[sensor_key], "name": pretty}],
                })

            room_stacks.append({"type": "vertical-stack", "cards": stack_cards})

        cards.append({"type": "grid", "columns": 3, "cards": room_stacks})

    # 2. Multi-room temperature overlay (independent sensors only)
    overlay_entities: List[Dict] = []
    for room in rooms:
        sensor_key = zone_sensor_map.get(room)
        if sensor_key and entities.get(sensor_key):
            overlay_entities.append({
                "entity": entities[sensor_key],
                "name": room.replace("_", " ").title(),
            })
    if overlay_entities:
        cards.append({
            "type": "history-graph",
            "title": "Room Temperatures (24h)",
            "hours_to_show": 24,
            "entities": overlay_entities,
        })

    # 3. SysID table
    cards.append({
        "type": "markdown",
        "title": "SysID Per-Room Detail",
        "content": (
            "Room | Status\n"
            ":-- | :--\n"
            "{% set map = {'M':'Mature','L':'Learning','P':'Prior'} %}"
            "{% for item in states('input_text.qsh_sysid_detail').split(',') %}"
            "{% set p = item.split(':') %}"
            "{{ p[0] }} | {{ map[p[1]] }}\n"
            "{% endfor %}"
        ),
    })

    return {"title": "Rooms", "path": "qsh-rooms", "icon": "mdi:floor-plan", "cards": cards}


# =============================================================================
# VIEW: Schedule
# =============================================================================


def _view_schedule(config: Dict) -> dict:
    """Schedule view — flow limits + per-room occupancy schedule and zone away."""
    rooms = config.get("rooms", {})
    cards: List[Dict] = []

    # 1. Flow limits header
    cards.append({
        "type": "entities",
        "title": "Flow Limits",
        "show_header_toggle": False,
        "entities": [
            {"entity": "input_number.flow_min_temperature", "name": "Flow Min"},
            {"entity": "input_number.flow_max_temperature", "name": "Flow Max"},
        ],
    })

    # 2. Per-room schedule cards
    for room in rooms:
        slug = slugify(room)
        pretty = room.replace("_", " ").title()
        schedule_entity_id = f"schedule.qsh_occupancy_{slug}"

        schedule_info = (
            f"{{% set s = states('{schedule_entity_id}') %}}"
            f"{{% if s in ['unknown', 'unavailable'] %}}"
            f"**Schedule entity not found.** "
            f"Go to HA Settings → Helpers → Create Helper → Schedule, "
            f"name it `qsh_occupancy_{slug}`, then restart QSH."
            f"{{% else %}}"
            f"{{% set ne = state_attr('{schedule_entity_id}', 'next_event') %}}"
            f"Schedule: **{{{{ 'Occupied' if s == 'on' else 'Unoccupied' }}}}**"
            f"{{% if ne %}} · Next change: {{{{ as_timestamp(ne) | timestamp_custom('%a %H:%M') }}}}{{% endif %}}"
            f"\n\n*Tap the schedule below to view and edit occupied time blocks.*"
            f"{{% endif %}}"
        )

        zone_cards: List[Dict] = [
            {"type": "markdown", "content": f"### {pretty}"},
            {
                "type": "entities",
                "show_header_toggle": False,
                "entities": [{
                    "entity": f"input_boolean.qsh_occupancy_{slug}_enabled",
                    "name": "Occupancy Control",
                    "icon": "mdi:toggle-switch",
                }],
            },
            {"type": "markdown", "content": schedule_info},
            {
                "type": "entities",
                "show_header_toggle": False,
                "entities": [{
                    "entity": schedule_entity_id,
                    "name": "Edit Occupancy Schedule",
                    "icon": "mdi:calendar-edit",
                    "tap_action": {"action": "more-info"},
                }],
            },
            {
                "type": "entities",
                "show_header_toggle": False,
                "entities": [
                    {
                        "entity": f"input_boolean.qsh_{slug}_away",
                        "name": "Zone Away",
                        "icon": "mdi:door-closed-lock",
                    },
                    {
                        "entity": f"input_number.qsh_{slug}_away_days",
                        "name": "Days (0 = indefinite)",
                        "icon": "mdi:calendar-clock",
                    },
                ],
            },
        ]
        cards.append({"type": "vertical-stack", "cards": zone_cards})

    return {"title": "Schedule", "path": "qsh-schedule", "icon": "mdi:calendar-clock", "cards": cards}


# =============================================================================
# VIEW: Away
# =============================================================================


def _view_away(config: Dict) -> dict:
    """Away view — whole-house away, zone status table, per-zone controls, occupancy timeline."""
    rooms = config.get("rooms", {})
    cards: List[Dict] = []

    # 1. Whole-house away controls
    cards.append({
        "type": "entities",
        "title": "Away Mode",
        "show_header_toggle": False,
        "entities": [
            {"entity": "input_boolean.qsh_away_mode", "name": "Away Mode", "icon": "mdi:home-export-outline"},
            {"entity": "input_number.qsh_days_away", "name": "Days Away", "icon": "mdi:calendar-clock"},
            {"entity": "input_text.qsh_away_status", "name": "Status", "icon": "mdi:information-outline"},
        ],
    })

    # 2. Zone status table
    if rooms:
        rows = []
        for room in rooms:
            slug = slugify(room)
            pretty = room.replace("_", " ").title()
            rows.append(
                f"| {pretty} "
                f"| {{{{ states('input_text.qsh_occupancy_{slug}') }}}} "
                f"| {{{{ states('input_number.qsh_shadow_{slug}_setpoint') }}}}°C "
                f"| {{% if states('input_number.qsh_away_depth_{slug}') | float > 0 %}}"
                f"{{{{ states('input_number.qsh_away_depth_{slug}') }}}}°C"
                f"{{% else %}}—{{% endif %}} |"
            )
        table_content = (
            "## Zone Status\n\n"
            "| Room | State | Target | Setback |\n"
            "| :-- | :-- | :-- | :-- |\n"
            + "\n".join(rows)
        )
        cards.append({"type": "markdown", "content": table_content})

    # 3. Per-zone controls
    for room in rooms:
        slug = slugify(room)
        pretty = room.replace("_", " ").title()
        cards.append({
            "type": "entities",
            "title": pretty,
            "show_header_toggle": False,
            "entities": [
                {"entity": f"input_boolean.qsh_{slug}_away", "name": f"{pretty} Zone Away"},
                {"entity": f"input_number.qsh_{slug}_away_days", "name": "Days"},
            ],
        })

    # 4. Occupancy timeline
    if rooms:
        history_entities: List[Dict] = []
        for room in rooms:
            slug = slugify(room)
            history_entities.append({
                "entity": f"input_text.qsh_occupancy_{slug}",
                "name": room.replace("_", " ").title(),
            })
        cards.append({
            "type": "history-graph",
            "title": "Occupancy Timeline (24h)",
            "hours_to_show": 24,
            "entities": history_entities,
        })

    return {"title": "Away", "path": "qsh-away", "icon": "mdi:airplane", "cards": cards}


# =============================================================================
# VIEW: Engineering
# =============================================================================


def _view_engineering(config: Dict) -> dict:
    """Engineering view — pipeline state, hardware, SysID, RL metrics and trends."""
    entities = config.get("entities", {})
    cards: List[Dict] = []

    # 1. Pipeline state
    cards.append({
        "type": "entities",
        "title": "Pipeline State",
        "show_header_toggle": False,
        "entities": [
            {"entity": "input_text.qsh_operating_state", "name": "Operating State", "icon": "mdi:information-outline"},
            {"entity": "input_select.qsh_shadow_mode", "name": "HP Command"},
            {"entity": "input_select.qsh_optimal_mode", "name": "QSH Recommendation"},
            {"entity": "input_number.qsh_shadow_flow", "name": "Applied Flow"},
            {"entity": "input_number.qsh_det_flow", "name": "Deterministic Flow"},
            {"entity": "input_number.qsh_rl_proposed_flow", "name": "RL Proposed Flow"},
            {"entity": "input_number.qsh_rl_blend", "name": "Blend Factor", "secondary_info": "last-updated"},
            {"entity": "input_number.qsh_total_demand", "name": "Total Demand"},
        ],
    })

    # 2. Hardware sensors (conditional)
    hp_sensors: List[Dict] = []
    sensor_labels = {
        "hp_flow_temp": ("Flow Temperature", "mdi:water-thermometer"),
        "hp_energy_rate": ("Power Input", "mdi:flash"),
        "hp_output": ("Heat Output", "mdi:fire"),
        "hp_cop": ("COP", "mdi:speedometer"),
        "primary_diff": ("Delta T", "mdi:thermometer-lines"),
    }
    for key, (label, icon) in sensor_labels.items():
        if entities.get(key):
            hp_sensors.append({"entity": entities[key], "name": label, "icon": icon})
    if hp_sensors:
        cards.append({
            "type": "entities",
            "title": "Heat Pump Sensors",
            "show_header_toggle": False,
            "entities": hp_sensors,
        })

    # 3. Outdoor conditions (conditional)
    outdoor_entities: List[Dict] = []
    if entities.get("outdoor_temp"):
        outdoor_entities.append({"entity": entities["outdoor_temp"], "name": "Outdoor Temperature"})
    if entities.get("forecast_weather"):
        outdoor_entities.append({"entity": entities["forecast_weather"], "name": "Weather Forecast"})
    if outdoor_entities:
        cards.append({
            "type": "entities",
            "title": "Outdoor",
            "show_header_toggle": False,
            "entities": outdoor_entities,
        })

    # 4. SysID learning
    cards.append({
        "type": "entities",
        "show_header_toggle": False,
        "entities": [{"entity": "input_text.qsh_sysid_phase", "name": "SysID Learning", "icon": "mdi:school"}],
    })
    cards.append({
        "type": "markdown",
        "title": "SysID Per-Room Detail",
        "content": (
            "Room | Status\n"
            ":-- | :--\n"
            "{% set map = {'M':'Mature','L':'Learning','P':'Prior'} %}"
            "{% for item in states('input_text.qsh_sysid_detail').split(',') %}"
            "{% set p = item.split(':') %}"
            "{{ p[0] }} | {{ map[p[1]] }}\n"
            "{% endfor %}"
        ),
    })

    # 5. RL metrics
    cards.append({
        "type": "entities",
        "title": "RL Engine",
        "show_header_toggle": False,
        "entities": [
            {"entity": "input_number.qsh_rl_reward", "name": "Current Reward"},
            {"entity": "input_number.qsh_rl_loss", "name": "Training Loss"},
            {"entity": "input_number.qsh_rl_blend", "name": "Blend Factor", "secondary_info": "last-updated"},
        ],
    })

    # 6. RL trend graphs
    cards.append({
        "type": "history-graph",
        "title": "Reward Trend (48h)",
        "hours_to_show": 48,
        "entities": [{"entity": "input_number.qsh_rl_reward", "name": "Reward"}],
    })
    cards.append({
        "type": "history-graph",
        "title": "Training Loss (48h)",
        "hours_to_show": 48,
        "entities": [{"entity": "input_number.qsh_rl_loss", "name": "Loss"}],
    })
    cards.append({
        "type": "history-graph",
        "title": "Blend Factor (7d)",
        "hours_to_show": 168,
        "entities": [{"entity": "input_number.qsh_rl_blend", "name": "RL Blend"}],
    })
    cards.append({
        "type": "history-graph",
        "title": "Flow Comparison (48h)",
        "hours_to_show": 48,
        "entities": [
            {"entity": "input_number.qsh_shadow_flow", "name": "Actual"},
            {"entity": "input_number.qsh_det_flow", "name": "Deterministic"},
            {"entity": "input_number.qsh_rl_proposed_flow", "name": "RL Proposed"},
        ],
    })

    return {"title": "Engineering", "path": "qsh-engineering", "icon": "mdi:cog", "cards": cards}


# =============================================================================
# VIEW: Energy
# =============================================================================


def _view_energy(config: Dict) -> dict:
    """Energy view — cost summary, trends, HP power, COP, delta-T, solar."""
    entities = config.get("entities", {})
    cards: List[Dict] = []

    # 1. Cost summary
    cards.append({
        "type": "entities",
        "title": "Cost & Energy",
        "show_header_toggle": False,
        "entities": [
            {"entity": "input_number.qsh_hp_cost_today_p", "name": "HP Cost Today", "icon": "mdi:currency-gbp"},
            {"entity": "input_number.qsh_hp_energy_today", "name": "HP Energy Today", "icon": "mdi:flash"},
            {"entity": "input_number.qsh_predicted_saving", "name": "Predicted Saving", "icon": "mdi:piggy-bank"},
            {"entity": "input_number.qsh_predicted_energy_saving", "name": "Energy Saving", "icon": "mdi:leaf"},
            {"entity": "input_number.qsh_hp_cost_yesterday", "name": "Cost Yesterday", "icon": "mdi:calendar-yesterday"},
        ],
    })

    # 2. Cost trend
    cards.append({
        "type": "history-graph",
        "title": "Daily HP Cost (7d)",
        "hours_to_show": 168,
        "entities": [{"entity": "input_number.qsh_hp_cost_today_p", "name": "Cost (p)"}],
    })

    # 3. Saving trend
    cards.append({
        "type": "history-graph",
        "title": "Predicted Saving (7d)",
        "hours_to_show": 168,
        "entities": [{"entity": "input_number.qsh_predicted_saving", "name": "Saving (p)"}],
    })

    # 4. HP Power (conditional)
    if entities.get("hp_energy_rate"):
        cards.append({
            "type": "history-graph",
            "title": "HP Power (24h)",
            "hours_to_show": 24,
            "entities": [{"entity": entities["hp_energy_rate"], "name": "Power Input"}],
        })

    # 5. COP (conditional)
    if entities.get("hp_cop"):
        cards.append({
            "type": "history-graph",
            "title": "COP (24h)",
            "hours_to_show": 24,
            "entities": [{"entity": entities["hp_cop"], "name": "COP"}],
        })

    # 6. Delta T (conditional)
    if entities.get("primary_diff"):
        cards.append({
            "type": "history-graph",
            "title": "Delta T (24h)",
            "hours_to_show": 24,
            "entities": [{"entity": entities["primary_diff"], "name": "Delta T"}],
        })

    # 7. Solar & Battery (conditional — omit if none configured)
    infra_entities: List[Dict] = []
    if entities.get("solar_production"):
        infra_entities.append({"entity": entities["solar_production"], "name": "Solar Production"})
    if entities.get("battery_soc"):
        infra_entities.append({"entity": entities["battery_soc"], "name": "Battery SOC"})
    if entities.get("grid_power"):
        infra_entities.append({"entity": entities["grid_power"], "name": "Grid Power"})
    if infra_entities:
        cards.append({
            "type": "entities",
            "title": "Solar & Battery",
            "show_header_toggle": False,
            "entities": infra_entities,
        })

    return {"title": "Energy", "path": "qsh-energy", "icon": "mdi:flash", "cards": cards}


# =============================================================================
# VIEW: Balancing
# =============================================================================


def _view_balancing(config: Dict) -> dict:
    """Balancing view — info, valve history, room setpoints."""
    rooms = config.get("rooms", {})
    entities = config.get("entities", {})
    cards: List[Dict] = []

    # 1. Info card
    cards.append({
        "type": "markdown",
        "content": (
            "## Hydraulic Balancing\n\n"
            "This view shows valve positions and setpoints for each zone.\n"
            "For full balancing recommendations and adjustment suggestions,\n"
            "open the QSH add-on from the HA sidebar."
        ),
    })

    # 2. Valve position history (conditional)
    valve_entities: List[Dict] = []
    for room in rooms:
        valve = entities.get(f"{room}_heating")
        if valve:
            pretty = room.replace("_", " ").title()
            valve_entities.append({"entity": valve, "name": f"{pretty} Valve"})
    if valve_entities:
        cards.append({
            "type": "history-graph",
            "title": "Valve Positions (24h)",
            "hours_to_show": 24,
            "entities": valve_entities,
        })

    # 3. Room state — setpoints for all rooms
    setpoint_entities: List[Dict] = []
    for room in rooms:
        slug = slugify(room)
        pretty = room.replace("_", " ").title()
        setpoint_entities.append({
            "entity": f"input_number.qsh_shadow_{slug}_setpoint",
            "name": pretty,
        })
    if setpoint_entities:
        cards.append({
            "type": "entities",
            "title": "Setpoints & Current Temps",
            "show_header_toggle": False,
            "entities": setpoint_entities,
        })

    return {"title": "Balancing", "path": "qsh-balancing", "icon": "mdi:scale-balance", "cards": cards}

