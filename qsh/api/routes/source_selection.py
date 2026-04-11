"""Source selection API — mode and preference control."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..state import shared_state

router = APIRouter()


class ModeRequest(BaseModel):
    mode: str


class PreferenceRequest(BaseModel):
    preference: float


@router.get("/source-selection")
def get_source_selection():
    """Current source selection state."""
    snap = shared_state.get_snapshot()
    if snap.source_selection is None:
        return {"error": "Single source install — source selection not applicable"}
    return snap.source_selection


@router.post("/source-selection/mode")
def set_source_selection_mode(body: ModeRequest):
    """Set source selection mode (auto or manual lock to a source name)."""
    config = shared_state.get_config()
    if config is None:
        raise HTTPException(status_code=503, detail="Config not yet loaded")

    heat_sources = config.get("heat_sources", [])
    if len(heat_sources) < 2:
        raise HTTPException(status_code=400, detail="Single source install")

    mode = body.mode
    if mode != "auto":
        names = [s["name"] for s in heat_sources]
        if mode not in names:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown source name '{mode}'. Valid: {names}",
            )

    # Write to config via YAML PATCH mechanism
    import yaml
    import os

    yaml_paths = ["/config/qsh.yaml", "/data/qsh.yaml"]
    yaml_path = None
    for p in yaml_paths:
        if os.path.isfile(p):
            yaml_path = p
            break

    if yaml_path is None:
        raise HTTPException(status_code=500, detail="Config file not found")

    with open(yaml_path, "r") as f:
        raw = yaml.safe_load(f)

    ss = raw.setdefault("source_selection", {})
    ss["mode"] = mode

    with open(yaml_path, "w") as f:
        yaml.dump(raw, f, default_flow_style=False, sort_keys=False)

    # Update in-memory config
    config["source_selection"]["mode"] = mode

    return {"mode": mode}


@router.post("/source-selection/preference")
def set_source_selection_preference(body: PreferenceRequest):
    """Set cost/eco preference (0.0 = pure eco, 1.0 = pure cost)."""
    config = shared_state.get_config()
    if config is None:
        raise HTTPException(status_code=503, detail="Config not yet loaded")

    heat_sources = config.get("heat_sources", [])
    if len(heat_sources) < 2:
        raise HTTPException(status_code=400, detail="Single source install")

    preference = max(0.0, min(1.0, body.preference))

    import yaml
    import os

    yaml_paths = ["/config/qsh.yaml", "/data/qsh.yaml"]
    yaml_path = None
    for p in yaml_paths:
        if os.path.isfile(p):
            yaml_path = p
            break

    if yaml_path is None:
        raise HTTPException(status_code=500, detail="Config file not found")

    with open(yaml_path, "r") as f:
        raw = yaml.safe_load(f)

    ss = raw.setdefault("source_selection", {})
    ss["preference"] = round(preference, 2)

    with open(yaml_path, "w") as f:
        yaml.dump(raw, f, default_flow_style=False, sort_keys=False)

    # Update in-memory config
    config["source_selection"]["preference"] = round(preference, 2)

    return {"preference": round(preference, 2)}
