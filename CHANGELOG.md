# Changelog

All notable changes to QSH are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.1.1] — 2026-04-11

### CI/CD
- Switched multi-arch Docker build to native arm64 runners (`ubuntu-24.04-arm`), eliminating QEMU emulation
- Split build into three parallel jobs: `build-amd64`, `build-arm64`, and `merge-manifest` using the by-digest push pattern
- Per-arch GitHub Actions layer caching (`scope=linux-amd64`, `scope=linux-arm64`) for independent cache lanes
- Bumped all workflow actions to Node.js 24-compatible versions (`checkout@v5`, `setup-buildx-action@v4`, `login-action@v4`, `metadata-action@v6`, `build-push-action@v7`, `upload/download-artifact@v4`) ahead of the June 2026 Node.js 20 deprecation
- Reduces worst-case build time from 60+ minutes under QEMU to ~5 minutes on native runners

## [1.1.0] — 2026-04-11

### CI/CD
- GitHub Actions workflow to build and publish multi-arch Docker images (`linux/amd64`, `linux/arm64`) to `ghcr.io/stuartj1-1981/qsh` on version tag push
- Assembly-only build reusing the pre-compiled `.so` artefacts synced by `release-sync.sh` — no compilation in CI
- Image tagged with git tag, semantic version from `config.json`, and `latest`
- GitHub Actions build cache enabled for faster subsequent builds

## [1.0.0] — 2026-04-11

First public release.

### Core
- Adaptive heat pump optimisation with per-room thermal parameter learning
- System identification: heat loss coefficient (U), thermal mass (C), and solar gain factor learned from passive observation
- Passive cooling analyser for thermal mass convergence via Newton's law decay fitting
- Weather-compensated flow temperature control
- Reinforcement learning layer with deterministic-to-RL blend progression
- Multi-zone valve control (Zigbee TRVs via ZCL `pi_heating_demand`, setpoint manipulation)
- Seasonal operating modes: winter (anti-frost equilibrium), shoulder (demand-gated), summer (seasonal shutdown)

### Deployment
- Home Assistant add-on (amd64, aarch64)
- MQTT standalone via Docker (any MQTT broker)
- Web-based setup wizard with entity scanning (HA) and topic mapping (MQTT)

### Web Dashboard
- Real-time room status, temperatures, and system overview
- Per-room detail with thermal parameter visibility (engineering mode)
- Historian page with trend display and optional InfluxDB integration
- Comfort target control with per-room adjustment
- Schedule editor with HA Schedule integration
- Away mode with recovery tracking
- Shadow/learning mode toggle
- Dark mode

### Telemetry
- Optional fleet telemetry with explicit consent control (default on, opt-out via wizard or settings). See privacy policy for details
- Anonymised daily payload: thermal parameters, energy metrics, HP characteristics
- CloudFlare Worker + R2 transport
- Install UUID identification (no personal data)

### Operations
- Configuration backup and restore (export ZIP, merge or replace on import)
- InfluxDB historian integration (optional, write-only batch client)
- 24-hour trend buffer with startup seed from InfluxDB
