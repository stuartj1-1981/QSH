"""Batch entity resolution — resolve HA entity IDs to friendly names.

Requires HA driver — returns 501 on non-HA driver paths (MQTT, mock).
"""

import os
import logging
from typing import Dict, List, Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/entities", tags=["entities"])

HA_TIMEOUT = 10


def _get_ha_headers():
    """Lazily resolve HA Supervisor credentials. Only called when an HA endpoint runs."""
    token = os.getenv("SUPERVISOR_TOKEN")
    if not token:
        return None, None, None
    url = "http://supervisor/core"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return url, token, headers


class ResolvedEntity(BaseModel):
    friendly_name: str
    state: str
    unit: str


class ResolveRequest(BaseModel):
    entity_ids: List[str]


class ResolveResponse(BaseModel):
    entities: Dict[str, Optional[ResolvedEntity]]


def _fetch_all_states() -> List[Dict]:
    """Fetch all HA entity states via REST API (same approach as wizard)."""
    ha_url, _, ha_headers = _get_ha_headers()
    if not ha_headers:
        logger.warning("No SUPERVISOR_TOKEN — entity resolve unavailable")
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
        logger.error("Entity resolve fetch failed: %s", e)
        return []


@router.post("/resolve", response_model=ResolveResponse)
def resolve_entities(body: ResolveRequest):
    """Resolve a batch of HA entity IDs to their friendly names and states."""
    from ..state import shared_state

    if not shared_state.is_ha_driver():
        raise HTTPException(status_code=501, detail="Entity API requires HA driver")

    _, _, ha_headers = _get_ha_headers()
    if not ha_headers:
        return ResolveResponse(entities={})

    all_states = _fetch_all_states()
    # Build lookup by entity_id
    lookup: Dict[str, Dict] = {s["entity_id"]: s for s in all_states if "entity_id" in s}

    result: Dict[str, Optional[ResolvedEntity]] = {}
    for entity_id in body.entity_ids:
        entity = lookup.get(entity_id)
        if entity:
            attrs = entity.get("attributes") or {}
            result[entity_id] = ResolvedEntity(
                friendly_name=attrs.get("friendly_name") or entity_id,
                state=entity.get("state") or "unknown",
                unit=attrs.get("unit_of_measurement") or "",
            )
        else:
            result[entity_id] = None

    return ResolveResponse(entities=result)
