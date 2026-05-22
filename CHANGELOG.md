# Changelog

## [Unreleased]

## [1.4.6] — 2026-05-22

### Added
- Allostatic load surface: cumulative thermal-stress indicator
  tracking how hard the heating system is working over time.
  Visible in the historian and surfaced via the API; raises an
  alarm when sustained load exceeds threshold.
- Source selection now consults a per-fuel rate map when scoring
  configured heat sources — pricing for each fuel type is
  considered independently rather than via a single composite
  rate.
- Hot water configuration values defined in your YAML config now
  flow through to runtime, so HW behaviour is configurable
  end-to-end without code changes.

### Changed
- Energy controller updated to consume the per-fuel rate map for
  source scoring decisions.
- Cascade and flow controllers now consider sustained allostatic
  load when choosing setpoints, behaving more conservatively under
  prolonged stress.

## [1.4.5] — 2026-05-20

### Added
- Home page: "Effective X.X°C — N of M rooms overridden" sub-line
  appears beneath the "At Comfort" badge during comfort-schedule
  windows, when one or more rooms have diverged from the commanded
  comfort target.
- Settings page surfaces the last permanent telemetry-push failure
  with the server's rejection reason, instead of only showing that
  a push failed.
- Source selection now considers the active tariff window when
  choosing between configured heat sources.

### Changed
- Hot water source detection unified across heating modes for more
  consistent behaviour on Home Assistant installs.
- Live page updates render faster — eliminated a per-cycle render
  cascade across the Live subtree.
- Schedule resolvers now treat times as explicit timezone-aware
  values, eliminating DST-transition ambiguity.

### Fixed
- Comfort schedules now propagate correctly to all rooms on MQTT
  installs, even when individual rooms have persisted thermostat
  targets. Rooms with a deliberate per-room override continue to
  be respected.
- Tooltips no longer clip at the right or bottom screen edges.

## [1.4.4] — 2026-05-18

### Added
- Boiler input power readings flow through Home Assistant and MQTT
  drivers for per-source energy tracking on gas boiler installs

### Changed
- Counterfactual recommendations engine now active in production
  (Docker image grows ~30–40 MB on both arches to bundle scipy)

### Fixed
- Mode arbiter no longer forces continuous HP run when demand is
  below the heat pump's minimum modulation point — eliminates
  night-time overshoot of comfort targets
- Mode write readback alarm threshold now scales with the configured
  debounce window instead of firing prematurely on tight write
  budgets

## [1.4.3] — 2026-05-17

### Added
- GSHP (ground-source heat pump) as a heat source type, with full
  wizard, settings, and telemetry support
- Per-source energy and cost bucketing for multi-source installs
- TopicPicker now supports fuel/carbon entity fields with JSON
  payload extraction

### Changed
- Mobile-optimised forecast page (375px portrait)

## [1.4.2] — 2026-05-16

### Fixed
- Dual heat source acquisition pipeline: per-source sensor selector,
  MQTT placeholder differentiation, duplicate-topic PATCH guard
  (INSTRUCTION-241A, INSTRUCTION-241B, INSTRUCTION-241C)
- Wizard per-source sensor tab routing for multi-heat-source configs

## [1.4.1] — 2026-05-16

### Added
- Multi-heat-source wizard + Settings editor (INSTRUCTION-237A,
  INSTRUCTION-237B) — plural `heat_sources` array with per-source
  carbon factor (BEIS defaults as placeholders for gas/LPG/oil), max
  source count enforced via `MAX_HEAT_SOURCES`, plural-first hydration
  through validate/deploy/scan-MQTT
- HTTP 400 short-circuit in `/api/wizard/deploy` when `heat_sources`
  list is empty (INSTRUCTION-237A V2 G-N1)

### Changed
- Mobile sidebar scrollable with pinned header/footer
  (INSTRUCTION-238) — `flex-1 min-h-0 overflow-y-auto overscroll-contain`
  on nav, `shrink-0` on logo and section footer
- History seed window widened from 24 h to 168 h
  (`SEED_WINDOW_HOURS = (MAX_ENTRIES * 30) // 3600`, INSTRUCTION-239),
  derived from deque capacity × cycle period to fail loudly on drift
- Engineering RL chart titles drop "(48h)" suffix that misrepresented
  the actual rolling window (INSTRUCTION-239)

### Fixed
- First-cycle seed ordering: historian seed completes before the first
  cycle history append, preventing the seeded cycle from being evicted
  from the buffer (INSTRUCTION-240)
- Wizard setup-mode redirect tightened — `App.setup-mode-routing.test`
  covers the case where config retains placeholder markers on restart
  (INSTRUCTION-240)

## [1.4.0] — 2026-05-15

Major feature release. 132 commits since 1.3.7. Headline work is the
DFAN (Dynamic Forecast-Aware Network) forecast tranche, the forecast
subsystem refactor, multi-emitter direct-TRV zone support, manual
override at the dispatch layer, and hybrid HP+boiler heat-source
handover.

### Added — DFAN forecast-aware control
- Forecast context, master-enable, confidence primitives (INSTRUCTION-200)
- Forecast scalars + per-room dicts (INSTRUCTION-198)
- Forecast predictor + drift detector, relocated to `qsh/projection/` per
  T-31 production-code import-graph constraint (INSTRUCTION-199)
- Forecast history + reconciliation (INSTRUCTION-201A)
- Counterfactual + RL evaluation infrastructure (INSTRUCTION-201B)
- DFAN alarms A + B as notifications (not protective trips) (INSTRUCTION-201C)
- RecoveryScheduler forecast-aware short-circuit (INSTRUCTION-202)
- ShoulderController forecast-aware shutdown bias (INSTRUCTION-203)
- TariffOptimiser forecast-load qualifier detection (INSTRUCTION-204)
  + qualifier→sweep wiring (INSTRUCTION-213)
- ValveController solar attenuation, post-dissipation, TRV-setpoint-only
  (INSTRUCTION-205)
- FlowController forecast-aware setpoint relaxation (INSTRUCTION-206)
- RL observation vector + state-dim coupled reset (INSTRUCTION-207A)
- RL single-writer migration + composition unification (INSTRUCTION-207B)
- DFAN forecast WebUX backend foundation (INSTRUCTION-208A)
- DFAN forecast frontend types + 5 hooks (INSTRUCTION-208B)
- DFAN forecast frontend components (INSTRUCTION-208C)
- DFAN forecast page composition + routing (INSTRUCTION-208D)
- DFAN forecast shared helpers (INSTRUCTION-209)
- ShoulderController forecast-aware restart bias (INSTRUCTION-212)
- API: DFAN forecast carriers in WebSocket envelope (INSTRUCTION-226)

### Added — Forecast subsystem refactor
- ForecastProvider Protocol seam (INSTRUCTION-220A)
- HAForecastProvider + FailureTracker (INSTRUCTION-220B)
- MQTTForecastProvider + topic schema + config wiring (INSTRUCTION-220C)
- ForecastController migration + pure parse/compute/state +
  MockForecastProvider (INSTRUCTION-220D)
- Defect 1 persistence fix + legacy WeatherForecaster deletion
  (INSTRUCTION-220E)
- Public-beta UX cleanup (INSTRUCTION-223)
- Section renumber + tooltips + HelpTip + t_indoor guard (INSTRUCTION-227A)
- Sysid+forecast: solar capacity observer + API exposure (INSTRUCTION-227B)
- Projection: kWp + time-base unit fix at three rate functions
  (INSTRUCTION-227C)

### Added — Multi-emitter direct TRV zones
- HA driver fan-out (INSTRUCTION-222A)
- MQTT driver fan-out (INSTRUCTION-222B)
- Per-emitter valve-position read-side fan-out — HA (INSTRUCTION-224B),
  MQTT (INSTRUCTION-224C)
- CycleSnapshot per-emitter field + `qsh_emitter` historian measurement
  (INSTRUCTION-224D)
- UI: per-emitter display in RoomDetail + MQTT list editor + Historian
  emitter filter (INSTRUCTION-224E)

### Added — Manual override (PCS7 AUTO/MANUAL parity)
- Manual-state foundation + HA driver intercept at direct-TRV dispatch
  layer per INSTRUCTION-225A carve-out
- MQTT driver MANUAL override parity (INSTRUCTION-225B)
- `/api/manual` REST + `CycleSnapshot.manual_state` (INSTRUCTION-225C)
- Engineering Valves page + MANUAL badge/strip (INSTRUCTION-225D)

### Added — Hybrid HP+boiler heat source
- Per-source heat-source dispatch on HA and MQTT (INSTRUCTION-228A)
- Source-selection surfaced in Settings and Home banner (INSTRUCTION-228B)
- Hybrid HP+boiler handover integration tests + owner smoke harness
  (INSTRUCTION-228C)

### Added — EventAnnunciator migration (T-33 + T-34)
- EventAnnunciator service and Controller shims (INSTRUCTION-221A)
- Pipeline migration (INSTRUCTION-221B)
- Drivers migration (INSTRUCTION-221C)
- Utility modules migration (INSTRUCTION-221D)
- Remove deprecated primitives + final measurement (INSTRUCTION-221E)

### Added — Other
- Vendor write-budget knob — backend (INSTRUCTION-216A), frontend +
  wizard UI (INSTRUCTION-216B)
- DHW signal inputs consolidated under Settings → Hot Water
  (INSTRUCTION-236)
- Engineering page section and column tooltips (INSTRUCTION-214)
- SCOP CH sparkline via `hw_active` tag filter (INSTRUCTION-215)
- Building 3D layout: lift 2-floor cap (INSTRUCTION-235)
- Live View canvas COP gated on `performance.source` (INSTRUCTION-232)

### Fixed
- Octopus tariff: gas prefix gate strips rate-class + accepts current
  SILVER family (INSTRUCTION-219)
- Octopus tariff: gate routing on `hp_euid`, not tariff key
  (INSTRUCTION-234)
- HA driver: `heating_entity` / `trv_entity` list-form contract
  (INSTRUCTION-231A-D)
- HA driver: type-guard `heating_entity` at three layers
  (INSTRUCTION-230)
- HA driver: restore legacy heating-entity fallback for declared-stems
  case (INSTRUCTION-229)
- MQTT driver: first-fresh valve aggregation with last-winner recovery
  (INSTRUCTION-231B)
- Frontend: DFAN Master Enable toggle URL (INSTRUCTION-218)
- Settings: TRV Name field clearable; hidden for multi-emitter zones
- None-mode: inject inferred-open valve fraction at call sites
- Guard scipy import + flip `from_dict` `step_source` default
  (INSTRUCTION-217)
- Historian COP write — live-source gate (INSTRUCTION-211)
- Forecast logging — unavailable edge-detect (HA + MQTT parity)
  (INSTRUCTION-210)

### Release-pipeline
- Ship `qsh.forecast` and `qsh.forecast.providers` as packages (operational
  hotfix during 1.4.0 release execution — submodule-compile-list,
  release-sync, check_import_integrity, Dockerfile.public smoke test
  all updated to mirror the existing pattern for occupancy / pipeline /
  projection / tariff package shipping)

## [1.3.6] — 2026-05-08

### Fixed
- Octopus tariff: open-ended slot handling for fixed-rate tariffs and
  indefinite `valid_to` (INSTRUCTION-194). Resolves "empty tariff" symptom on
  installs where slots return without a bounded end timestamp.
- Cost controller midnight rollover: defensive cap and UTC-explicit gate
  (INSTRUCTION-193). Catches `cycles_total_today` overruns observed in fleet
  telemetry where the date-change gate failed to fire on some installs.
  **Operator note (TZ migration):** on first cycle after upgrade, BST
  installs whose service was last running between 23:00 and 00:00 BST
  will see a single spurious "midnight rollover (date-change)" log and
  a partial-day `cost_yesterday_p`. One-shot, self-corrects within 24 h.
- Cost-per-degree-hour now nulled below 0.05 deg-h denominator instead of
  emitting noise-dominated values.
- Daily COP now nulled when integrated performance is config-sourced
  (boiler always; HP in persistent fallback). Gas-boiler installs no longer
  echo η_config back as if it were a learned COP.

### Added
- Telemetry recognises server-side revocation (`PushOutcome.REVOKED`) and
  stops pushing once flagged. Cleared automatically on successful
  re-registration (e.g. wizard re-run). Exposed via
  `/api/status.telemetry_revoked` for UI surfacing. Forwards-compatible
  with current fleet collector (no behavioural change until Worker
  companion ships).

## [1.3.5] — 2026-05-07

### Added
- SCOP page with mode-resolved CoP/SCOP tracking (separate hot water and central heating efficiency)
- Config snapshots with manual revert from Settings

### Fixed
- HelpTip: portal-rendered and viewport-clamped (no more clipping at panel edges)

## [1.3.4] — 2026-05-07

### Changed
- Octopus Cosy: multi-zone HP entity regex coverage and init-failure visibility

## [1.3.3] — 2026-05-07

### Changed
- Octopus Cosy: account-number resolver fallback and wizard provider validation
- Octopus Cosy: electricity REST fallback cascade and refresh-path resilience

## [1.3.2] — 2026-05-06

### Changed
- Octopus Cosy: HP API communication hardening (flow-temperature clamp, new-schema api_key)

### Added
- Diagnostics: read-only control-method status badge

## [1.3.1] — 2026-05-06

### Added
- Zones: auxiliary output (per-zone)
- Zones: fixed setpoint available for no-control zones
- Tariff: optimiser

### Changed
- Tariff: improvements

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

## [1.2.10] — 2026-04-27

### Fixed
- MQTT driver now correctly parses heat-source telemetry from string-typed JSON payloads.

## [1.2.9] — 2026-04-27

### Fixed
- Wizard: stop config being erased on deploy
- Data Sharing: link to policy corrected

### Changed
- Web UX: assorted UI improvements

## [1.2.8.1] — 2026-04-27

### Fixed
- Complete fix for the cold crash caused in v1.2.7.

## [1.2.8] — 26 April 2026

### Fixed
- Restore `qsh.config_io` module to the public Docker image. v1.2.7 lifted
  YAML atomic-write helpers into a new shared module (INSTRUCTION-130 Task 0)
  but did not add the module to `scripts/release/submodule-compile-list.txt`,
  so it shipped as neither source nor compiled `.so`. Three import sites
  (`qsh/api/routes/config.py:19`, `qsh/main.py:328`, `qsh/telemetry.py:475`)
  failed at first-boot with `ModuleNotFoundError`. Public issue #38.

<!-- v1.2.0 through v1.2.7 were tagged but their CHANGELOG entries were not maintained; backfill tracked under Governance Ledger Entry 017 open item 3. -->

## [1.1.4] — 2026-04-12

### Fixed
- Align all state persistence paths to use `/config/` as primary location with `/data/`
  as fallback. Previously, state loaders were hardcoded to `/data/` while backup/restore
  wrote to `/config/` on fresh installs, causing restored state to be ignored and
  overwritten with empty priors. This broke alpha-to-beta migration and caused loss of
  accumulated sysid learning (U, C, solar parameters), RL model weights, schedules,
  and pipeline state on every add-on reinstall.
- Add `qsh/paths.py` utility module centralising the `/config/`-first, `/data/`-fallback
  search pattern already used by `schedule_store.py`.
- Affected files: `sysid.py`, `main.py`, `rl_model.py`, `balancing.py`, `telemetry.py`,
  `api/routes/away.py`, `hw_aware.py`, `pipeline/__init__.py`.
- Back-port `__main__.py` entrypoint shim, `image` field in `config.json`, and `run.sh`
  fix from public repo to private repo (source of truth). These originated in
  INSTRUCTION-76A/76B on the public repo and were regressed by the v1.1.4 release sync.
- Add T-18 guard to `release-sync.sh` to hard-fail if `config.json` is missing the
  `image` field after copy.
