"""FastAPI application factory and background thread launcher."""

import os
import threading
import logging

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from pathlib import Path

from .routes import status, config, sysid, health, wizard, rooms, backup, schedule, away, control, history, entities, trends, historian, balancing, source_selection, comfort_schedule
from .ws import router as ws_router

logger = logging.getLogger(__name__)

API_PORT = 9100


class IngressMiddleware(BaseHTTPMiddleware):
    """Extract X-Ingress-Path header set by HA Supervisor and cache it."""

    async def dispatch(self, request, call_next):
        ingress_path = request.headers.get("X-Ingress-Path", "")
        if ingress_path:
            os.environ.setdefault("INGRESS_ENTRY", ingress_path)
        response = await call_next(request)
        return response


class IngressSecurityMiddleware(BaseHTTPMiddleware):
    """Restrict direct access when ingress is enabled.

    Only allows connections from the HA Supervisor network (172.30.32.x)
    and localhost. Set QSH_ALLOW_DIRECT_ACCESS=1 to bypass for development.
    """

    SUPERVISOR_NETWORK = "172.30.32."
    ALLOWED_DIRECT = {"127.0.0.1", "::1", "localhost"}

    async def dispatch(self, request, call_next):
        if os.environ.get("QSH_ALLOW_DIRECT_ACCESS") == "1":
            return await call_next(request)
        if not os.environ.get("INGRESS_ENTRY"):
            return await call_next(request)
        client_ip = request.client.host if request.client else ""
        if (client_ip.startswith(self.SUPERVISOR_NETWORK)
                or client_ip in self.ALLOWED_DIRECT):
            return await call_next(request)
        return Response("Forbidden — use Home Assistant UI", status_code=403)


def create_app() -> FastAPI:
    """Build the FastAPI application with all routes."""
    app = FastAPI(
        title="QSH Web UI",
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url=None,
    )

    # Middleware — order matters: outermost (first added) runs first.
    # Security gate runs before anything else.
    app.add_middleware(IngressSecurityMiddleware)
    app.add_middleware(IngressMiddleware)

    # CORS — allow local access from dev server (Vite runs on 5173)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Ingress info endpoint — frontend calls this once on startup
    @app.get("/api/ingress")
    def get_ingress_info():
        ingress_entry = os.environ.get("INGRESS_ENTRY", "")
        return {
            "ingress": bool(ingress_entry),
            "base_path": ingress_entry,
        }

    # REST routes
    app.include_router(health.router, prefix="/api", tags=["health"])
    app.include_router(status.router, prefix="/api", tags=["status"])
    app.include_router(config.router, prefix="/api", tags=["config"])
    app.include_router(sysid.router, prefix="/api", tags=["sysid"])
    app.include_router(wizard.router, prefix="/api", tags=["wizard"])
    app.include_router(rooms.router, prefix="/api", tags=["rooms"])
    app.include_router(backup.router, prefix="/api", tags=["backup"])
    app.include_router(schedule.router, prefix="/api", tags=["schedule"])
    app.include_router(away.router, prefix="/api", tags=["away"])
    app.include_router(control.router, prefix="/api", tags=["control"])
    app.include_router(history.router, prefix="/api", tags=["history"])
    app.include_router(entities.router, prefix="/api", tags=["entities"])
    app.include_router(trends.router, prefix="/api", tags=["trends"])
    app.include_router(historian.router, prefix="/api", tags=["historian"])
    app.include_router(balancing.router, prefix="/api", tags=["balancing"])
    app.include_router(source_selection.router, prefix="/api", tags=["source_selection"])
    app.include_router(comfort_schedule.router, prefix="/api", tags=["comfort_schedule"])

    # WebSocket
    app.include_router(ws_router)

    # Serve built React frontend (if dist/ exists)
    # Docker:  /qsh/api/server.py  → parent x3 = /  → /dist
    # Local:   quantum_swarm_heating/qsh/api/server.py
    #          → parent x3 = quantum_swarm_heating/ → quantum_swarm_heating/dist
    #          (vite builds into quantum_swarm_heating/frontend/dist → copied to /dist in Docker,
    #           or found via the fallback at quantum_swarm_heating/frontend/dist locally)
    pkg_root = Path(__file__).parent.parent.parent          # / or quantum_swarm_heating/
    dist_path = pkg_root / "dist"                           # Docker: /dist
    if not dist_path.is_dir():
        dist_path = pkg_root / "frontend" / "dist"          # Local dev fallback
    if dist_path.is_dir():
        app.mount("/", StaticFiles(directory=str(dist_path), html=True), name="frontend")

    return app


def start_api_server():
    """Launch the API server in a daemon thread.

    Called from main.py during startup, BEFORE the pipeline loop.
    The thread is daemonic — it dies when the main thread exits.
    """
    app = create_app()

    def _run():
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=API_PORT,
            log_level="warning",
            access_log=False,
        )

    thread = threading.Thread(target=_run, name="qsh-api", daemon=True)
    thread.start()
    logger.info("QSH Web UI API server started on port %d", API_PORT)
    return thread
