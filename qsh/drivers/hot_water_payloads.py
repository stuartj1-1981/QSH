"""Shared ON/OFF/UNAVAILABLE classification for hot_water_active sources.

Used by both the HA sensor_fetcher and the MQTT driver so the boolean
trigger has one authoritative payload dictionary and one quality-code
semantic. See INSTRUCTION-126 for the contract.
"""
from typing import Optional, Tuple

HW_ON_PAYLOADS = frozenset({
    "on", "true", "1", "heat", "high_demand",
})
HW_OFF_PAYLOADS = frozenset({
    "off", "false", "0", "idle",
    "eco", "electric", "heat_pump", "gas", "performance",
})
HW_UNAVAILABLE_PAYLOADS = frozenset({
    "unavailable", "unknown", "none", "",
})


def classify_hot_water_payload(raw: Optional[str]) -> Tuple[Optional[bool], bool]:
    """Classify a DHW-active payload.

    Returns (value, live):
        value=True,  live=True  -> ON  (contributes True to OR, sets capability)
        value=False, live=True  -> OFF live (contributes False, sets capability)
        value=False, live=False -> UNAVAILABLE (contributes False, no capability)
        value=None,  live=False -> UNRECOGNISED (no contribution, no capability)

    Caller rules:
        - If value is not None:           include in OR resolution.
        - If live is True:                contribute to capability assertion.
        - If value is None and live False: leave prior state untouched.

    None input -> treated as UNRECOGNISED (caller didn't provide a reading).
    """
    if raw is None:
        return (None, False)
    norm = str(raw).strip().lower()
    if norm in HW_ON_PAYLOADS:
        return (True, True)
    if norm in HW_OFF_PAYLOADS:
        return (False, True)
    if norm in HW_UNAVAILABLE_PAYLOADS:
        return (False, False)
    return (None, False)
