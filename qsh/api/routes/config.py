"""Configuration endpoints — read, raw YAML access, section updates, deletion."""

import copy
import logging
import os
import yaml
from typing import Callable

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..state import shared_state

# YAML I/O primitives live in qsh.config_io so non-HTTP modules can update
# qsh.yaml without importing from this routes package (INSTRUCTION-130 Task 0).
# Re-exported under their original underscore-private names so existing internal
# call sites — and test patches at @patch("qsh.api.routes.config._atomic_write_yaml")
# — continue to work unchanged.
from qsh.config_io import (
    yaml_lock as _yaml_lock,
    atomic_write_yaml as _atomic_write_yaml,
)
from qsh.paths import YAML_PATH

logger = logging.getLogger(__name__)

router = APIRouter()

YAML_SEARCH_PATHS = [
    "/config/qsh.yaml",
    "/data/qsh.yaml",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "qsh.yaml"
    ),
]

REDACTED_SENTINEL = "***REDACTED***"


def _find_yaml_path() -> str:
    """Find the active qsh.yaml path."""
    for path in YAML_SEARCH_PATHS:
        if os.path.isfile(path):
            return path
    return YAML_PATH  # Default write path


def _load_raw_yaml():
    """Load the raw YAML (not the processed HOUSE_CONFIG).

    Returns the parsed dict, or None if the file could not be read/parsed.
    """
    path = _find_yaml_path()
    try:
        with open(path, "r") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.error(
            "Failed to load qsh.yaml from %s: %s — returning None", path, e
        )
        return None


def _read_modify_write(transform: Callable[[dict], dict]) -> dict:
    """Thread-safe config update for HTTP route callers.

    Resolves the YAML path via the search-list (the alpha-install backwards-
    compat affordance) and uses the local _load_raw_yaml / _atomic_write_yaml
    references — both are patchable for tests at qsh.api.routes.config.

    Non-HTTP callers should use qsh.config_io.read_modify_write, which resolves
    directly against qsh.paths.YAML_PATH and skips the search list.
    """
    path = _find_yaml_path()
    with _yaml_lock:
        raw = _load_raw_yaml()
        if raw is None and os.path.isfile(path) and os.path.getsize(path) > 0:
            raise RuntimeError(
                f"Config file {path} exists ({os.path.getsize(path)} bytes) "
                f"but _load_raw_yaml returned None — refusing to overwrite"
            )
        if raw is None:
            raw = {}
        result = transform(raw)
        _atomic_write_yaml(result, path)
    return result


def restore_redacted(existing: dict, incoming: dict) -> dict:
    """Full-section overwrite with redacted field restoration.

    The incoming dict is the complete section as the UI intends it.
    The ONLY exception: fields arriving as REDACTED_SENTINEL are
    replaced with the existing real value. All other keys are taken
    from incoming as-is.
    """
    result = {}
    for key, value in incoming.items():
        if value == REDACTED_SENTINEL and key in existing:
            result[key] = existing[key]
        elif isinstance(value, dict) and isinstance(existing.get(key), dict):
            result[key] = restore_redacted(existing[key], value)
        else:
            result[key] = value
    return result


@router.get("/config")
def get_config():
    """Return the current HOUSE_CONFIG as JSON.

    Sensitive fields (API keys) are redacted.
    """
    config = shared_state.get_config()
    if config is None:
        return {"error": "Config not yet loaded"}

    safe = _redact_config(config)
    return safe


@router.get("/config/raw")
def get_raw_config():
    """Return the raw qsh.yaml as JSON (not the processed HOUSE_CONFIG).

    Used by settings screens to show the editable YAML structure.
    Sensitive fields are redacted.
    """
    raw = _load_raw_yaml() or {}
    return _redact_config(raw)


@router.patch("/config/{section}")
def patch_config_section(section: str, body: dict):
    """Update a single config section.

    All changes trigger a pipeline restart to adopt the new config.
    """
    valid_sections = {
        "rooms",
        "heat_source",
        "outdoor",
        "energy",
        "thermal",
        "control",
        "shoulder",
        "summer",
        "solar",
        "battery",
        "grid",
        "cascade",
        "occupancy",
        "historian",
        "hw_plan",
        "hw_schedule",
        "hw_tank",
        "hw_precharge",
        "inverter",
        "logging",
        "source_selection",
        "telemetry",
        "disclaimer_accepted",
        "mqtt",
        "root",
    }

    if section not in valid_sections:
        raise HTTPException(status_code=400, detail=f"Invalid section: {section}")

    incoming = body.get("data", body)

    # "root" section merges individual keys at the YAML root level
    # (e.g. publish_mqtt_shadow, flow_min_internal)
    if section == "root":
        _ROOT_ALLOWED = {
            "publish_mqtt_shadow",
            "mqtt_legacy_shadow_topics",
            "flow_min_internal",
            "flow_max_internal",
            "pid_target_internal",
        }

        def _apply_root(raw: dict) -> dict:
            if isinstance(incoming, dict):
                for key, value in incoming.items():
                    if key in _ROOT_ALLOWED:
                        raw[key] = value
                        # Also update in-memory config
                        config = shared_state.get_config()
                        if config is not None:
                            config[key] = value
                    else:
                        logger.info(
                            "config/root: dropping unknown key '%s' (not in _ROOT_ALLOWED)",
                            key,
                        )
            return raw

        _read_modify_write(_apply_root)
        return {
            "updated": "root",
            "restart_required": False,
            "message": "Root config keys updated",
        }

    def _apply_patch(raw: dict) -> dict:
        existing_section = raw.get(section, {})
        # Restore redacted fields so secrets aren't overwritten with the sentinel
        if isinstance(existing_section, dict) and isinstance(incoming, dict):
            raw[section] = restore_redacted(existing_section, incoming)
        else:
            raw[section] = incoming
        return raw

    _read_modify_write(_apply_patch)

    # Always restart to adopt changes
    try:
        with open("/config/qsh_restart_requested", "w") as f:
            f.write("1")
    except OSError:
        pass

    return {
        "updated": section,
        "restart_required": True,
        "message": f"Section '{section}' updated — pipeline restarting",
    }


@router.delete("/config/{section}")
def delete_config_section(section: str):
    """Remove an optional section from qsh.yaml entirely."""
    deletable_sections = {
        "solar",
        "battery",
        "grid",
        "inverter",
        "hw_plan",
        "hw_schedule",
        "hw_tank",
        "hw_precharge",
        "historian",
    }
    if section not in deletable_sections:
        raise HTTPException(
            status_code=400,
            detail=f"Section '{section}' cannot be deleted (required or non-deletable)",
        )

    removed: list = [None]  # mutable container for closure write-back

    def _apply_delete(raw: dict) -> dict:
        removed[0] = raw.pop(section, None)
        return raw

    _read_modify_write(_apply_delete)
    was_present = removed[0] is not None

    if not was_present:
        return {"deleted": section, "was_present": False}

    structural = {"hw_plan", "hw_schedule", "hw_tank", "hw_precharge"}
    needs_restart = section in structural

    if needs_restart:
        try:
            with open("/config/qsh_restart_requested", "w") as f:
                f.write("1")
        except OSError:
            pass

    return {
        "deleted": section,
        "was_present": True,
        "restart_required": needs_restart,
    }


class InfluxTestRequest(BaseModel):
    host: str
    port: int = 8086
    database: str = "qsh"
    username: str = ""
    password: str = ""


@router.post("/config/test-influxdb")
def test_influxdb(req: InfluxTestRequest):
    """Test InfluxDB connectivity and database existence."""
    # If password is redacted, load real one from YAML
    if req.password == REDACTED_SENTINEL:
        raw = _load_raw_yaml() or {}
        req.password = raw.get("historian", {}).get("password", "")

    try:
        from influxdb import InfluxDBClient

        client = InfluxDBClient(
            host=req.host,
            port=req.port,
            username=req.username,
            password=req.password,
            timeout=5,
        )
        dbs = [d["name"] for d in client.get_list_database()]
        if req.database not in dbs:
            return {
                "success": False,
                "message": f"Connected but database '{req.database}' not found. "
                f"Available: {', '.join(dbs)}",
            }
        return {
            "success": True,
            "message": f"Connected. Database '{req.database}' exists.",
        }
    except ImportError:
        return {"success": False, "message": "influxdb Python package not installed"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {e}"}


def _redact_config(config: dict) -> dict:
    """Remove API keys and credentials from config for safe exposure."""
    c = copy.deepcopy(config)
    _redact_recursive(c)
    return c


def _redact_recursive(obj, depth=0):
    if depth > 10:
        return
    if isinstance(obj, dict):
        for k in obj:
            if any(s in k.lower() for s in ("key", "secret", "token", "password")):
                if isinstance(obj[k], str) and obj[k]:
                    obj[k] = REDACTED_SENTINEL
            else:
                _redact_recursive(obj[k], depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _redact_recursive(item, depth + 1)
