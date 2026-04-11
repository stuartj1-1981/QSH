"""resolve.py — Internal-vs-external value resolution foundation.

Design principle: Internal value is the default. External interface is the override.

    value = read_external(config) if external_configured else internal_value

All pipeline read paths for configurable entity fields should use resolve_value()
rather than calling read functions directly, so that:
  1. The entity can be omitted from config without breaking anything.
  2. The frontend can detect "external configured but unavailable" (source="internal"
     AND external_id is not None).
  3. Tests can pass read_fn=None to get the MockDriver path with no HA calls.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional


def deep_get(d: dict, dotted_key: str, default: Any = None) -> Any:
    """Traverse nested dicts using dot-notation.

    'entities.flow_min_temp' → d["entities"]["flow_min_temp"]

    Returns default if any key in the chain is missing or if an intermediate
    value is not a dict.
    """
    keys = dotted_key.split(".")
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, default)
    return d


@dataclass
class ResolvedValue:
    """Result of resolve_value().

    Attributes:
        value:        The resolved value (from external entity or internal config).
        source:       "external" if read from HA/MQTT entity, "internal" otherwise.
        external_id:  Entity ID or MQTT topic.  None when no entity was configured.
                      Populated even when read failed (source="internal" AND
                      external_id != None → entity configured but unavailable).
        external_raw: Raw state string from HA/MQTT.  None when using internal value.
    """

    value: Any
    source: str                    # "external" | "internal"
    external_id: Optional[str]     # entity ID / topic, or None
    external_raw: Optional[str]    # raw state string, or None


def resolve_value(
    config: dict,
    entity_key: str,
    internal_key: str,
    default: Any,
    read_fn: Optional[Callable] = None,
) -> ResolvedValue:
    """Read from an external entity if configured, else return the internal value.

    Args:
        config:       HOUSE_CONFIG dict.
        entity_key:   Dot-notation path into config for the entity ID
                      (e.g. "entities.flow_min_temp").  Uses deep_get() to
                      traverse nested dicts — plain dict.get() cannot handle
                      nested keys and would silently return None.
        internal_key: Root-level key in config for the internal fallback value.
        default:      Value used when both external read and internal key are absent.
        read_fn:      Driver-specific state reader.
                      Signature: read_fn(config, entity_id) -> raw_value or None.
                      Pass None for MockDriver / test contexts — always returns
                      internal.

    Returns:
        ResolvedValue with source, value, external_id, external_raw populated.
    """
    entity_id = deep_get(config, entity_key)

    if entity_id and read_fn is not None:
        raw = read_fn(config, entity_id)
        if raw is not None:
            return ResolvedValue(
                value=raw,
                source="external",
                external_id=entity_id,
                external_raw=str(raw),
            )

    # No entity configured, entity blank, or read failed — use internal value.
    # IMPORTANT: preserve entity_id even when read fails — the frontend uses
    # (source="internal" AND external_id != None) to detect the "external
    # configured but unavailable" warning state.
    internal = config.get(internal_key, default) if internal_key is not None else default
    return ResolvedValue(
        value=internal,
        source="internal",
        external_id=entity_id,       # None if blank, populated if configured-but-failed
        external_raw=None,
    )


def _validate_range(s: str, lo: float, hi: float) -> Optional[float]:
    """Safe range validator for MQTT payloads.  Never raises.

    Contract: returns typed float if valid and in [lo, hi], None otherwise.
    This contract is documented here and in _resolve_mqtt_control (36B) so
    that callers can safely pass this as a validate callback without
    try/except wrapping.
    """
    try:
        v = float(s)
        return v if lo <= v <= hi else None
    except (ValueError, TypeError):
        return None
