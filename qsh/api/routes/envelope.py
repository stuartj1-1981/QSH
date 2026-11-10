"""INSTRUCTION-620A — the heat source efficiency envelope, read and reset.

Read only on the control path: the learner commands nothing. The payload is
`EfficiencyEnvelope.report()`: the install class and the configured entities,
the two surfaces with their counts and maturity, the derived floor and ceiling.
"""

from fastapi import APIRouter, HTTPException

from ..state import shared_state

router = APIRouter()


@router.get("/envelope")
def get_envelope():
    """The learned efficiency envelope of the active heat source."""
    envelope = shared_state.get_envelope()
    if envelope is None:
        raise HTTPException(status_code=503, detail="Efficiency envelope not yet initialised")
    return envelope.report()


@router.post("/envelope/reset")
def reset_envelope():
    """Discard the learned surfaces and start again (the configured source is kept)."""
    envelope = shared_state.get_envelope()
    if envelope is None:
        raise HTTPException(status_code=503, detail="Efficiency envelope not yet initialised")
    envelope.reset()
    return {"status": "reset", "install_class": envelope.install_class,
            "power_entity": envelope.power_entity}
