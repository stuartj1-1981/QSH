"""Swarm API routes — unit-side read surface for swarm state.

The unit-side swarm read surface backs the per-unit "Swarm UX" engineering
sub-page (INSTRUCTION-289B frontend). Every handler reads the live
``SwarmRuntime`` via ``shared_state.get_swarm()`` and degrades gracefully to a
well-typed disabled/empty payload (HTTP 200, never 500) when the swarm
subsystem is disabled or not yet wired — mirroring ``get_quarantine``.

Routes (INSTRUCTION-289A):
    GET /api/swarm/quarantine  — coordinator quarantine signal (288B, unchanged)
    GET /api/swarm/status      — identity + enable flags + endpoint + queue status
    GET /api/swarm/priors      — received coordinator priors (empty until 287 lands)
    GET /api/swarm/divergence  — per-room shadow-vs-live sysid divergence
    GET /api/swarm/gates       — the four LocalGate states
    GET /api/swarm/channels    — per-channel consumption status (gate x family x data x wired)

Routes (INSTRUCTION-294A):
    GET  /api/swarm/global     — freshness-checked GLOBAL gate + master live-enable
    POST /api/swarm/live       — operator toggle of the master live-enable
"""

import logging
import math
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...swarm.gate_state import GateState
from ..state import shared_state

router = APIRouter()


def _pre_shutdown_state(pub, cfg, now):
    """(pre_shutdown_active, remaining_hours) for the dormancy banner. Active in
    the pre-shutdown countdown OR armed-and-waiting-for-ack (window elapsed).
    Returns (False, None) outside the window or when cfg is absent."""
    if pub.is_dormancy_armed():
        return True, 0
    if cfg is not None and pub.dormancy_due(now, cfg.t_dormant_days):
        rem = pub.pre_shutdown_remaining_s(
            now, cfg.t_dormant_days, cfg.pre_shutdown_window_hours
        )
        if rem is not None and rem > 0:
            return True, int(math.ceil(rem / 3600.0))
    return False, None

# The four per-subclass LocalGates, in a fixed order (qsh/swarm/gate_state.py
# ::LocalGates). Iterated by /swarm/gates so the payload is stable + complete.
_GATE_CLASSES = ("disturbance_relay", "sysid_priors", "solar_bootstrap", "rl_benchmarking")

# Per-channel consumption descriptors (INSTRUCTION-296A). Order mirrors
# _GATE_CLASSES. `family` is the PriorCache family the channel consumes (None
# for channels with no prior-family data path). `wired` is whether the
# consumption path is active in THIS build — disturbance_relay + rl_benchmarking
# are reserved (D-6 / Client Sketch §2) and flip to True when their paths land
# (WS-SWARM-CHANNEL-WIRED-FLAG). Families verified against the consumer
# PARAMETER_FAMILY constants.
_SWARM_CHANNELS = (
    {"cls": "disturbance_relay", "family": None, "wired": False},
    {"cls": "sysid_priors", "family": "thermal_envelope", "wired": True},
    {"cls": "solar_bootstrap", "family": "solar_capture", "wired": True},
    {"cls": "rl_benchmarking", "family": None, "wired": False},
)


@router.get("/swarm/quarantine")
def get_quarantine():
    """Latest quarantine signal from the coordinator (QS-INSTRUCTION-007 / 288A).

    Graceful when the swarm subsystem is disabled or the unit has not yet
    published: returns quarantined=false. Read-only; no auth beyond the
    existing API surface."""
    runtime = shared_state.get_swarm()
    block = runtime.publisher.latest_quarantine() if runtime is not None else None
    if block is None:
        return {"quarantined": False, "reason": None, "contact": None}
    return {"quarantined": True, "reason": block.get("reason"), "contact": block.get("contact")}


@router.get("/swarm/version-status")
def get_version_status():
    """Latest version-compliance signal (INSTRUCTION-320 / QS-050 §6).

    `known: false` + nulls when the swarm subsystem is disabled or no
    version_status block has been received yet; the FSM fields still report the
    unit's local state (COMPLIANT until a block says otherwise). fsm_state +
    grace_expired are the unit's own conservative 14-day timer;
    update_grace_remaining_days is the server's audit-grade DISPLAY field, not
    the FSM clock (QS-050 §6). Read-only; graceful (HTTP 200, never 500)."""
    runtime = shared_state.get_swarm()
    block = runtime.publisher.latest_version_status() if runtime is not None else None
    fsm = runtime.publisher.version_state_snapshot() if runtime is not None else None
    fsm_state = fsm["fsm_state"] if fsm else None
    grace_expired = fsm["grace_expired"] if fsm else None
    if block is None:
        return {
            "known": False,
            "compliant": None,
            "current": None,
            "min_supported": None,
            "update_url": None,
            "update_grace_remaining_days": None,
            "fsm_state": fsm_state,
            "grace_expired": grace_expired,
        }
    return {
        "known": True,
        "compliant": block.get("compliant"),
        "current": block.get("current"),
        "min_supported": block.get("min_supported"),
        "update_url": block.get("update_url"),
        "update_grace_remaining_days": block.get("update_grace_remaining_days"),
        "fsm_state": fsm_state,
        "grace_expired": grace_expired,
    }


@router.get("/swarm/apoptosis")
def get_apoptosis():
    """Apoptosis detector status (INSTRUCTION-321B). Graceful when the swarm
    subsystem is disabled or the arbiter has not run yet (all-false). ``suspended``
    reflects the swarm-lifecycle FSM; ``hormesis`` is the soft 2-of-3 warning; the
    three trigger flags are diagnostic. Read-only; HTTP 200, never 500."""
    runtime = shared_state.get_swarm()
    pub = runtime.publisher if runtime is not None else None
    status = pub.apoptosis_status() if pub is not None else None
    suspended = pub.is_self_suspended() if pub is not None else False

    # INSTRUCTION-322B — dormancy + recovery fields for the banner/countdown. This
    # route surface is operator-visibility only; it does NOT close the QS-061
    # in-packet "defined-but-unused" SwarmState LOW (L-2). `now`/cfg drive the
    # pre-shutdown countdown.
    dormant = pub.is_dormant() if pub is not None else False
    recommissioning = pub.is_recommissioning() if pub is not None else False
    swarm_state = pub.wire_swarm_state() if pub is not None else None
    cfg = getattr(getattr(runtime, "config", None), "apoptosis", None) if runtime is not None else None
    if pub is not None:
        pre_shutdown_active, pre_shutdown_remaining_hours = _pre_shutdown_state(
            pub, cfg, time.time()
        )
    else:
        pre_shutdown_active, pre_shutdown_remaining_hours = False, None
    dormancy_fields = {
        "dormant": dormant,
        "pre_shutdown_active": pre_shutdown_active,
        "pre_shutdown_remaining_hours": pre_shutdown_remaining_hours,
        "recommissioning": recommissioning,
        "swarm_state": swarm_state,
    }

    if status is None:
        return {
            "known": False, "hormesis": False, "armed": False,
            "suspended": suspended, "enabled": False,
            "trigger_a": False, "trigger_b": False, "trigger_c": False,
            **dormancy_fields,
        }
    return {
        "known": True,
        "hormesis": bool(status.get("hormesis", False)),
        "armed": bool(status.get("armed", False)),
        "suspended": bool(status.get("suspended", suspended)),
        "enabled": bool(status.get("enabled", False)),
        "trigger_a": bool(status.get("trigger_a", False)),
        "trigger_b": bool(status.get("trigger_b", False)),
        "trigger_c": bool(status.get("trigger_c", False)),
        **dormancy_fields,
    }


@router.get("/swarm/status")
def get_status():
    """Unit identity + enable flags + publish/queue status (INSTRUCTION-289A Task 1).

    ``endpoint`` is the Cloudflare Worker origin this unit publishes to — surfaced
    so the operator can see which server the install targets. The scalar
    ``pending`` (``count_pending()``) and the ``queue["pending"]`` bucket
    (``count_by_status()``) are the SAME figure — both count rows at SQLite status
    'pending'; ``pending`` is the canonical single in-flight number and ``queue``
    carries the full status breakdown (delivered / dropped_* / pending).

    Disabled/not-yet-wired → ``enabled:false`` with null identity and an empty
    queue, HTTP 200."""
    runtime = shared_state.get_swarm()
    if runtime is None:
        return {
            "enabled": False,
            "unit_id": None,
            "cohort_id": None,
            "subscribe_enabled": False,
            "endpoint": None,
            "queue": {},
            "pending": 0,
        }
    cfg = runtime.config
    return {
        "enabled": cfg.enabled,
        "unit_id": cfg.unit_id,
        "cohort_id": cfg.cohort_id,
        "subscribe_enabled": cfg.subscribe_enabled,
        "endpoint": cfg.endpoint,  # empty-string returned as-is when runtime present
        "queue": runtime.queue.count_by_status(),
        "pending": runtime.queue.count_pending(),
    }


@router.get("/swarm/priors")
def get_priors():
    """Received coordinator priors (INSTRUCTION-289A Task 2).

    Sourced from ``PriorCache.snapshot()``. Prior CONSUMPTION is not live yet
    (QS-INSTRUCTION-012 + INSTRUCTION-287 implementation-eligible but undeployed),
    so ``families`` is empty on every real install at present — the expected
    steady state. The route populates automatically once the consumption path
    deploys, with no backend change.

    Disabled/not-yet-wired → empty payload, HTTP 200."""
    runtime = shared_state.get_swarm()
    if runtime is None:
        return {"families": {}, "family_names": [], "last_etag": None, "count": 0}
    cache = runtime.prior_cache
    families = cache.snapshot()
    return {
        "families": families,
        "family_names": cache.families(),
        "last_etag": cache.last_etag,
        "count": len(families),
    }


@router.get("/swarm/divergence")
def get_divergence():
    """Per-room shadow-vs-live sysid divergence (INSTRUCTION-289A Task 3).

    The room key set is the union of the shadow track's U map and the live
    sysid's U map. For each room: ``*_delta = shadow - live``, null when either
    side lacks the room (one-sided). ``counterfactual_summary`` is the narrative
    OF that divergence.

    Degraded branch — ``runtime is None`` OR the live sysid handle is ``None``
    (early installs before the first cycle wires ``_sysid_ref``): the whole
    payload (rows + summary) is suppressed for coherence, since with no live
    baseline there is nothing to diverge against. Returns exactly
    ``{"rooms": [], "counterfactual_summary": None}`` at HTTP 200."""
    runtime = shared_state.get_swarm()
    sysid = shared_state.get_sysid()
    if runtime is None or sysid is None:
        return {"rooms": [], "counterfactual_summary": None}

    track = runtime.shadow_sysid_track
    u_shadow = track.get_all_u()
    c_shadow = track.get_all_c()
    solar_shadow = track.get_all_solar()
    u_live = sysid.get_all_u()
    c_live = sysid.get_all_c()
    solar_live = sysid.get_all_solar()

    def _delta(shadow, live):
        if shadow is None or live is None:
            return None
        return shadow - live

    rooms = []
    for room in sorted(set(u_shadow) | set(u_live)):
        u_s, u_l = u_shadow.get(room), u_live.get(room)
        c_s, c_l = c_shadow.get(room), c_live.get(room)
        s_s, s_l = solar_shadow.get(room), solar_live.get(room)
        rooms.append({
            "room": room,
            "u_shadow": u_s,
            "u_live": u_l,
            "u_delta": _delta(u_s, u_l),
            "c_shadow": c_s,
            "c_live": c_l,
            "c_delta": _delta(c_s, c_l),
            "solar_shadow": s_s,
            "solar_live": s_l,
            "solar_delta": _delta(s_s, s_l),
        })
    return {"rooms": rooms, "counterfactual_summary": track.last_counterfactual_summary}


@router.get("/swarm/gates")
def get_gates():
    """The four LocalGate states (INSTRUCTION-289A Task 4).

    Iterates the fixed ``LocalGates`` class tuple, emitting each gate's enum
    string value (``UNKNOWN`` / ``CLOSED`` / ``OPEN``). Disabled/not-yet-wired →
    all four ``UNKNOWN`` (the ``LocalGates`` default — "no consumer-side rule
    fires"), HTTP 200."""
    runtime = shared_state.get_swarm()
    if runtime is None:
        return {"gates": {cls: "UNKNOWN" for cls in _GATE_CLASSES}}
    cache = runtime.local_gate_cache
    return {"gates": {cls: cache.state_for(cls).value for cls in _GATE_CLASSES}}


@router.get("/swarm/channels")
def get_channels():
    """Per-channel swarm consumption status (INSTRUCTION-296A).

    For each of the four consumption channels (the _GATE_CLASSES, one per
    consumer), report the local gate state, the prior family it consumes, the
    freshness of any cached data, and whether the consumption path is wired in
    this build. The frontend (296B) derives the traffic-light colour from
    gate x data x wired x the global live_active signal.

    `data` ∈ {"fresh","stale","none"}: "fresh"/"stale" from the PriorCache
    entry's `stale` flag when the channel's family is cached; "none" when the
    family is absent, the channel has no family, or the runtime is None/disabled.

    Disabled/not-yet-wired runtime → every gate UNKNOWN, data "none", wired from
    the static registry, HTTP 200 (graceful idiom, mirrors get_gates)."""
    runtime = shared_state.get_swarm()
    snapshot = runtime.prior_cache.snapshot() if runtime is not None else {}

    channels = {}
    for ch in _SWARM_CHANNELS:
        cls, family, wired = ch["cls"], ch["family"], ch["wired"]
        if runtime is None:
            gate = "UNKNOWN"
        else:
            gate = runtime.local_gate_cache.state_for(cls).value
        if family is not None and family in snapshot:
            data = "stale" if snapshot[family].get("stale") else "fresh"
        else:
            data = "none"
        channels[cls] = {"gate": gate, "family": family, "data": data, "wired": wired}
    return {"channels": channels}


def _own_registry_unknown():
    """The degraded own-registry posture block (runtime absent / not yet wired).
    Mirrors the shape of ``OwnRegistryCache.snapshot()`` in its never-stamped
    state — UNKNOWN lifecycle, no coordinator, no cohorts, not fresh."""
    return {
        "unit_id": None,
        "lifecycle_state": "UNKNOWN",
        "served_by_coordinator": None,
        "archetype_attr": None,
        "feeder_attr": None,
        "gsp_attr": None,
        "cohorts": [],
        "fresh": False,
        "age_seconds": None,
    }


class _LiveEnableBody(BaseModel):
    """POST /api/swarm/live body — operator toggle of the master live-enable."""

    enabled: bool


@router.get("/swarm/global")
def get_global():
    """Freshness-checked GLOBAL gate + master live-enable (INSTRUCTION-294A Task 4).

    Reports the FRESH GLOBAL state (a read aged past max_age surfaces as UNKNOWN,
    so the UI Watchdog caption fires correctly). ``live_active`` is the actual
    consumption signal (master intent ∧ fresh GLOBAL Open); ``can_enable`` mirrors
    the set-time interlock (the master can only be enabled while GLOBAL is a fresh
    Open). Disabled/not-yet-wired → all-UNKNOWN/false, HTTP 200 (graceful idiom).

    INSTRUCTION-366 — also surfaces the unit's own marshal registry-row admission
    posture under ``own_registry`` (``OwnRegistryCache.snapshot(now)``): the
    derived ``lifecycle_state`` (REGISTERED / ASSIGNED / ACTIVE, or UNKNOWN when
    never read / stale / no-row), ``served_by_coordinator``, ``cohorts``, plus
    freshness. The unit does NOT gate on lifecycle — this is read-and-surface
    only. Not-yet-wired → an UNKNOWN/false posture block (mirrors the global_gate
    degraded path)."""
    runtime = shared_state.get_swarm()
    if runtime is None:
        return {
            "global_gate": "UNKNOWN",
            "live_enabled": False,
            "live_active": False,
            "can_enable": False,
            "own_registry": _own_registry_unknown(),
        }
    now = time.monotonic()
    cache = runtime.global_gate_cache
    fresh = cache.fresh_global_state(now)
    return {
        "global_gate": fresh.value,
        "live_enabled": cache.live_enabled,
        "live_active": cache.live_active(now),
        "can_enable": fresh is GateState.OPEN,
        "own_registry": runtime.own_registry_cache.snapshot(now),
    }


@router.post("/swarm/live")
def set_live(body: _LiveEnableBody):
    """Operator toggle of the master live-enable (INSTRUCTION-294A Task 4).

    Enabling is refused 409 unless GLOBAL is a fresh Open (set-time half of the
    continuous interlock). Disabling always succeeds. Malformed body → 422
    (Pydantic). Not-yet-wired runtime → 503."""
    runtime = shared_state.get_swarm()
    if runtime is None:
        raise HTTPException(status_code=503, detail="swarm runtime not yet wired")
    ok, reason = runtime.global_gate_cache.set_live_enabled(body.enabled, time.monotonic())
    if ok:
        return {"live_enabled": body.enabled}
    if reason == "global_not_open":
        raise HTTPException(
            status_code=409, detail="cannot enable — GLOBAL gate is not Open"
        )
    raise HTTPException(status_code=409, detail=reason)  # defensive — unreachable


# ── Recovery clears (INSTRUCTION-322B) ──────────────────────────────────


class _ClearBody(BaseModel):
    """Body for the two recovery-clear endpoints — a support-case reference for
    the unit-side audit log."""

    support_case_ref: str


@router.post("/swarm/dormancy/clear")
def clear_dormancy(body: _ClearBody):
    """Coordinator-anchored dormancy clear (INSTRUCTION-322B Task 3, M-1).

    The identity anchor is the coordinator's authoritative clear, signalled to the
    unit via the QS-063 ``dormancy_cleared`` block — NOT a unit-side signed
    assertion (the unit-side API has no signature/role substrate). HA-UI gated
    (operator presence); takes a ``support_case_ref`` for the unit's audit log.

    Gates (all clock-free — QS-064's server state machine guarantees any emitted
    block is the current episode's clear, so no unit-side cross-clock freshness
    check is needed):
      * coordinator has not cleared (no ``dormancy_cleared`` signal) → 409 (the
        fail-closed M-1 anchor; holds closed until the QS-063 emitter lands);
      * not SENESCENT_DORMANT (already recommissioned / never dormant — restored
        from disk on boot, so this survives a restart) → 409 (the load-bearing
        N-2 guard);
      * runtime not wired → 503.

    On accept: SENESCENT_DORMANT → RECOMMISSIONING_SOAK; the signal is consumed
    (consume-on-use, N-2 — a single clear cannot be replayed); audit-logged."""
    runtime = shared_state.get_swarm()
    if runtime is None:
        raise HTTPException(status_code=503, detail="swarm runtime not yet wired")
    pub = runtime.publisher
    cleared = pub.latest_dormancy_cleared()
    if cleared is None:
        raise HTTPException(
            status_code=409,
            detail="coordinator has not cleared this unit — perform the "
                   "coordinator-side clear first",
        )
    if not pub.is_dormant():
        raise HTTPException(
            status_code=409, detail="unit is not in SENESCENT_DORMANT"
        )
    now = time.time()
    pub.enter_recommissioning_soak(now)
    pub.consume_dormancy_cleared()  # N-2 — single clear, not replayable
    cfg = getattr(getattr(runtime, "config", None), "apoptosis", None)
    soak_days = cfg.t_recommissioning_soak_days if cfg is not None else 60
    logging.getLogger("qsh.swarm").info(
        "DORMANCY clear accepted: support_case_ref=%s coordinator_cleared_by=%s "
        "coordinator_cleared_at=%s",
        body.support_case_ref, cleared.get("cleared_by"), cleared.get("cleared_at"),
    )
    return {"swarm_state": "recommissioning_soak", "recommissioning_soak_days": soak_days}


@router.post("/swarm/self-suspended/clear")
def clear_self_suspended(body: _ClearBody):
    """HA-UI-gated SELF_SUSPENDED clear (INSTRUCTION-322B Task 4, H-1).

    The lighter pre-dormancy clear — supervisory control was never released, so no
    coordinator anchor is required; the HA-UI gate is the operator-presence check.
    The T_SOAK observation is NOT bypassed (→ SOAK_RESUME, not ACTIVE).

    Gates:
      * a dormancy arm is in flight (``is_dormancy_armed`` OR ``senescent_pending``)
        → 409 — no clear-to-SOAK_RESUME while a senescent arm races a late 2xx
        (the V1 split-brain; composes with 322A's sticky-authoritative ack);
      * not SELF_SUSPENDED → 409;
      * runtime not wired → 503."""
    runtime = shared_state.get_swarm()
    if runtime is None:
        raise HTTPException(status_code=503, detail="swarm runtime not yet wired")
    pub = runtime.publisher
    if pub.is_dormancy_armed() or pub.senescent_pending():
        raise HTTPException(
            status_code=409, detail="dormancy arm in flight — cannot clear"
        )
    if not pub.is_self_suspended():
        raise HTTPException(
            status_code=409, detail="unit is not in SELF_SUSPENDED"
        )
    pub.enter_soak_resume(time.time(), operator_cleared=True)
    logging.getLogger("qsh.swarm").info(
        "SELF_SUSPENDED clear accepted: support_case_ref=%s", body.support_case_ref
    )
    return {"swarm_state": "soak_resume"}
