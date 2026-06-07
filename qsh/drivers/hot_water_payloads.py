"""Shared ON/OFF/UNAVAILABLE classification for hot_water_active sources.

Used by both the HA sensor_fetcher and the MQTT driver so the boolean
trigger has one authoritative payload dictionary and one quality-code
semantic. See INSTRUCTION-126 for the contract.
"""
from typing import Iterable, Optional, Tuple

# INSTRUCTION-301 — default last-valid hold window for hot_water_active across
# a hot-water-source comms drop. Owner-ratified at 1800 s (30 min) on
# 05 Jun 2026; overridable per install via config key `hot_water_stale_hold_s`.
HW_STALE_HOLD_DEFAULT_S = 1800.0

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

    Caller rules (amended by INSTRUCTION-301):
        - If live is True:                include the value in OR resolution
                                          AND contribute to capability assertion.
        - If live is False:               do NOT vote in OR resolution. This
                                          covers UNAVAILABLE (value=False,
                                          live=False) and UNRECOGNISED
                                          (value=None, live=False). A non-live
                                          reading instead triggers the bounded
                                          last-valid hold in
                                          `resolve_hot_water_active`.

    INSTRUCTION-301 amends the INSTRUCTION-126 "UNAVAILABLE contributes False
    to OR" rule: UNAVAILABLE's value=False no longer counts as an OFF vote,
    because a comms drop is "unknown", not "off". The `live` flag — already
    the liveness discriminator for `has_live_hot_water` — now also gates OR
    voting via `resolve_hot_water_active`.

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


def resolve_hot_water_active(
    sources: Iterable[Tuple[Optional[bool], bool]],
    last_valid: Optional[bool],
    last_valid_ts: Optional[float],
    now: float,
    hold_timeout_s: float = HW_STALE_HOLD_DEFAULT_S,
) -> Tuple[bool, Optional[bool], Optional[float], bool]:
    """Resolve hot_water_active with last-valid hold across non-live periods.

    INSTRUCTION-301. Resolves DHW-active from LIVE contributions only; when no
    source is live (every source is a comms drop / unrecognised), holds the
    last live-resolved value for a bounded window instead of collapsing to
    False. A spurious OFF mid-DHW-reheat would otherwise mis-attribute live
    hot-water energy to central heating in the SCOP bucket.

    Args:
        sources: iterable of (value, live) tuples from
            `classify_hot_water_payload`. Only entries with live=True vote.
        last_valid: last live-resolved hot_water_active, or None if never
            resolved live.
        last_valid_ts: wall time (time.time()) of that last live resolution,
            or None.
        now: current wall time (time.time()).
        hold_timeout_s: maximum age of `last_valid` that may still be held.

    Returns:
        (hot_water_active, new_last_valid, new_last_valid_ts, used_hold):
        - If any source is live: hot_water_active = any(live values);
          new_last_valid/ts = (result, now); used_hold = False. A live OFF is a
          live reading and is respected immediately (turns HW off, no hold).
        - Else, if a last_valid exists within hold_timeout_s: hold it
          (hot_water_active = last_valid, used_hold = True, last_valid/ts
          unchanged).
        - Else: hot_water_active = False, used_hold = False, last_valid/ts
          unchanged (a stale-beyond-timeout last_valid is retained but no
          longer held).
    """
    live_values = [value for (value, live) in sources if live]
    if live_values:
        result = any(live_values)
        return (result, result, now, False)
    # No live source — hold the last live-resolved value within the window.
    if (
        last_valid is not None
        and last_valid_ts is not None
        and (now - last_valid_ts) <= hold_timeout_s
    ):
        return (last_valid, last_valid, last_valid_ts, True)
    return (False, last_valid, last_valid_ts, False)
