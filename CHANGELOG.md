# Changelog

All notable changes to QSH are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.3.0] — 2026-05-03

### Changed
- Tariff: rework with support for EDF and Gas dynamic tariffs
- Config: zones with no temperature sensor are now supported

### Fixed
- Telemetry: retry improvements

## [1.2.15] — 2026-05-01

### Fixed
- App restart hardening
- Wizard improvements

## [1.2.14] — 2026-04-30

### Fixed
- Wizard: restart issue and improved entity scan

## [1.2.13] — 2026-04-29

### Fixed
- HW active fixes
- Empty default + whitespace fix

## [1.2.12] — 2026-04-28

### Fixed
- MQTT: sensor config backfill
- Wizard: scan feedback, mandatory-point marker, and progress-bar fix
- Crash: incompatible-config fix

## [1.2.11] — 2026-04-28

### Fixed
- Setup Mode: white-screen crash on first boot resolved.

### Changed
- UX: heating indication is suppressed when the heat source is not on.

## [1.2.9] — 2026-04-27

### Fixed
- Wizard: stop config being erased on deploy
- Data Sharing: link to policy corrected

### Changed
- Web UX: assorted UI improvements

## [1.2.8.1] — 2026-04-27

### Fixed
- Complete fix for the cold crash caused in v1.2.7

## [1.2.7] — 2026-04-25

### Fixed
- Telemetry: fail-silently scenario corrected so transient telemetry errors no longer surface as user-visible failures

## [1.2.6] — 2026-04-25

### Fixed
- Font and backend fixes for MQTT installs

## [1.2.5] — 2026-04-23

### Changed
- Hot Water cycle detection sensor can now be a boolean

## [1.2.4] — 2026-04-22

### Fixed
- MQTT: stub fix
- Mode: restart persistence improvement
- Historian: mode fix

## [1.2.3] — 2026-04-22

### Changed
- Split Building Layout save into separate **Save** and **Save & Apply** buttons so edits can be captured without triggering an immediate add-on restart

### Fixed
- Auto-symmetry conflict that wrongly blocked multiple rooms from sharing the same floor/ceiling boundary (issues #29, #30)

## [1.2.2] — 2026-04-21

### Changed
- Octopus Energy API hardening; back end overhaul
- Gas/LPG heat source UX improvements

## [1.2.1] — 2026-04-19

### Fixed
- UX: fix to building layout
- MQTT: persistence fix on addition of sensors

## [1.2.0] — 2026-04-18

### Added
- Room topology configuration: new configuration page in settings to define adjacent rooms

## [1.1.16] — 2026-04-16

### Changed
- Improved MQTT signal quality reporting for multi-source devices (best-of resolution)
- Tariff rate display now matches Octopus 2dp precision

## [1.1.15] — 2026-04-16

### Changed
- MQTT driver now persists previous mode and comfort temperature across restarts
- Minor UX polish and MQTT outdoor-temp validation

## [1.1.14] — 2026-04-16

### Changed
- Telemetry cadence improvements
- MQTT signal quality improvements
- UX improvements

## [1.1.13] — 2026-04-15

### Changed
- MQTT driver hardening
- UX: MQTT fixes

## [1.1.12] — 2026-04-15

### Changed
- MQTT: logging and staleness optimisation
- UX: minor graphic improvements

## [1.1.11] — 2026-04-14

### Fixed
- MQTT variant fixes
- Telemetry send optimised

## [1.1.10] — 2026-04-13

### Changed
- Web UX rebuild for MQTT variant

## [1.1.9] — 2026-04-13

### Fixed
- MQTT driver fix

## [1.1.8] — 2026-04-13

### Fixed
- Concurrent config write race condition
- Telemetry endpoints

## [1.1.7] — 2026-04-13

### Fixed
- Prevent system crash if MQTT (standalone) is not available on startup

## [1.1.6] — 2026-04-12

### Added
- Option to use backup in Wizard

## [1.1.5] — 2026-04-12

### Fixed
- Release-sync regressions
- `__main__.py` fix

## [1.1.4] — 2026-04-12

### Fixed
- Restore of existing configuration

## [1.1.3] — 2026-04-12

### Fixed
- Add `if __name__ == "__main__":` guard to `qsh/__main__.py` so the Dockerfile
  entrypoint shim verification step (`from qsh.__main__ import main`) imports the
  function without starting the full application. Without the guard, the build-time
  `RUN` step launched the API server and hung indefinitely, blocking all CI builds
  after the INSTRUCTION-76A changes landed on `main`.

## [1.1.2] — 2026-04-11

### Fixed
- Fix `python -m qsh.main` startup failure on Home Assistant OS reported by beta testers (GitHub Issue #4). The compiled `main.cpython-312-*.so` extension module cannot be executed via `python -m` because Python cannot extract a code object from a compiled extension, raising "No code object available for qsh.main"
- Add `qsh/__main__.py` source shim that imports and calls `main()` from the compiled module, shipped as source alongside `__init__.py`
- Change Dockerfile `CMD` from `python -m qsh.main` to `python -m qsh` so the shim is invoked instead of the compiled extension
- Extend Dockerfile IP boundary assertion to permit `__main__.py` as a source-boundary exception alongside `__init__.py`
- Add build-time entrypoint shim smoke test that exercises the `__main__.py` → compiled `main.so` import chain so the original failure mode is caught before an image reaches the registry
- Replace dead `python3 /qsh_script.py` reference in `run.sh` with `exec python -m qsh`, matching the Dockerfile CMD and using `exec` for proper signal handling; mark `run.sh` executable so HA add-on scaffolds that invoke it directly don't fail

### Deployment
- Add `"image": "ghcr.io/stuartj1-1981/qsh"` to `config.json` so Home Assistant Supervisor pulls the pre-built multi-arch image from ghcr.io instead of rebuilding the Dockerfile locally on beta testers' hardware. Without this field the INSTRUCTION-75 CI pipeline was effectively bypassed on every install

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
