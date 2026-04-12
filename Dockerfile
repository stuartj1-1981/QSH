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

# --- T-13 production-layout import smoke test (build-time gate) ---
# Verifies the per-submodule .so files import correctly on this platform.
# A bad image never reaches the registry — this RUN fails the build.
RUN python -c "\
import qsh; \
from qsh.sysid import SystemIdentifier; \
from qsh.control import determine_hp_mode; \
import qsh.pipeline; \
import qsh.occupancy; \
import qsh.drivers; \
import qsh.api; \
print('T-13 production-layout import smoke test PASS')"

EXPOSE 9100
CMD ["python", "-m", "qsh.main"]
