# Changelog

## [Unreleased]

## [1.5.23] — 2026-07-05

### Added
- Measurement & Verification (M&V): QSH now continuously simulates what your
  system's original weather-compensation setup would have used and tracks the
  running energy, cost and comfort difference against what QSH actually
  delivered, giving an auditable savings figure per install. Available via new
  /api/mv and /api/mv/report endpoints (JSON or CSV), with an M&V plan template.
- Flow-control decisions are now recorded every cycle — which control priority
  won and what limited the flow — visible on the status API and in the
  historian, for clearer diagnostics and support.

### Changed
- Custom MQTT control topics (setpoint and control-enable) are now read from
  your actual configuration end-to-end, so writes and read-backs work correctly
  on installs using non-default topic names.

### Fixed
- Slow-publishing per-source price feeds over MQTT no longer expire between
  updates and fall back to a fixed default price — the cause of the system
  oscillating between heat sources in the evenings. Stale prices now hold their
  last valid value and are flagged.
- Fixed repeating historian write failures that could drop room data points when
  a room's target temperature landed on a whole number.

## [1.5.22] — 2026-07-04

### Fixed
- On dual-source systems, a standby heat pump's efficiency is now taken from
  your configured per-source efficiency rather than a generic estimate, so its
  running-cost score is no longer flattered while another source is active.
- A zero or negative fuel price on a combustion source (gas, LPG, oil) is now
  treated as implausible: the system holds the last valid price instead of
  switching to that source on a phantom "free heat" reading. Electricity sources
  still honour genuine zero/negative pricing (e.g. Octopus Agile).
- Boiler input-power readings on MQTT installs now briefly hold their last valid
  value and fall back to rated output when a reading drops out, eliminating the
  frequent "boiler input power absent" flapping and the short zero-energy /
  zero-cost metering gaps it caused.

### Changed
- The External Setpoints settings page on MQTT installs now shows the configured
  setpoint input topics and their status, with clearer copy, instead of a
  placeholder that looked like it was waiting for a binding UI.

## [1.5.21] — 2026-07-03

### Added
- Solar, battery and grid sensors are now supported over MQTT, with correct
  import/export sign handling for grid power and energy.
- Stored heat-pump efficiency (COP) is now honoured on MQTT installs, so the
  configured efficiency is preserved end-to-end rather than being re-derived.

### Changed
- Grid and battery settings in the UI are now decoupled, giving clearer,
  independent configuration of each.
- Improved TRV valve-offset learning using a settle time derived from the
  learned building thermal parameters, plus richer source-capability reporting.

## [1.5.20] — 2026-07-02

### Fixed
- Automatic heat-source selection no longer stays on the more expensive source
  when the cheaper source's saving sits just inside the switching dead-band.
  Sustained small savings now accumulate and trigger a switch, while the
  compressor minimum-run guard is preserved.

### Changed
- On multi-source systems, the heat pump's running cost now reflects the solar
  export you give up by running it, and boiler running costs include a
  circulator-pump penalty — so source selection reflects true marginal cost.
- The heat-source panel now shows the effective electricity price behind each
  decision and why it differs from your tariff (export-adjusted, boiler pump
  overhead).
- Total cost per heat source — running cost plus an amortised share of the
  standing charge — is now recorded to the historian to help answer whether a
  connection is worth keeping. Standing charges come from the Octopus API, or a
  configuration field for non-gas boilers (e.g. LPG tank rental).

## [1.5.19] — 2026-07-01

### Changed
- The learning heating controller can now train candidate policies that aim to
  beat the built-in baseline rather than just reproduce it. A new offline step
  requires each candidate to outperform the baseline across simulated seasons
  before it is ever given live control. The policy now also perceives the time
  of year and penalises summer and shoulder-season overshoot.
- The heat-source settings panel now shows the basis for each source's
  efficiency figure and warns when a configured efficiency value looks
  implausible.

## [1.5.18] — 2026-06-30

### Changed
- On multi-source systems, the heat pump now uses your electricity tariff as the
  authoritative source for its running cost and carbon intensity, and the
  source-selection panel shows matching cost and carbon figures.

### Fixed
- Hot-water (DHW) sensor assignments are no longer lost when a heat source is
  saved.

## [1.5.17] — 2026-06-29

### Added
- New Device Health page showing live data freshness per field, so you can see
  at a glance whether each sensor and source is reporting up-to-date values.
- Per-device battery state-of-charge entity setup in the wizard, so each battery
  can be assigned its own state-of-charge sensor.

### Changed
- Per-source flow temperature limits. On multi-source systems the heat pump and
  boiler flow-temperature caps are now enforced independently, and the operating
  flow setpoint is editable directly from the Home and Settings screens.

### Fixed
- Public image NumPy ABI coherence.
- Boot-crash fixes: battery-devices configuration and an optional-torch import
  path no longer prevent startup.

## [1.5.16] — 2026-06-28

### Added
- Swarm units now report a baseline learning-coverage status — whether the
  thermal model is qualified, still qualifying, has a measurement gap, or is in
  fault — to the coordinator, derived from how mature the heat-loss and
  passive-cooling learning is. This is the unit-side signal the coordinator's
  maturity gate consumes.
- Units now report building metadata — construction year, fabric class, and
  storey count — to the swarm, so the platform can derive the building's
  archetype from its configuration. A new wizard step captures construction
  year and fabric class.  Please update in settings under rooms or run the wizard.

## [1.5.15] — 2026-06-26

### Added
- The system now reads and displays its swarm admission status — whether it is
  registered, assigned to a coordinator, and which cohorts it belongs to — for
  operator and UI visibility. This is display-only and does not change how the
  unit publishes telemetry or joins the swarm.

## [1.5.14] — 2026-06-24

### Changed
- More accurate thermal-mass (C) confidence. Passive-cooling thermal-mass
  estimates are now judged against their own natural measurement scatter
  rather than the tighter heat-loss (U) reference, so a room's thermal-mass
  confidence is no longer under-reported.

## [1.5.13] — 2026-06-24

### Added
- Cooling awareness. An optional cooling-status sensor lets the system detect
  when air conditioning is active, suppressing thermal-model learning during
  cooling so summer A/C no longer corrupts the heating model, and surfacing an
  active-cooling banner on the Home screen.

## [1.5.12] — 2026-06-21

### Added
- Faster thermal-mass learning. The system now identifies each room's thermal
  mass from away-mode deep setbacks, recovery heat-up ramps, and active setback
  periods, in addition to passive cooling. On installs where passive cooling
  alone was slow to converge, this sharpens control accuracy sooner.
- Home Assistant installs can now drive live comfort setpoints from a
  PID-target entity, matching the parity MQTT installs already had.

### Changed
- MQTT shared-topic sensors now track freshness per field, distinguishing an
  absent value from a parse failure — a stale or missing key no longer masks a
  good reading on the same topic.
- Per-source fuel-cost resolution now behaves consistently across source types.

### Security
- Updated frontend dependencies to clear security advisories.

## [1.5.11] — 2026-06-20

### Added
- Multi-source installs can now feed live per-source running-cost and
  carbon-intensity signals into the economic source selector — via either MQTT
  topics or Home Assistant entities — so the system picks the cheapest or
  lowest-carbon heat source dynamically.
- MQTT control topics are now individually configurable, with per-topic JSON
  dot-path extraction for brokers that publish nested JSON payloads rather than
  a bare scalar value.

## [1.5.10] — 2026-06-19

### Fixed
- Fixed the Octopus hot-water demand signal on Octopus heat-pump installs. The
  heat-pump status query was being rejected by Octopus's API because of an
  incorrect field type, so scheduled hot-water cycles weren't detected. The
  query is now accepted and the live demand signal works as intended.

## [1.5.9] — 2026-06-18

### Added
- Octopus heat-pump installs can now take hot-water demand directly from the
  live Octopus signal. On a fully-configured Octopus install, scheduled DHW
  cycles are detected from the heat pump's own demand telemetry instead of the
  water-heater entity's operation mode, which never surfaced scheduled cycles.
  Enable it on Settings → Hot Water with the new "Octopus (reactive — live
  demand)" source; the water-heater entity is then used for tank temperature
  only.

### Fixed
- On Home Assistant installs with two heat sources, the failsafe now forces
  every non-active heat source off, preventing both sources from firing
  together during a safety action. This matches the protection the MQTT driver
  already had.

### Changed
- MQTT subscribe-only inputs (e.g. forecast) are now handled cleanly and kept
  out of the signal-quality monitor. Unrecognised input keys are logged once
  and skipped rather than being silently tracked as phantom fields.

## [1.5.8] — 2026-06-17

### Fixed
- On dual-source installs (e.g. heat pump alongside a boiler), the source
  selector no longer picks a source that is drivable but cannot be confirmed
  via power feedback. Each source is now checked for both a command path and
  a power-feedback slot before it can be selected.
- If the active heat source is commanded on but fails to respond within its
  readback window, the system now switches to the next available source
  rather than waiting out the full error interval with no heat.
- On MQTT installs, the actuation-mode topic was publishing the observed
  state rather than the commanded mode. This caused a self-fulfilling
  stuck-off loop where an idle heat pump would see itself commanded off,
  never fire, and stay off indefinitely. The correct command is now
  published.

## [1.5.6] — 2026-06-15

### Fixed
- On installs that pair a boiler with a heat pump, the low-flow safety
  lock no longer misreads a boiler's normal burner cycling as a fault. It
  previously could block the heat call; it now applies only while a heat
  pump is the active source. Boilers keep their dead-head bypass
  protection.
- Fixed a historian logging conflict on shadow-mode installs that was
  silently dropping data points on each write.

### Changed
- MQTT installs now log when the outdoor temperature falls back to a
  last-known or default value. Previously a missing outdoor-temperature
  mapping could pin the reading at 5°C and quietly push the system into
  winter-hold.

## [1.5.5] — 2026-06-15

### Changed
- On mixed-source installs (for example a boiler alongside a heat pump), the
  system now records the measured data — power and flow/return temperatures —
  from whichever heat source is actually running. System identification and the
  historian now reflect the active source rather than a fixed one.
- The unit self-suspension safety check (sensor–actuator coupling) is now
  source-agnostic: it evaluates the heat source currently in use, so it behaves
  correctly on installs that switch between sources.

## [1.5.4] — 2026-06-14

### Added
- Swarm units can now recognise when their own data has become
  unreliable — a sensor that no longer tracks its actuator, readings
  that collide with the learned model, or values outside physical
  limits — and voluntarily withdraw from the shared learning network so
  they don't pollute it for everyone else. This self-suspension is off
  by default. A status banner shows when a unit has suspended itself,
  and a unit is brought back into service automatically once it
  recovers.
- MQTT heat-source installs now read back the heat-source mode, bringing
  them to parity with direct installs.
- A heat source that stops responding to commands is now detected via a
  per-source response timeout with a dead-time gate, surfaced in
  Settings.

### Changed
- Short-cycle detection is now boost-aware and resets its cooldown
  correctly, reducing false short-cycle trips during a boost.

## [1.5.3] — 2026-06-12

### Added
- Property details — total floor area and number of bedrooms — can now
  be edited in Room Settings after the initial wizard, not just during
  first-time setup.
- The shoulder-season forecast horizon and the summer demand threshold
  are now editable in Thermal Settings.
- A room's emitter type is now editable in Room Settings, including a new
  "None" option for rooms that have no emitter. A no-emitter room
  correctly contributes zero heat output instead of a hidden default.

## [1.5.2] — 2026-06-11

### Added
- The active heat source is now published on a retained MQTT status
  topic, and a deselected source is explicitly switched off so no stale
  command lingers on its topic.

### ⚠️ Breaking
- Default per-source MQTT command topics now honour the configured topic
  prefix. Prefixed installs that relied on the old unprefixed default must
  re-point their subscriptions (qsh/heat_source/<slug>/command →
  <prefix>/heat_source/<slug>/command). Explicit command-topic overrides
  and unprefixed installs are unaffected.
- A primary heat source configured with both a flow-control topic and a
  mode topic now dispatches flow and mode to those per-source topics
  instead of the shared output topics. Re-point if you integrated against
  the shared topics.

### Changed
- On boiler + heat-pump installs, shoulder cycling now tracks the active
  source's minimum output — when the boiler is active it cycles against
  the boiler's floor instead of the heat pump's, preventing short-cycling.

## [1.5.1] — 2026-06-10

### Added
- Fixed-rate tariffs can now be set up directly in the wizard tariff
  step and the Settings tariff editor, with seeded defaults and
  consistent validation across both.
- Swarm telemetry carries additional unit-side heat-source fields
  (shadow mode).

### Changed
- Smarter heat-pump wind-down: when demand is satisfied and the
  commanded flow falls below return, the system coasts and intends
  off rather than holding heat.

### Fixed
- Boiler installs: per-source power is now routed correctly to cost
  tracking, with a clear notice when no boiler power sensor is
  configured.
- MQTT flow-control method persists for non-primary heat sources.
- No more false heat-pump trip learning or readback escalation during
  demand-satisfied wind-down.
- Timezone-naive MQTT weather forecasts are accepted, and forecasts
  received but unusable are surfaced instead of silently ignored.

## [1.5.0] — 2026-06-07

### ⚠️ Breaking change — qsh.yaml is strictly validated at startup
- QSH now refuses to start if `qsh.yaml` contains an unrecognised
  top-level section. On boot, any unknown top-level key is reported by
  name and the add-on stops:
  "Unrecognised top-level section(s) in qsh.yaml: [...]. Configure via
  the setup wizard / settings page."
  Action is required only if you hand-edit `qsh.yaml`: remove or correct
  any stray, renamed, or mistyped top-level section. Configurations
  produced by the Setup Wizard or Settings page are unaffected — every
  key they write is recognised — and legacy keys (`away`, `schedule`,
  `disclaimer_accepted`, …) remain tolerated. You can check a config
  without restarting using the built-in YAML validator, which reports
  the same issue non-fatally.

### Added
- Quantum Swarm fleet coordination (shadow mode): installs can
  contribute and receive learned thermal parameters through the swarm
  coordinator, with quarantine safeguards, per-channel consumption
  visibility, a master live-enable control, and a Swarm engineering page.
- Multi-source heating: flow and mode are routed dynamically to the
  active heat source (heat pump or boiler); capacity and minimum output
  are taken from the active source.

### Changed
- SCOP heating/hot-water split now uses the hot-water-active tag filter
  for cleaner attribution (retires the legacy `qsh_dhw` measurement).

### Fixed
- Hot-water active state is held through brief heat-source comms loss
  instead of dropping out.
- SCOP numerator/denominator point-set asymmetry corrected.
- Forecast hourly-grid guard and tariff fallback-rate log hygiene.

## [1.4.10] — 2026-05-25

### Fixed
- Summer mode exit predicate decoupled from pre-charge
  `upcoming_cold` flag, which was tripping on routine UK diurnal
  forecast swings and exiting summer mode within minutes of every
  entry on warm days. Exit condition 3 now uses an absolute-minimum
  predicate on the 12-hour forecast minimum against a new
  configurable threshold `summer.exit_forecast_min_c` (default 8°C).

## [1.4.9] — 2026-05-24

### Added
- Comfort-temperature writeback round-trip verification: after a
  setpoint write the value is read back from the bus and a mismatch
  raises an operator-surface event rather than failing silently.
- Comfort-schedule diagnostic surface on the Home page: shows the
  cause of the current setpoint (schedule slot, default fallback,
  manual override, away mode) with tooltip explanations and glossary.

### Changed
- Forecast commissioning interlock startup WARNING reformatted from
  dot-notation to inline YAML blocks for readability when operators
  paste it into their configuration.

### Fixed
- Octopus public gas-rate endpoints no longer send Basic-Auth. The
  public endpoints reject Basic-Auth and were occasionally returning
  401, breaking gas-rate refresh on installs without an Octopus
  account configured.

## [1.4.8] — 2026-05-23

### Added
- Weather Forecast Topic field in the MQTT wizard sensors
  step, so installs using an external MQTT-based forecast
  publisher can configure the topic in the wizard rather than
  hand-editing YAML.
- One-shot first-payload confirmation event for the MQTT
  forecast provider — when the first valid forecast payload
  arrives, an operator-visible event records the summary, so
  commissioning is observable.

### Fixed
- Forecast commissioning interlock: the system now warns at
  startup if the weather-forecast feature is enabled but no
  provider is configured, instead of silently doing nothing.
  Catches a silent-failure mode on MQTT installs where the
  forecast feature was switched on but the source topic was
  never set. The CLI validator and the wizard validation now
  surface the same warning so the problem is caught at
  config-write time as well as runtime.

## [1.4.7] — 2026-05-22

### Added
- New fleet telemetry pipeline: a persistent local queue and HTTP
  publisher that emit regular state snapshots (every 15 minutes)
  and event-driven disturbance reports. When enabled, the previous
  daily-batch telemetry path is gated off so an install runs
  exactly one of the two.
- Daily parameter outbound and inbound prior cache wired in as
  foundation for cross-install learning. Inbound values surface
  with explicit freshness state so consumers can distinguish
  fresh data from cached fallbacks.
- Composite confidence indicator computed every cycle, combining
  how well the system has learned this building's thermal
  characteristics (per-room maturity) with how many sensors are
  currently reporting fresh readings. Included in outbound
  telemetry.

### Changed
- Home page schedule status display rewritten. The sub-line now
  always renders when a comfort schedule is active and clearly
  distinguishes four states: schedule active and converged,
  schedule active with rooms diverging from target, schedule
  inactive, and schedule active with every room individually
  overridden. Replaces the previous divergence-only sub-line,
  which could be mistaken for the schedule not firing at all when
  every room had a manual override.

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
