"""Shared, driver-agnostic active-source dispatch-addressing resolver.

Consumed by the HA driver (INSTRUCTION-279B) and the MQTT driver
(INSTRUCTION-279C). Distinct from ``qsh/pipeline/source_resolver.py`` (which
resolves per-source capability / COP); this module resolves *actuator
addressing* — which control method and which flow/mode targets the active
source's continuous dispatch should use this cycle.

Design: INSTRUCTION-279A §2. Pure functions; no I/O, no HA/MQTT imports, no
module-scope side effects (mirrors ``qsh/drivers/resolve.py``'s posture so it
ships as source under the ``drivers/`` whitelist and unit-tests cleanly).

INSTRUCTION-329 D5: the INSTRUCTION-279 primary-shared invariant is relaxed —
a PRIMARY source carrying explicit per-source ``flow_control`` topics (both
``topic`` and ``mode_topic``) is stamped ``method="mqtt"`` at config load and
routes per-source through the ``method`` branch like any other source. The
shared-topic fallback below now applies only to primaries WITHOUT explicit
per-source topics. The routing decision itself is unchanged: it keys solely on
``flow_control.method``.

The default literals below MUST match the existing top-level resolution
(``config.py`` ``_resolve_active_source``, verified at config.py:2253-2263) and
the HA dispatch helpers (``hardware_dispatch.py`` ``_apply_flow_*``, verified at
hardware_dispatch.py:223-289) exactly, so a single-source install resolves
identically whether through the per-source ``routed`` branch or the
``fallback_safe`` branch.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional


# Default literals — provenance: config.py:2253-2263 (_resolve_active_source).
_DEFAULT_MQTT_FLOW_TOPIC = "qsh/heat_pump/flow_temp/set"
_DEFAULT_MQTT_MODE_TOPIC = "qsh/heat_pump/mode/set"
_DEFAULT_ENTITY_FLOW_TARGET = "input_number.qsh_target_flow_temp"
_DEFAULT_ENTITY_MODE_TARGET = "input_text.qsh_target_mode"


@dataclass(frozen=True)
class SourceRouting:
    """Effective dispatch addressing for the cycle's active heat source.

    ``routed``  — True when the active source's own ``flow_control`` block drove
                the result; False when resolution fell back to the top-level
                config (single-source / primary) or suppressed dispatch.
    ``dispatch_flow_mode`` — True when a driver SHOULD dispatch continuous
                flow/mode this cycle. False ONLY in the suppress case: a
                NON-primary active source that defines no actuator, on a
                multi-source install. In that case carrying the
                top-level/primary targets would dispatch the active source's
                flow to the PRIMARY actuator (INSTRUCTION-279 §1 defect);
                drivers MUST skip heat-source flow/mode dispatch instead.
    """

    control_method: str
    routed: bool
    dispatch_flow_mode: bool = True
    mqtt_flow_topic: Optional[str] = None
    mqtt_mode_topic: Optional[str] = None
    entity_flow_target: Optional[str] = None
    entity_mode_target: Optional[str] = None
    hp_flow_service: Optional[Dict] = None
    hp_hvac_service: Optional[Dict] = None


def resolve_source_routing(
    config: Dict,
    active_source_config: Optional[Dict],
) -> SourceRouting:
    """Resolve effective dispatch addressing for the active source (§2.2)."""
    asc = active_source_config or {}
    fc = asc.get("flow_control") or {}

    heat_sources = config.get("heat_sources") or []
    single_source = len(heat_sources) <= 1
    is_primary = (not heat_sources) or (
        asc.get("name") == (heat_sources[0] or {}).get("name")
    )
    fallback_safe = single_source or is_primary

    method = fc.get("method")

    if method == "mqtt":
        return SourceRouting(
            control_method="mqtt",
            routed=True,
            dispatch_flow_mode=True,
            mqtt_flow_topic=(
                fc.get("topic")
                or config.get("mqtt_flow_topic")
                or _DEFAULT_MQTT_FLOW_TOPIC
            ),
            mqtt_mode_topic=(
                fc.get("mode_topic")
                or config.get("mqtt_mode_topic")
                or _DEFAULT_MQTT_MODE_TOPIC
            ),
        )

    if method == "entity":
        return SourceRouting(
            control_method="entity",
            routed=True,
            dispatch_flow_mode=True,
            entity_flow_target=(
                fc.get("flow_entity")
                or config.get("entity_flow_target")
                or _DEFAULT_ENTITY_FLOW_TARGET
            ),
            entity_mode_target=(
                fc.get("mode_entity")
                or config.get("entity_mode_target")
                or _DEFAULT_ENTITY_MODE_TARGET
            ),
        )

    if method == "ha_service":
        on_off = asc.get("on_off_control") or {}
        return SourceRouting(
            control_method="ha_service",
            routed=True,
            dispatch_flow_mode=True,
            hp_flow_service=fc,
            hp_hvac_service=(on_off if on_off else config.get("hp_hvac_service")),
        )

    # fc empty / method unset / unknown (incl. octopus_api, trvs_only,
    # monitor_only top-level methods, which are never per-source routed).
    #
    # INSTRUCTION-329 D5: this fallback is reached for a primary ONLY when it
    # carries no explicit per-source method. A primary configured with both
    # flow_control.topic AND flow_control.mode_topic is stamped method="mqtt"
    # at config load (config.py INSTRUCTION-308/329 block) and routes per-source
    # via the method=="mqtt" branch above — the 279 primary-shared invariant now
    # applies only to primaries without explicit per-source topics. The method
    # check at the top of this function is the sole routing decision; no change
    # here beyond this clarification.
    control_method = config.get("control_method", "trvs_only")
    if fallback_safe:
        # Single-source or primary-without-per-source-topics: the top-level flat
        # targets ARE this active source's actuator, so the routing carries them
        # through (§2.2 fallback row — "top-level flat targets copied through";
        # SourceRouting docstring). The top-level config is authoritative;
        # populating the routing fields keeps the routing object self-describing,
        # matching the per-source routed branches above. effective_dispatch_config
        # still leaves the original config keys intact for routed=False, so
        # dispatch is unaffected.
        return SourceRouting(
            control_method=control_method,
            routed=False,
            dispatch_flow_mode=True,
            mqtt_flow_topic=config.get("mqtt_flow_topic"),
            mqtt_mode_topic=config.get("mqtt_mode_topic"),
            entity_flow_target=config.get("entity_flow_target"),
            entity_mode_target=config.get("entity_mode_target"),
            hp_flow_service=config.get("hp_flow_service"),
            hp_hvac_service=config.get("hp_hvac_service"),
        )
    # Non-primary, actuator-less, multi-source: SUPPRESS. Carrying the
    # top-level/primary targets would mis-dispatch to the primary actuator.
    return SourceRouting(
        control_method=control_method,
        routed=False,
        dispatch_flow_mode=False,
    )


def effective_dispatch_config(config: Dict, routing: SourceRouting) -> Dict:
    """Return a shallow copy of ``config`` with ``routing``'s fields overlaid
    onto the flat keys the HA dispatch helpers read (§2.3).

    Consumed by 279B so that ``apply_hardware_control(config, ...)`` routes
    through the active source WITHOUT changing that function's DI-guarded
    signature. When ``routing.dispatch_flow_mode`` is False the returned config
    sets ``control_method='trvs_only'`` so the HA path performs no heat-source
    dispatch (TRV setpoints still flow). When ``routing.routed`` is False and
    ``dispatch_flow_mode`` is True the overlay is a faithful copy (the
    top-level keys are already correct for the single-source / primary case).
    """
    eff = dict(config)
    if not routing.dispatch_flow_mode:
        eff["control_method"] = "trvs_only"
        return eff
    eff["control_method"] = routing.control_method
    if routing.routed:
        if routing.control_method == "mqtt":
            eff["mqtt_flow_topic"] = routing.mqtt_flow_topic
            eff["mqtt_mode_topic"] = routing.mqtt_mode_topic
        elif routing.control_method == "entity":
            eff["entity_flow_target"] = routing.entity_flow_target
            eff["entity_mode_target"] = routing.entity_mode_target
        elif routing.control_method == "ha_service":
            eff["hp_flow_service"] = routing.hp_flow_service
            if routing.hp_hvac_service is not None:
                eff["hp_hvac_service"] = routing.hp_hvac_service
    return eff
