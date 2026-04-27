# syntax=docker/dockerfile:1.6
#
# Dockerfile.public — QSH public Docker image (INSTRUCTION-66C).
#
# Assembler only — no compilation here. Per-submodule .so files are
# compiled by Dockerfile.compile (66A) and synced into qsh/ by
# release-sync.sh (66B). Both arches' .so files coexist in the repo;
# this Dockerfile COPYs the full qsh/ tree and prunes the non-target
# arch at build time via TARGETARCH.
#
# Layout after COPY: qsh/__init__.py (stub, source), qsh/drivers/ and
# qsh/api/ (source), plus N per-submodule .so files per arch under
# qsh/ and its subdirectories (pipeline/, occupancy/, etc.).
#
# Supported platforms: linux/amd64, linux/arm64.
# Build: docker buildx build --platform linux/amd64,linux/arm64 .
#
# Runtime base MUST match scripts/release/Dockerfile.compile
# (python:3.12-slim) to guarantee Python ABI + libc compatibility.
#
# release-sync.sh renames this file to `Dockerfile` in the public repo.

# --- Stage 1: frontend build ---
FROM node:20-alpine AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# --- Stage 2: runtime ---
FROM python:3.12-slim AS runtime

# Docker sets TARGETARCH automatically when invoked via buildx.
# Supported values: amd64, arm64.
ARG TARGETARCH

# Runtime Python dependencies.
# Installed inline (no requirements.txt in the public sync). torch 2.11.0
# defaults to CUDA wheels on PyPI; --index-url pins the CPU-only wheel
# index for both architectures.
RUN pip install --no-cache-dir \
        torch==2.11.0+cpu --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir \
        numpy==1.26.4 networkx requests pyyaml influxdb websocket-client \
        paho-mqtt aiomqtt fastapi==0.115.0 uvicorn[standard]==0.30.0 \
        python-multipart

WORKDIR /app

# Per-submodule per-arch .so files plus source stub, drivers, api, data.
# Both arches' .so coexist in qsh/ after release-sync.sh (66B).
# Arch selection happens in the next RUN step, not at COPY time.
COPY qsh/ /app/qsh/
COPY config.json /app/config.json

# Per-arch .so pruning: delete every .so that does not match TARGETARCH.
# The nested package layout (qsh/pipeline/, qsh/occupancy/, etc.) means
# .so files live at multiple directory levels — recursive find is required.
#
# Arch-name mapping (Docker TARGETARCH → Python platform tag):
#   amd64 → x86_64-linux-gnu
#   arm64 → aarch64-linux-gnu
# This mapping is duplicated in release-sync.sh. Changes must be in lockstep.
RUN set -eu && \
    case "${TARGETARCH}" in \
      amd64) KEEP_SUFFIX="cpython-312-x86_64-linux-gnu.so" ;; \
      arm64) KEEP_SUFFIX="cpython-312-aarch64-linux-gnu.so" ;; \
      *) echo "FATAL: unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    find /app/qsh -type f -name '*.cpython-312-*.so' \
      ! -name "*${KEEP_SUFFIX}" -print -delete && \
    rm -f /app/qsh/SO_MANIFEST.sha256 && \
    echo "Kept .so files for ${TARGETARCH}:" && \
    find /app/qsh -type f -name "*${KEEP_SUFFIX}" | sort

# Frontend dist from stage 1. Placed at /app/dist so that
# qsh/api/server.py's `pkg_root / "dist"` primary lookup resolves.
# pkg_root = Path(__file__).parent.parent.parent = /app, so /app/dist.
COPY --from=frontend /build/dist /app/dist

# --- IP integrity + structure assertion (build-time gate) ---
# Verify: drivers/ and api/ ship as source, stub __init__.py present,
# at least one .so exists (per-submodule compile produced artefacts),
# and no operational .py files leaked outside the source-boundary dirs.
RUN test -d /app/qsh/drivers && \
    test -d /app/qsh/api && \
    test -f /app/qsh/__init__.py && \
    SO_COUNT=$(find /app/qsh -type f -name '*.so' | wc -l) && \
    test "$SO_COUNT" -gt 0 && \
    LEAKED=$(find /app/qsh -name "*.py" \
        ! -path "*/drivers/*" \
        ! -path "*/api/*" \
        ! -name "__init__.py" \
        ! -name "__main__.py" | wc -l) && \
    test "$LEAKED" -eq 0 && \
    echo "IP boundary assertion PASS (${SO_COUNT} .so files, zero leakage)"

EXPOSE 9100
CMD ["python", "-m", "qsh"]

# --- Stage 3: validate (T-23 / T-24 deep import + boot-and-probe) ---
# This stage is gating-only. Filesystem mutations (template YAML write,
# /tmp state, ports bound) DO NOT propagate to the runtime image.
# Build invocation must use --target validate to gate; the published image
# is the `runtime` stage. See scripts/release/RELEASE-RUNBOOK.md Step 3.5.
FROM runtime AS validate

# Allow override for QEMU/ARM cold-boot under buildx (V2 Finding 10).
ARG QSH_HEALTH_PROBE_TIMEOUT_S=60
ENV QSH_HEALTH_PROBE_TIMEOUT_S=${QSH_HEALTH_PROBE_TIMEOUT_S}

# Check A — deep import smoke. Imports qsh.config_io directly (the load-bearing
# line — see INSTRUCTION-132 V2 Finding HIGH-1) and qsh.api.server, qsh.main,
# qsh.telemetry. Importing start_api_server transitively loads every route
# module via server.py line 15's `from .routes import ...` — V2 Finding 7
# eliminated the previously-redundant explicit route-import line.
RUN python -c "\
import qsh.config_io; \
from qsh.api.server import start_api_server; \
import qsh.main; \
import qsh.telemetry; \
from qsh.sysid import SystemIdentifier; \
from qsh.control import determine_hp_mode; \
import qsh.pipeline; \
import qsh.occupancy; \
import qsh.drivers; \
print('T-23 / T-24 Check A deep import smoke PASS')"

# Check B — boot-and-probe. Boots `python -m qsh` (which takes the template-mode
# branch in main.py line 206 because no /config/qsh.yaml exists in the build
# container) and probes /api/health via urllib (no curl, no apt — V2 Finding 2).
# urlopen raises on non-2xx; success exits 0; timeout exits 1.
#
# Port 9100 collision (V2 Finding 9): buildx allocates a fresh network namespace
# per build step; 127.0.0.1:9100 inside this container does NOT share state with
# the host or with concurrent buildx invocations. Bind is local-only and isolated.
RUN set -eu && \
    python -m qsh & \
    QSH_PID=$! && \
    DEADLINE=$(($(date +%s) + QSH_HEALTH_PROBE_TIMEOUT_S)) && \
    while [ $(date +%s) -lt $DEADLINE ]; do \
        sleep 1; \
        if python -c "import urllib.request, sys; urllib.request.urlopen('http://127.0.0.1:9100/api/health', timeout=2).read(); sys.exit(0)" 2>/dev/null; then \
            ELAPSED=$((QSH_HEALTH_PROBE_TIMEOUT_S - (DEADLINE - $(date +%s)))); \
            echo "T-24 Check B boot-and-probe smoke PASS (after ${ELAPSED}s)"; \
            kill $QSH_PID 2>/dev/null; wait $QSH_PID 2>/dev/null || true; \
            exit 0; \
        fi; \
    done; \
    echo "T-24 Check B boot-and-probe smoke FAIL — /api/health did not respond within ${QSH_HEALTH_PROBE_TIMEOUT_S}s" >&2; \
    kill $QSH_PID 2>/dev/null || true; \
    exit 1
