"""Room CRUD — add, update, remove rooms from config."""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Union, Dict, List

from .config import _read_modify_write

router = APIRouter(tags=["rooms"])

logger = logging.getLogger(__name__)


VALID_EMITTER_TYPES = {"radiator", "ufh", "fan_coil"}
VALID_BOUNDARY_TYPES = {"wall", "open", "party", "floor_ceiling"}
RESERVED_FACE_KEYWORDS = {"external", "ground", "roof", "unheated"}

WALL_FACE_KEYS = ("north_wall", "east_wall", "south_wall", "west_wall")
FLOOR_FACE_KEY = "floor"
CEILING_FACE_KEY = "ceiling"

# Allowed string literals per face
WALL_ALLOWED_LITERALS = {"external", "unheated"}
FLOOR_ALLOWED_LITERALS = {"ground", "unheated"}
CEILING_ALLOWED_LITERALS = {"roof", "unheated"}

FLOOR_MIN = -1
FLOOR_MAX = 5


class RoomBoundary(BaseModel):
    """A boundary face connecting to another room."""
    room: str
    type: str = "wall"

    @field_validator("room")
    @classmethod
    def room_not_reserved_keyword(cls, v: str) -> str:
        if v in RESERVED_FACE_KEYWORDS:
            raise ValueError(
                f"Room name '{v}' conflicts with reserved face-type keyword"
            )
        return v

    @field_validator("type")
    @classmethod
    def type_is_valid(cls, v: str) -> str:
        if v not in VALID_BOUNDARY_TYPES:
            raise ValueError(
                f"Invalid boundary type '{v}'. Valid: {sorted(VALID_BOUNDARY_TYPES)}"
            )
        return v


class RoomEnvelope(BaseModel):
    """6-face room envelope. Each face is a string literal, a RoomBoundary, or
    a list of RoomBoundary (multi-room reference, e.g. open-plan ceiling spanning
    multiple upstairs rooms). List[RoomBoundary] precedes RoomBoundary in the Union
    so Pydantic tries list parsing first.
    """
    north_wall: Optional[Union[List[RoomBoundary], RoomBoundary, str]] = None
    east_wall: Optional[Union[List[RoomBoundary], RoomBoundary, str]] = None
    south_wall: Optional[Union[List[RoomBoundary], RoomBoundary, str]] = None
    west_wall: Optional[Union[List[RoomBoundary], RoomBoundary, str]] = None
    floor: Optional[Union[List[RoomBoundary], RoomBoundary, str]] = None
    ceiling: Optional[Union[List[RoomBoundary], RoomBoundary, str]] = None

    @model_validator(mode="after")
    def validate_face_literals(self):
        for face_key in (*WALL_FACE_KEYS, FLOOR_FACE_KEY, CEILING_FACE_KEY):
            face = getattr(self, face_key)
            if face is None:
                continue
            if isinstance(face, str):
                if face_key in WALL_FACE_KEYS and face not in WALL_ALLOWED_LITERALS:
                    raise ValueError(
                        f"Wall face '{face_key}' has invalid literal '{face}'. "
                        f"Allowed: {sorted(WALL_ALLOWED_LITERALS)} or a room boundary object."
                    )
                if face_key == FLOOR_FACE_KEY and face not in FLOOR_ALLOWED_LITERALS:
                    raise ValueError(
                        f"Floor face has invalid literal '{face}'. "
                        f"Allowed: {sorted(FLOOR_ALLOWED_LITERALS)} or a room boundary object."
                    )
                if face_key == CEILING_FACE_KEY and face not in CEILING_ALLOWED_LITERALS:
                    raise ValueError(
                        f"Ceiling face has invalid literal '{face}'. "
                        f"Allowed: {sorted(CEILING_ALLOWED_LITERALS)} or a room boundary object."
                    )
                continue
            if isinstance(face, list):
                if len(face) == 0:
                    raise ValueError(f"Empty array is not valid for face '{face_key}'")
                if len(face) > 10:
                    raise ValueError(
                        f"Face '{face_key}' has {len(face)} room refs — maximum is 10"
                    )
                seen_rooms = set()
                for item in face:
                    if not isinstance(item, RoomBoundary):
                        raise ValueError(
                            f"Array face values must be room boundaries, got {type(item)}"
                        )
                    if item.room in seen_rooms:
                        raise ValueError(
                            f"Duplicate room '{item.room}' in face '{face_key}'"
                        )
                    seen_rooms.add(item.room)
                    if face_key in (FLOOR_FACE_KEY, CEILING_FACE_KEY) and item.type != "floor_ceiling":
                        raise ValueError(
                            f"Face '{face_key}' boundary type must be 'floor_ceiling', "
                            f"got '{item.type}' for room '{item.room}'"
                        )
        return self


class RoomConfig(BaseModel):
    area_m2: float
    facing: str = "interior"
    ceiling_m: float = 2.4
    floor: Optional[int] = None
    envelope: Optional[RoomEnvelope] = None
    emitter_kw: Optional[float] = None
    emitter_type: Optional[str] = None
    trv_entity: Optional[str] = None
    independent_sensor: Optional[str] = None
    heating_entity: Optional[str] = None
    control_mode: Optional[str] = None
    valve_hardware: Optional[str] = None
    valve_scale: Optional[int] = None

    @field_validator("floor")
    @classmethod
    def floor_in_range(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return v
        if not isinstance(v, int) or v < FLOOR_MIN or v > FLOOR_MAX:
            raise ValueError(
                f"floor must be an integer in range [{FLOOR_MIN}, {FLOOR_MAX}]"
            )
        return v


class RoomEnvelopeBulkItem(BaseModel):
    floor: Optional[int] = None
    envelope: Optional[RoomEnvelope] = None

    @field_validator("floor")
    @classmethod
    def floor_in_range(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return v
        if not isinstance(v, int) or v < FLOOR_MIN or v > FLOOR_MAX:
            raise ValueError(
                f"floor must be an integer in range [{FLOOR_MIN}, {FLOOR_MAX}]"
            )
        return v


class RoomEnvelopeBulkRequest(BaseModel):
    rooms: Dict[str, RoomEnvelopeBulkItem]


def _normalise_yaml_face_refs(face_val) -> list:
    """Return list of room-ref dicts from a face value (scalar or array)."""
    if isinstance(face_val, dict) and "room" in face_val:
        return [face_val]
    if isinstance(face_val, list):
        return [r for r in face_val if isinstance(r, dict) and "room" in r]
    return []


def _face_contains_room(face_val, room_name: str) -> bool:
    """Check if a face value (scalar, array, or string) references room_name."""
    if isinstance(face_val, dict) and face_val.get("room") == room_name:
        return True
    if isinstance(face_val, list):
        return any(isinstance(r, dict) and r.get("room") == room_name for r in face_val)
    return False


def _signal_restart():
    try:
        with open("/config/qsh_restart_requested", "w") as f:
            f.write("1")
    except OSError:
        pass


def _envelope_to_yaml(env: RoomEnvelope) -> dict:
    """Serialize a RoomEnvelope to a YAML-friendly dict.

    RoomBoundary instances become plain dicts; string literals stay as strings;
    List[RoomBoundary] becomes a list of dicts (collapsed to a scalar dict when
    the list has exactly one element, per parent spec §4); None faces are omitted.
    """
    out = {}
    for face_key in (*WALL_FACE_KEYS, FLOOR_FACE_KEY, CEILING_FACE_KEY):
        face = getattr(env, face_key)
        if face is None:
            continue
        if isinstance(face, list):
            items = []
            for rb in face:
                item = rb.model_dump(exclude_none=True)
                if face_key in (FLOOR_FACE_KEY, CEILING_FACE_KEY):
                    item["type"] = "floor_ceiling"
                items.append(item)
            out[face_key] = items[0] if len(items) == 1 else items
        elif isinstance(face, RoomBoundary):
            serialized = face.model_dump(exclude_none=True)
            if face_key in (FLOOR_FACE_KEY, CEILING_FACE_KEY):
                serialized["type"] = "floor_ceiling"
            out[face_key] = serialized
        else:
            out[face_key] = face
    return out


def _room_to_yaml(room: RoomConfig) -> dict:
    """Serialize a RoomConfig to a YAML-friendly dict, flattening nested models."""
    data = room.model_dump(exclude_none=True)
    if room.envelope is not None:
        data["envelope"] = _envelope_to_yaml(room.envelope)
    return data


def _face_literal_valid_for_key(face_key: str, literal: str) -> bool:
    if face_key in WALL_FACE_KEYS:
        return literal in WALL_ALLOWED_LITERALS
    if face_key == FLOOR_FACE_KEY:
        return literal in FLOOR_ALLOWED_LITERALS
    if face_key == CEILING_FACE_KEY:
        return literal in CEILING_ALLOWED_LITERALS
    return False


@router.post("/rooms/{room_name}")
def add_room(room_name: str, room: RoomConfig):
    """Add a new room to qsh.yaml."""
    if room.emitter_type is not None and room.emitter_type not in VALID_EMITTER_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid emitter_type '{room.emitter_type}'. Valid: {sorted(VALID_EMITTER_TYPES)}",
        )

    room_data = _room_to_yaml(room)

    def transform(raw: dict) -> dict:
        rooms = raw.setdefault("rooms", {})
        if room_name in rooms:
            raise ValueError(f"Room '{room_name}' already exists")
        rooms[room_name] = room_data
        return raw

    try:
        _read_modify_write(transform)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    _signal_restart()
    return {"created": room_name, "restart_required": True}


@router.put("/rooms/{room_name}")
def update_room(room_name: str, room: RoomConfig):
    """Update an existing room config."""
    if room.emitter_type is not None and room.emitter_type not in VALID_EMITTER_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid emitter_type '{room.emitter_type}'. Valid: {sorted(VALID_EMITTER_TYPES)}",
        )

    room_data = _room_to_yaml(room)

    def transform(raw: dict) -> dict:
        rooms = raw.get("rooms", {})
        if room_name not in rooms:
            raise KeyError(f"Room '{room_name}' not found")
        rooms[room_name] = room_data
        return raw

    try:
        _read_modify_write(transform)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e).strip("'\""))

    _signal_restart()
    return {"updated": room_name, "restart_required": True}


@router.delete("/rooms/{room_name}")
def delete_room(room_name: str):
    """Remove a room from config."""
    def transform(raw: dict) -> dict:
        rooms = raw.get("rooms", {})
        if room_name not in rooms:
            raise KeyError(f"Room '{room_name}' not found")
        del rooms[room_name]
        return raw

    try:
        _read_modify_write(transform)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e).strip("'\""))

    _signal_restart()
    return {"deleted": room_name, "restart_required": True}


@router.patch("/rooms/envelope")
def bulk_update_envelope(req: RoomEnvelopeBulkRequest):
    """Bulk update `floor` and `envelope` on multiple rooms.

    Validates all rooms exist, cross-room references are consistent,
    auto-populates symmetric ceiling/floor and compass-reciprocal wall faces,
    then writes to qsh.yaml in a single atomic transaction.
    """
    warnings: List[str] = []
    updated: List[str] = []

    incoming: Dict[str, RoomEnvelopeBulkItem] = req.rooms

    def transform(raw: dict) -> dict:
        rooms_raw = raw.setdefault("rooms", {})
        for room_name in incoming:
            if room_name not in rooms_raw:
                raise KeyError(room_name)

        # Build mutable envelope dicts from incoming + existing-on-disk so we can
        # apply auto-symmetry across the submitted set AND back-reference existing
        # envelopes for conflict detection.
        working_envelopes: Dict[str, Dict] = {}
        working_floors: Dict[str, Optional[int]] = {}

        for rn, room_cfg in rooms_raw.items():
            existing_env = room_cfg.get("envelope")
            if isinstance(existing_env, dict):
                working_envelopes[rn] = dict(existing_env)
            else:
                working_envelopes[rn] = {}
            fv = room_cfg.get("floor")
            working_floors[rn] = int(fv) if isinstance(fv, int) else None

        # Apply incoming updates
        for rn, item in incoming.items():
            if item.floor is not None:
                working_floors[rn] = item.floor
            if item.envelope is not None:
                working_envelopes[rn] = _envelope_to_yaml(item.envelope)

        # Validate cross-room references resolve to existing rooms; drop
        # self-references and unknown rooms; collapse single-element arrays.
        for rn, env in working_envelopes.items():
            for face_key, face_val in list(env.items()):
                refs = _normalise_yaml_face_refs(face_val)
                if not refs:
                    continue
                valid_refs = []
                for ref in refs:
                    peer = ref["room"]
                    if peer == rn:
                        warnings.append(
                            f"{rn}.{face_key} references itself — removing"
                        )
                        continue
                    if peer not in rooms_raw:
                        warnings.append(
                            f"{rn}.{face_key} references unknown room '{peer}'"
                        )
                        continue
                    valid_refs.append(ref)
                if not valid_refs:
                    del env[face_key]
                elif len(valid_refs) == 1:
                    env[face_key] = valid_refs[0]
                else:
                    env[face_key] = valid_refs

        # Auto-symmetry
        _apply_auto_symmetry(working_envelopes, rooms_raw, warnings)

        # Floor ↔ vertical consistency
        _validate_vertical_consistency(working_envelopes, working_floors, warnings)

        # Write back
        for rn in incoming:
            room_cfg = rooms_raw[rn]
            if working_floors.get(rn) is not None:
                room_cfg["floor"] = working_floors[rn]
            new_env = working_envelopes.get(rn)
            if new_env:
                room_cfg["envelope"] = new_env
            updated.append(rn)

        # Write back peer rooms whose envelopes were auto-populated
        for rn, env in working_envelopes.items():
            if rn in incoming or not env:
                continue
            existing = rooms_raw[rn].get("envelope")
            if existing != env:
                rooms_raw[rn]["envelope"] = env
                if rn not in updated:
                    updated.append(rn)

        return raw

    try:
        _read_modify_write(transform)
    except KeyError as e:
        missing = str(e).strip("'\"")
        raise HTTPException(status_code=404, detail=f"Room '{missing}' not found")

    _signal_restart()
    return {"updated": updated, "warnings": warnings, "restart_required": True}


def _apply_auto_symmetry(
    envelopes: Dict[str, Dict],
    rooms_raw: Dict,
    warnings: List[str],
) -> None:
    """Mutate `envelopes` to enforce bidirectional consistency.

    Only deterministic reciprocals (compass walls, ceiling↔floor) are auto-populated.
    Conflicts are logged as warnings, never overwritten.
    """
    reciprocal_wall = {
        "north_wall": "south_wall",
        "south_wall": "north_wall",
        "east_wall": "west_wall",
        "west_wall": "east_wall",
    }

    for rn, env in list(envelopes.items()):
        room_facing = (rooms_raw.get(rn) or {}).get("facing", "interior")
        is_interior = isinstance(room_facing, str) and room_facing.lower() == "interior"

        for face_key, face_val in list(env.items()):
            refs = _normalise_yaml_face_refs(face_val)
            if not refs:
                continue
            for ref in refs:
                peer = ref["room"]
                btype = ref.get("type", "wall")
                if peer not in envelopes:
                    continue
                peer_env = envelopes[peer]

                if face_key == CEILING_FACE_KEY:
                    peer_face = FLOOR_FACE_KEY
                    expected = {"room": rn, "type": "floor_ceiling"}
                elif face_key == FLOOR_FACE_KEY:
                    peer_face = CEILING_FACE_KEY
                    expected = {"room": rn, "type": "floor_ceiling"}
                elif face_key in reciprocal_wall:
                    if is_interior:
                        logger.info(
                            "Room '%s' is interior — wall auto-symmetry skipped "
                            "(user must declare both sides in Building Layout editor).",
                            rn,
                        )
                        continue
                    peer_facing = (rooms_raw.get(peer) or {}).get("facing", "interior")
                    if isinstance(peer_facing, str) and peer_facing.lower() == "interior":
                        logger.info(
                            "Peer '%s' is interior — wall auto-symmetry skipped for %s.%s",
                            peer, rn, face_key,
                        )
                        continue
                    peer_face = reciprocal_wall[face_key]
                    expected = {"room": rn, "type": btype}
                else:
                    continue

                existing_peer = peer_env.get(peer_face)
                if existing_peer is None:
                    peer_env[peer_face] = expected
                    logger.info(
                        "Auto-populated envelope: %s.%s → %s (symmetric from %s.%s)",
                        peer, peer_face, rn, rn, face_key,
                    )
                elif _face_contains_room(existing_peer, rn):
                    pass  # already references this room (scalar or within array)
                else:
                    suffix = (
                        " User must resolve in Building Layout editor."
                        if face_key in reciprocal_wall else ""
                    )
                    warnings.append(
                        f"Auto-symmetry conflict: {peer}.{peer_face} already assigned, "
                        f"cannot assign {rn}.{suffix}"
                    )


def _validate_vertical_consistency(
    envelopes: Dict[str, Dict],
    floors: Dict[str, Optional[int]],
    warnings: List[str],
) -> None:
    """Warn when a ceiling/floor reference contradicts declared storey numbers."""
    for rn, env in envelopes.items():
        my_floor = floors.get(rn)
        if my_floor is None:
            continue
        for ref in _normalise_yaml_face_refs(env.get(CEILING_FACE_KEY)):
            peer = ref["room"]
            peer_floor = floors.get(peer)
            if peer_floor is not None and peer_floor != my_floor + 1:
                warnings.append(
                    f"Floor mismatch: {rn}.ceiling → {peer} but "
                    f"{rn}.floor={my_floor} and {peer}.floor={peer_floor} "
                    f"(expected {my_floor + 1})"
                )
        for ref in _normalise_yaml_face_refs(env.get(FLOOR_FACE_KEY)):
            peer = ref["room"]
            peer_floor = floors.get(peer)
            if peer_floor is not None and peer_floor != my_floor - 1:
                warnings.append(
                    f"Floor mismatch: {rn}.floor → {peer} but "
                    f"{rn}.floor={my_floor} and {peer}.floor={peer_floor} "
                    f"(expected {my_floor - 1})"
                )
