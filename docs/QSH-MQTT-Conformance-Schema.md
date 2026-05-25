# QSH MQTT Conformance Schema

**Version 1.1.** Specifies the contract a field MQTT installation must satisfy to integrate with the QSH (Quantum Swarm Heating) supervisory control system. Field installations not satisfying this contract must either reconfigure their broker / publishers to match, or run a translation gateway in front of their broker.

**Audience.** Anyone integrating an MQTT broker with QSH — typically the heat-pump or heating-system installer, or a gateway author building a translation layer between an existing broker topology and a QSH-conformant view.

---

## 0. Reading order

§1 frames conformance and audience. §2 defines the topic-tree conventions. §3 enumerates every input signal QSH can consume from MQTT — the full read-side surface. §4 enumerates every output signal QSH publishes to MQTT — the full write-side surface. §5 specifies the fixed control-topic paths. §6 specifies payload formats. §7 specifies the freshness / availability / staleness semantics. §8 specifies QoS, retain, and Last Will conventions. §9 specifies the YAML configuration form a QSH installer uses to map their broker's topics onto this contract. §10 specifies the manual-override and shadow-mode semantics. §11 specifies conformance test criteria. §12 provides a worked example.

§3 and §4 are the operational reference — the rest is the rules around them.

---

## 1. Conformance Statement

A field MQTT installation conforms to this schema when ALL of the following hold:

1. Every QSH-consumed input listed in §3 that the installation needs to provide is published to the broker on a topic that the installer maps into the QSH config (per §9), with the payload format specified for that input (per §6).
2. Every QSH-published output listed in §4 the installation needs to act upon is consumed from the topic the installer maps in the QSH config (per §9), and the consuming device interprets the payload per §6.
3. The fixed control topics in §5 are not used for any other purpose. QSH-external publishers MAY publish to `<prefix>/control/*` topics for legitimate UI-side state-update use (e.g. away-mode toggle from a home-automation script), but those publishers are part of the installation's design, not arbitrary noise.
4. The QoS / retain / LWT conventions of §8 are followed.
5. The freshness model of §7 is honoured — heartbeat cadences match the category default or an explicit override declared in the QSH config.
6. Shadow-mode and manual-override semantics of §10 are honoured by any device that BOTH reads from `<prefix>/control/dfan_control` AND writes to a topic QSH writes to.

Non-conformance is binary. There is no partial conformance. A non-conformant installation either reconfigures the offending publishers / consumers to conform, or runs a translation gateway between the broker and QSH that presents a conformant view.

This specification documents what the QSH MQTT driver requires. It is descriptive, not aspirational — there is no future-compatible reshaping bundled into this version. Subsequent versions may add input/output surface or tighten constraints; semver discipline applies.

## 2. Topic-tree conventions

### 2.1 Prefix

The QSH MQTT driver supports a configurable topic prefix set at `mqtt.topic_prefix` in YAML. The prefix is also surfaced via the MQTT Broker step of the QSH setup wizard — the UI field writes the same YAML key. The driver applies the prefix at config-load time, not at publish/subscribe time, so this is a static binding decided per-installation.

**User-mapped topics — `mqtt.inputs`, `mqtt.outputs`, `heat_sources[].sensors`, `room_mqtt_topics`.** These are passed through the driver's prefix helper. If `topic_prefix` is set, the driver prepends `<prefix>/` to every topic in these blocks before subscribing or publishing. If `topic_prefix` is unset or empty, the configured topic is used verbatim — bare paths are subscribed / published as written. So an input mapping `room_temp: zigbee2mqtt/lr_temp` with `topic_prefix: qsh` results in QSH subscribing to `qsh/zigbee2mqtt/lr_temp`; with `topic_prefix` unset, QSH subscribes to bare `zigbee2mqtt/lr_temp`. This applies symmetrically to inputs and outputs.

**QSH-owned diagnostic topics — LWT, notifications, shadow mirrors.** These are at fixed paths the driver constructs internally. They respect the configured prefix WHEN SET, but they fall back to the literal string `qsh` when `topic_prefix` is unset rather than going prefix-less:

- LWT: `<prefix>/status` if prefix set; `qsh/status` if not.
- Notifications: `<prefix>/notifications` if prefix set; `qsh/notifications` if not.
- Shadow mirrors: `<prefix>/shadow/*` if prefix set; `qsh/shadow/*` if not.

This means a broker subscribed to `qsh/#` will always observe QSH-installation traffic on these three paths regardless of the YAML `topic_prefix` setting. It also explains a common observation: with `topic_prefix` unset, user-mapped sensor topics appear at their bare configured paths while QSH-owned publishes (LWT, notifications, shadow) appear under `qsh/...` — the asymmetry is the hardcoded fallback, not a driver heuristic about input vs output.

**`mqtt.topic_prefix` vs `mqtt.client_id`.** These are independent settings that share the same default value `qsh`, which can cause confusion. `topic_prefix` governs the topic-path namespace as described above. `client_id` is the MQTT client identifier passed to the Paho client — it appears in the broker's session tracking, persistent-session resumption, will-message routing, and ACL lookup. Changing one does not affect the other. The UI fields "Topic prefix" and "ClientID" in the QSH MQTT Broker setup step write `mqtt.topic_prefix` and `mqtt.client_id` respectively.

Conventional prefix value: `qsh` (no leading slash, no trailing slash). MQTT brokers MAY require namespace isolation between QSH and other tenants on the same broker — the prefix is the mechanism. Multi-instance QSH deployments on one broker MUST use distinct prefixes (`qsh/site1`, `qsh/site2`, etc.) — distinct prefixes produce distinct subscribe sets in the driver and avoid cross-talk. Multi-instance deployments SHOULD also use distinct `client_id` values to avoid broker session collisions.

The "current prefix" referenced below is whatever the configurer set. Examples in this document use `qsh`.

### 2.2 Fixed-path topics vs config-mapped topics

Two classes of topics exist:

**Fixed-path topics** are at paths the QSH driver assumes and uses without consulting YAML config. The installer cannot rename them. They are:

- `<prefix>/control/*` — the control-input topics in §5.
- `<prefix>/shadow/*` — the QSH dashboard mirror topics in §4.7.
- `<prefix>/notifications` — the QSH notification publish in §4.8.
- `<prefix>/heat_source/<slug>/command` — the default per-heat-source command publish in §4.4 (overridable per-source via YAML).

**Config-mapped topics** are at paths the installer chooses, mapped into QSH-expected fields via the YAML config (§9). The installer's broker may use any topic structure for these — the YAML binding tells the driver where to look. Every input in §3 and most outputs in §4 are config-mapped.

### 2.3 Prohibited usage

Publishers external to QSH MUST NOT publish to:

- `<prefix>/shadow/*` — these are QSH-owned mirror topics. External writes will be overwritten on the next QSH cycle and may cause UI flapping.
- `<prefix>/notifications` — QSH-owned notification stream.
- `<prefix>/heat_source/<slug>/command` (or whatever the per-source override topic is) — except as the legitimate consumer (the heat-source controller acting on the command). External publishers to a command topic create unsafe dual-master behaviour.

`<prefix>/control/*` is the documented input path for UI-side state — external publishers (home-automation scripts, mobile-app integrations) ARE expected to publish there. Conformance requires that those publishers obey the payload format in §5 for each control topic.

## 3. Inputs — signals QSH consumes from MQTT

This section enumerates every signal QSH-side code reads from MQTT. Each input is named, scoped, payload-typed, and described. Implementations must publish each input the installation uses on a topic the installer maps into the QSH config per §9. Topics for inputs are config-mapped (§2.2) — the installer chooses the topic path, the installer's YAML maps it to the QSH field.

The QSH driver maintains a per-topic cache and is event-driven on incoming messages; publish-on-change is the expected mode, with heartbeat cadence per the freshness category of the input (§7). Publishers that send only on connection (no heartbeat, no on-change) will appear stale and then unavailable to QSH within minutes — see §7.

### 3.1 System-level numeric inputs

Each field below is a single global signal for the QSH installation. The installer maps each one (where applicable) in the YAML config at `mqtt.inputs.<field>` (legacy) or at `heat_sources[<n>].sensors.<slot>` (newer; see §3.3 for the per-heat-source path which supersedes the legacy keys for the primary heat source).

| Field | Type | Unit | Range | Default category | Notes |
|-------|------|------|-------|------------------|-------|
| `outdoor_temp` | float | °C | -40 to 50 | `outdoor` | Outdoor air temperature. Single source; multi-source resolution not supported at this field. |
| `hp_flow_temp` | float | °C | 0 to 80 | `temperature` | Heat pump flow (supply) temperature. Legacy key — primary heat-source slot `flow_temp` (§3.3) is preferred for new installs. |
| `hp_return_temp` | float | °C | 0 to 80 | `temperature` | Heat pump return temperature. Legacy. Per-source slot `return_temp` preferred. |
| `hp_power` | float | kW | 0 to 30 | `power` | Heat pump instantaneous electrical power draw. Legacy. Per-source slot `power_input` preferred. |
| `hp_cop` | float | ratio (dimensionless) | 0.5 to 8.0 | `power` | Heat pump COP if natively reported by the unit. Legacy. Per-source slot `cop` preferred. |
| `hp_heat_output` | float | kW | 0 to 30 | `power` | Heat pump thermal output if natively reported. Legacy. Per-source slot `heat_output` preferred. Stored in shadow (not consumed by main pipeline). |
| `hp_mode_state` | string | enum | `heat` / `off` (case-sensitive) | `default` | Heat pump observed mode if natively reported. Legacy. Stored in shadow. |
| `solar_production` | float | kW | 0 to 30 | `energy` | PV instantaneous production. Optional — installs without solar mark this field absent in YAML; capability flag `has_solar` is then false. |
| `grid_power` | float | kW | -30 to 30 | `power` | Grid power flow. Sign convention: positive = import, negative = export. Optional. |
| `battery_soc` | float | percent | 0 to 100 | `energy` | Home battery state of charge if present. Optional. |
| `flow_rate` | float | l/min | 0 to 100 | `default` | Heat pump primary flow rate. Legacy. Per-source slot `flow_rate` preferred. |
| `boiler_power_input` | float | kW | 0 to 50 | `power` | Boiler fuel input power for hybrid installs. Used by aggregation logic to estimate boiler thermal output via efficiency η. |

Each row's "category" determines default freshness cadence per §7. Installers may override category per-mapping in YAML.

### 3.2 System-level string inputs

Boolean / enum values are published as raw strings and parsed by a separate code path. Same YAML mapping form as numeric inputs.

| Field | Values | Notes |
|-------|--------|-------|
| `hot_water_active` | Three-valued classification of the payload: `true` / `false` / `unavailable`. Payload values that classify to `true`: `"on"`, `"On"`, `"ON"`, `"true"`, `"True"`, `"TRUE"`, `"1"`, `"yes"`. To `false`: `"off"`, `"Off"`, `"OFF"`, `"false"`, `"False"`, `"FALSE"`, `"0"`, `"no"`. Any other payload classifies to `unavailable`. | Indicates DHW priority engaged at the heat pump. When `true`, room-zone control may suspend until the cycle completes. |
| `hot_water_boolean` | Same three-valued classification as above. | Alternative source / sometimes used in parallel with `hot_water_active`. |

### 3.3 Per-heat-source inputs

For installations with one or more heat sources (primary heat pump, supplementary boiler, electric backup), each source's signals are published to its own set of topics. The installer's YAML lists each source under `heat_sources[]` with a `name` and a `sensors` block. Each slot below is `heat_sources[<n>].sensors.<slot>` in YAML.

| Slot | Type | Unit | Range | Default category | Notes |
|------|------|------|-------|------------------|-------|
| `flow_temp` | float | °C | 0 to 80 | `temperature` | Source flow / supply temperature. |
| `power_input` | float | kW | 0 to 50 | `power` | Source electrical or fuel input power. |
| `heat_output` | float | kW | 0 to 30 | `power` | Source thermal output if natively reported. |
| `cop` | float | ratio | 0.5 to 8.0 | `power` | Source COP if natively reported. |
| `delta_t` | float | °C | -20 to 30 | `default` | Source delta-T if natively reported (otherwise QSH derives from flow / return). |
| `return_temp` | float | °C | 0 to 80 | `temperature` | Source return temperature. |
| `flow_rate` | float | l/min | 0 to 100 | `default` | Source flow rate. |
| `total_energy` | float | kWh | 0 to 10⁹ | `energy` | Source cumulative energy totaliser. |
| `pump_power` | float | kW | 0 to 5 | `power` | Source's circulation pump power if separately metered. |

For the primary heat source (`heat_sources[0]`), per-source slots TAKE PRECEDENCE over the legacy `mqtt.inputs.hp_*` keys in §3.1. Where both are configured, the per-source slot is used and the legacy key is silently skipped. Mixed configurations (some per-source, some legacy) are supported during migration — partial-migration installs are explicitly handled by the driver's compatibility logic.

### 3.4 Per-room inputs

For each room defined in the installation, the installer maps per-room input topics under `room_mqtt_topics.<room>.<field>` in YAML.

| Field | Type | Unit | Range | Default category | Notes |
|-------|------|------|-------|------------------|-------|
| `room_temp` | float | °C | -10 to 50 | `temperature` | Room temperature sensor. Populates the room's temperature for control logic. |
| `occupancy_sensor` | string | enum | `on` / `off` / `unavailable` or installation-specific | `default` | Room occupancy sensor state. Used by occupancy-aware schedule logic. |
| `valve_position` | float | percent | 0 to 100 | `valve` | Valve position observed by the TRV / actuator. Multi-emitter support: see §3.5. |

### 3.5 Multi-emitter per-room valve positions

A single room may have multiple emitters (radiators, UFH loops) each with its own actuator and per-emitter valve-position feedback. The `valve_position` field accepts either a single topic string OR a list of topic strings.

When a list is provided, each entry produces a topic mapping with an `emitter` stem derived from the final dot-separated component of the topic. The driver populates per-emitter valve positions for each entry, and the aggregate per-room position per the pipeline's emitter-aggregation rules.

Conformance requirement: when a list is provided, each entry MUST produce a unique emitter stem. Duplicate stems within a room are a config-load failure (`SystemExit` at startup). The configurer is responsible for choosing topic paths whose terminal component disambiguates emitters.

Example (YAML):

```yaml
room_mqtt_topics:
  living_room:
    valve_position:
      - sensors/living_room/rad_left/position
      - sensors/living_room/rad_right/position
      - sensors/living_room/ufh_loop/position
```

This produces three topic mappings with emitter stems `position`, `position`, `position` — and FAILS conformance because the stems collide. Re-author with disambiguating terminal components:

```yaml
room_mqtt_topics:
  living_room:
    valve_position:
      - sensors/living_room/rad_left
      - sensors/living_room/rad_right
      - sensors/living_room/ufh_loop
```

Produces stems `rad_left`, `rad_right`, `ufh_loop`. Conformant.

### 3.6 Per-room outputs (read-side reference)

For each room, the installer also maps OUTPUT topics in the same `room_mqtt_topics.<room>` block. These are listed in §4 (write-side surface) — referenced here for completeness of the per-room YAML block.

- `valve_setpoint` — QSH writes the commanded valve setpoint here. Accepts single or list (multi-emitter, same disambiguation rules as `valve_position`).
- `trv_setpoint` — QSH writes the commanded TRV temperature setpoint here. Accepts single or list.

### 3.7 Forecast input

Outdoor temperature forecast data, used by the forecast controller and the antifrost / cycle-protection controllers. Subscribe-only — QSH consumes the topic but does NOT route it into the per-cycle input block; it is routed into a separate forecast state.

Configured as `mqtt.inputs.forecast.topic` (or equivalently `entities.forecast_mqtt_topic`) in YAML. Payload is JSON with a documented forecast envelope — see the QSH forecast topic documentation for the payload schema; this is a separate sub-contract.

Conformance for the forecast topic is governed by the forecast sub-contract document; this conformance schema requires only that the topic be present and subscribable if the installation enables forecast features.

### 3.8 Auxiliary inputs

Auxiliary inputs are room-level outputs whose state is also read back (e.g. dispatch confirmation topics). Configured under `room_aux_outputs.<room>.<aux_name>` in YAML with `mqtt_topic`. Read semantics are bidirectional — QSH publishes commands on the topic and observes the device's acknowledgement via retained-message conventions. See §4.6 for the publish side.

## 4. Outputs — signals QSH publishes to MQTT

This section enumerates every signal QSH publishes. Topic paths are either config-mapped (installer chooses) or fixed (QSH-owned, see §2.2).

### 4.1 System control outputs

Mapped under `mqtt.outputs.<field>` in YAML. The installer chooses the topic; QSH publishes the value when the supervisory pipeline updates it.

| Field | Type | Unit | Range | Payload | Notes |
|-------|------|------|-------|---------|-------|
| `flow_temp` | float as string | °C | 20 to 65 | Decimal string, e.g. `"42.5"` | Commanded heat pump flow temperature. Published when the supervisory pipeline indicates a hardware change AND the system is in LIVE mode (`control_enabled = true`). |
| `mode` | string | enum | `heat` / `off` | Bare string, no quotes in payload | Commanded heat pump operating mode. Published on hardware change AND LIVE mode. |
| `heat_source_command` | string | enum | `on` / `off` (or installation-specific) | Bare string | Shoulder-controller command for the active heat source. Published on heat-source change AND LIVE mode. |

### 4.2 Per-room outputs

Mapped under `room_mqtt_topics.<room>.<field>` in YAML. Single topic string or list (multi-emitter, same disambiguation rules as §3.5).

| Field | Type | Unit | Range | Payload | Notes |
|-------|------|------|-------|---------|-------|
| `valve_setpoint` | float as string | percent (typically) | 0 to 100 | Decimal string | Commanded valve setpoint for direct-controllable TRVs. Published on valve change per the manual-override-aware gate (see §10). |
| `trv_setpoint` | float as string | °C | 5 to 30 | Decimal string | Commanded TRV temperature setpoint for indirect-controllable TRVs. Published on valve change. |

### 4.3 Failsafe publishes

On QSH graceful shutdown, the driver publishes a failsafe state to system control outputs to leave the heating system in a safe configuration. Specifically:

- `mode` topic — publishes `"off"`.

This is the only failsafe publish on shutdown. Per-room outputs are not republished on shutdown — the TRVs retain their last commanded state.

On failsafe re-publish during operation (controller invocation of the failsafe path — typically after a control-loop pipeline exception), the driver publishes `flow_temp` and `mode` with the safe values from the failsafe state machine. Retries up to N times per the configured retry policy; if all retries fail, logs CRITICAL and gives up — the heat pump's native antifrost will then govern.

### 4.4 Per-source command publishes

Mapped under `heat_sources[<n>].mqtt.command_topic` per source. If absent, the driver computes the topic as `<prefix>/heat_source/<slug>/command` where `<slug>` is the slugified source name (lowercase, non-alphanumeric runs collapsed to `_`, leading/trailing `_` stripped, empty result becomes `source`).

Payload is the installation-specific command string (`on`, `off`, `heat`, `standby`, etc. — defined by the device the heat source represents). QoS=1, retain=False.

Per-source command publishes are issued by the heat-source controller layer, not by the main pipeline's per-cycle write loop. They are scoped to active-source switching events, not per-cycle.

### 4.5 Default heat-source command (fixed-path)

When no per-source override is configured for the primary heat source, the driver publishes at `<prefix>/heat_source/<slug>/command` — fixed path. See §4.4 above. The "fixed-path" element is the structure (`<prefix>/heat_source/<slug>/command`) not the slug itself, which is computed from the source name.

### 4.6 Auxiliary output publishes

For installations with auxiliary outputs (DHW priority commands, secondary loop valves, etc.), each aux output is configured under `room_aux_outputs.<room>.<aux_name>` with `mqtt_topic` and an optional payload-shape. QSH publishes the auxiliary command when auxiliary outputs have changed. QoS=1, retain=True (retained — the consuming device's state is the last commanded value).

### 4.7 Shadow / dashboard mirror publishes (fixed-path)

When `publish_mqtt_shadow = true` in YAML (default true), the driver mirrors selected internal state values to `<prefix>/shadow/<key>` for dashboard consumption. The set of mirrored keys is fixed by the driver code and not config-extensible. Examples (not exhaustive):

- `<prefix>/shadow/operating_state` — current pipeline operating state string (`Initialising`, `Heating`, `Coasting`, `Antifrost`, `Summer`, `Shoulder`, etc.)
- `<prefix>/shadow/<key>` for various computed values (total demand, smoothed external temp, applied flow / mode, etc.)

QoS=0 typical, retain=True (so a re-subscribing dashboard sees the last state immediately).

When `mqtt_legacy_shadow_topics = true` (default), some shadow keys are published in both legacy and modern forms during the migration window. New installs SHOULD set `mqtt_legacy_shadow_topics: false` to publish only the modern form.

Conformance requirement: external publishers MUST NOT write to `<prefix>/shadow/*`. QSH overwrites these on every cycle.

### 4.8 Notification publishes (fixed-path)

Operator notifications generated by the pipeline (event annunciations crossing the LATCHED rising-edge boundary) are published to `<prefix>/notifications` as JSON objects. Schema per notification:

```json
{
  "ts": "ISO 8601 UTC timestamp",
  "level": "info" | "warning" | "error" | "critical",
  "name": "<event spec name>",
  "message": "<human-readable message>",
  "payload": { /* event-spec-defined diagnostic payload */ }
}
```

QoS=0, retain=False — notifications are event-stream semantics, not state.

### 4.9 Manual-override valve publishes

When a room is in MANUAL state per the QSH manual-state logic (the operator has explicitly commanded a valve position locally via the engineering UI), the driver writes the operator-commanded valve position directly to the room's `valve_position` topic (the same topic listed as an INPUT in §3.4). This is the only output that writes to a topic also listed as an input. Specific behaviour governed by §10 (manual override) — listed here for completeness of the write surface.

## 5. Fixed control-input topics

These are paths the driver subscribes to without YAML configuration. External publishers (home-automation scripts, mobile apps, ops tooling) write here to update QSH-side state. The driver caches the latest value on each topic and reads it per cycle.

| Topic | Payload | Type | Notes |
|-------|---------|------|-------|
| `<prefix>/control/away` | `on` / `off` / `true` / `false` | string-bool | Away-mode toggle. When `on`/`true`, away-mode logic engages. |
| `<prefix>/control/away_days` | Decimal string | float | Days-away value for away-mode countdown. Range 0 to 365. |
| `<prefix>/control/dfan_control` | `on` / `off` / `true` / `false` | string-bool | Master shadow / live toggle. `true` means QSH is in LIVE mode (publishing hardware commands). `false` means SHADOW mode (no hardware publishes). |
| `<prefix>/control/flow_min` | Decimal string | float | Minimum flow temperature override. Range 20 to 65 °C. |
| `<prefix>/control/flow_max` | Decimal string | float | Maximum flow temperature override. Range 20 to 65 °C. |
| `<prefix>/control/comfort_temp` | Decimal string | float | Global comfort temperature override. Range 15 to 25 °C. |
| `<prefix>/control/comfort_temp/<room>` | Decimal string | float | Per-room comfort temperature override. One topic per configured room. Range 15 to 25 °C. |

Conformance requirements:

- Payloads MUST parse cleanly per the type column. The driver emits diagnostic events on parse failure (warning level, audit-logged).
- The `dfan_control` topic MUST have a value at any time QSH is running. If absent on first subscribe, the driver emits a diagnostic event. Installation MUST publish a default (typically `false` for first boot) before connecting QSH.
- Publishers SHOULD set retain=True on control topics so a reconnecting QSH sees the last-known state immediately.

## 6. Payload formats

Three payload format modes are supported per input mapping. The configurer selects the mode via YAML — see §9.

### 6.1 `plain` (default)

Payload is the raw value, parsed directly. For numeric fields, the payload is decoded as UTF-8 and parsed as `float`. For string fields, the payload is decoded as UTF-8 and used as-is (case-sensitive).

Example payload for `room_temp`:
```
21.5
```

Example payload for `hp_mode_state`:
```
heat
```

This is the default mode. Most simple MQTT publishers produce plain payloads.

### 6.2 JSON with `json_path`

Payload is a JSON object. The value is extracted via the configured `json_path` — a dot-separated key path. Supports nested object navigation. Does NOT support array indexing (use a more capable transformation tool if you need it; this is intentional simplicity).

Example payload:
```json
{
  "battery": {"level": 87},
  "temperature": 21.5,
  "linkquality": 200
}
```

With `json_path: "temperature"`, value is `21.5`. With `json_path: "battery.level"`, value is `87`.

JSON paths that don't resolve (missing key, type mismatch) yield no update for that cycle — the cached value persists and ages per the freshness model.

### 6.3 JSON for state strings

For string-typed fields, JSON extraction works the same way but the resolved value is used as a string. Payload values that are JSON numbers / booleans are stringified.

### 6.4 Availability spec

Each input mapping MAY include a separate availability topic with a match expression. The driver subscribes to the availability topic and treats its payload as a binary "publisher online" flag. When the availability topic reports offline, the value-topic data is held but quality is forced to `unavailable` regardless of recency.

Availability match expression syntax:

| Expression | Semantics |
|------------|-----------|
| `==<value>` | Online when payload equals `<value>` (string comparison). |
| `!=<value>` | Online when payload does not equal `<value>`. |
| `==online` | Convenience for `==online`. |
| `!=unavailable` | Convenience for not-unavailable. |

Example YAML:

```yaml
mqtt:
  inputs:
    hp_power:
      topic: home/heatpump/power
      format: plain
      availability:
        topic: home/heatpump/status
        online_match: "==online"
```

When `home/heatpump/status` payload is `"online"`, `hp_power` updates from `home/heatpump/power`. When it's anything else, `hp_power` is held at quality `unavailable`.

### 6.5 Last-seen spec

Each input mapping MAY include a `last_seen` topic carrying a publication timestamp. The driver uses the last_seen timestamp instead of the value-topic publish time for freshness calculations. Useful when the broker is bridged or when value-topic publication is lossy.

`last_seen` payload format: Unix epoch seconds as a decimal string, or ISO 8601 UTC. Both are accepted.

## 7. Freshness, staleness, and the three-state liveness model

QSH classifies each input topic into one of three liveness states based on the time since last publication (or `last_seen` timestamp if configured):

- **good** — last publication within the `fresh` threshold for the topic's category.
- **stale** — last publication between `fresh` and `unavailable` thresholds. The cached value is still used, but downstream logic (system identification, controllers) may treat the field with reduced confidence.
- **unavailable** — last publication beyond the `unavailable` threshold, or availability topic reports offline. The cached value is NOT used; capability flags (`has_live_power`, `has_live_flow`, etc.) are cleared.

### 7.1 Category default thresholds (seconds)

| Category | Fresh threshold | Unavailable threshold | Rationale |
|----------|-----------------|----------------------|-----------|
| `temperature` | 7200 (2 h) | 14400 (4 h) | Battery-powered Zigbee sensors with hourly heartbeats. |
| `humidity` | 7200 | 14400 | Same — battery sensors. |
| `valve` | 3600 (1 h) | 7200 | TRV battery-powered; position changes infrequently when settled. |
| `power` | 180 (3 min) | 600 (10 min) | Mains-powered fast-reporting energy meters. |
| `energy` | 300 (5 min) | 900 (15 min) | Cumulative totalisers, slower cadence acceptable. |
| `outdoor` | 1800 (30 min) | 3600 (1 h) | Outdoor weather stations, sometimes API-backed with longer cadences. |
| `default` | 90 (1.5 min) | 300 (5 min) | Mains-powered, fast-reporting fallback. Used when no category is set and the field name does not match the inference table. |

These defaults are baked into the QSH MQTT driver. They are conservative for the typical UK Zigbee-heavy residential install. Industrial installations with mains-powered fast-reporting sensors should override per-category in YAML.

### 7.2 Category inference

For fields not given an explicit category in YAML, the driver infers from the field name per its built-in inference table. Inferred mappings:

| Field name | Inferred category |
|------------|-------------------|
| `outdoor_temp` | `outdoor` |
| `room_temp`, `hp_flow_temp`, `hp_return_temp` | `temperature` |
| `valve_position` | `valve` |
| `hp_power`, `grid_power`, `hp_cop` | `power` |
| `solar_production`, `battery_soc` | `energy` |

Per-source slot fields infer from slot name (e.g. `power_input` → `power`, `total_energy` → `energy`, `flow_temp` → `temperature`).

Any field not in the inference table falls back to `default` (90/300). For battery-backed sensors on `default` category, the conservative threshold will mark them stale within minutes — installers MUST override category in YAML for such fields.

### 7.3 Per-installation override

The installer overrides default thresholds globally per category in YAML:

```yaml
mqtt:
  staleness_defaults:
    temperature:
      fresh: 600
      unavailable: 1800
    power:
      fresh: 60
      unavailable: 180
```

Per-mapping override (rare):

```yaml
mqtt:
  inputs:
    hp_power:
      topic: home/heatpump/power
      category: power  # explicit — uses defaults for `power`
      # or
      last_seen:
        topic: home/heatpump/power_last_seen
```

### 7.4 Capability flags

A subset of inputs control capability flags on the per-cycle input block. When the input is `good`, the flag is true; when `unavailable`, the flag is false. Cleared flags cause downstream code to skip dependent computations.

| Input | Capability flag |
|-------|----------------|
| `hp_flow_temp` | `has_live_flow` |
| `hp_cop` | `has_live_cop` |
| `hp_power` | `has_live_power` |
| `hp_return_temp` | `has_live_return_temp` |
| `flow_rate` | `has_live_flow_rate` |
| `solar_production` | `has_solar` |
| `battery_soc` | `has_battery` |
| `boiler_power_input` | `has_live_boiler_power` |

`has_live_hot_water` is computed separately by the three-valued hot-water classifier (§3.2), not via a capability-flag entry. Per-source slots set per-source capability flags (see QSH source for the full per-source flag enumeration).

## 8. QoS, retain, and Last Will

### 8.1 QoS conventions

| Topic class | QoS | Retain | Notes |
|-------------|-----|--------|-------|
| Input topics (publishers → QSH) | Publisher's choice; QSH subscribes at QoS 0 | Publisher's choice (retain=True recommended for "current state" signals) | QoS 0 sufficient — broker delivers latest value to subscribers; QSH's freshness model handles loss tolerance. |
| Control topics (`<prefix>/control/*`) | Publisher's choice; QSH subscribes at QoS 0 | Retain=True RECOMMENDED so reconnecting QSH sees state immediately. | |
| System control outputs (§4.1) | Driver publishes at default QoS | Retain=False (not specified, depends on broker default) | |
| Per-source command (§4.4) | QoS=1 explicit | Retain=False | Commands are event-shaped, not state. |
| Per-room outputs (§4.2) | Driver publishes at default QoS | Retain not explicitly set | |
| Aux outputs (§4.6) | QoS=1 explicit | Retain=True | State semantics — last commanded position retained. |
| Shadow mirrors (§4.7) | QoS=0 typical | Retain=True | Dashboard re-subscribers see last state. |
| Notifications (§4.8) | QoS=0 | Retain=False | Event stream, not state. |
| Manual valve publishes (§4.9) | Driver default QoS | Retain not explicitly set | Same as the corresponding per-room output topic. |

QSH does not require QoS 2 anywhere. Installations may use QoS 1 universally if their broker prefers it; the freshness model accommodates either.

### 8.2 Last Will and Testament

The current MQTT driver does NOT publish its own LWT. Publishers external to QSH SHOULD publish LWTs on availability topics (§6.4) so that QSH can detect publisher loss within seconds rather than waiting for the unavailable threshold to elapse.

Recommended publisher LWT pattern:

```
LWT topic:   home/heatpump/status
LWT payload: offline
LWT QoS:     1
LWT retain:  true
```

With the corresponding availability spec in QSH YAML:

```yaml
availability:
  topic: home/heatpump/status
  online_match: "==online"
```

The publisher publishes `online` to the status topic on connect; the LWT publishes `offline` on disconnect.

### 8.3 Broker resilience expectations

QSH assumes the broker is reachable continuously. The driver attempts reconnect on disconnect with backoff. Extended broker outage is treated as a control-system fault — operating_state will reflect this and the failsafe path may engage.

Broker requirements:

- MQTT 3.1.1 or 5.0 (driver uses 3.1.1-compatible semantics).
- Topic ACLs SHOULD restrict QSH-side credentials to the `<prefix>/*` subtree (read+write on input topics, write on output topics, read+write on `<prefix>/control/*` and `<prefix>/shadow/*` and `<prefix>/notifications`).
- External publisher credentials SHOULD be ACL-restricted to their own publish topics (typically input topics for a given device).

## 9. YAML configuration form

This section specifies the YAML structure the QSH installer uses to map their broker's topics into QSH's expected fields. The YAML is read at QSH startup; topic-map construction is one-shot at startup. Topic changes require QSH restart.

### 9.1 Top-level `mqtt` block

```yaml
mqtt:
  broker: <hostname>           # e.g. "mqtt.local"
  port: 1883                    # optional, default 1883
  username: <string>            # optional
  password: <string>            # optional, redacted in API responses
  topic_prefix: qsh             # see §2.1
  publish_mqtt_shadow: true     # default true; see §4.7
  mqtt_legacy_shadow_topics: true  # default true; new installs set false

  staleness_defaults:           # optional; overrides built-in defaults
    <category>:
      fresh: <seconds>
      unavailable: <seconds>

  inputs:
    <field>: <topic> | <mapping_block>     # see §9.2

  outputs:
    <field>: <topic>                       # see §9.3
```

### 9.2 Input mapping forms

Each entry under `mqtt.inputs.<field>` is either a bare topic string (simple form) or a mapping block (full form):

```yaml
mqtt:
  inputs:
    # Simple form — bare topic, defaults applied
    outdoor_temp: home/weather/outdoor_temp

    # Full form — explicit format / json_path / availability / last_seen / category
    hp_power:
      topic: home/heatpump/power
      format: plain                     # or "json"
      json_path: null                   # required if format=json
      category: power                   # optional; overrides inference
      availability:
        topic: home/heatpump/status
        online_match: "==online"
      last_seen:
        topic: home/heatpump/last_seen
```

Field names accepted: see §3.1 (system numeric), §3.2 (system string), §3.7 (forecast).

### 9.3 Output mapping form

Each entry under `mqtt.outputs.<field>` is a bare topic string. No mapping-block form is currently supported for outputs.

```yaml
mqtt:
  outputs:
    flow_temp: home/qsh/cmd/flow_temp
    mode: home/qsh/cmd/mode
    heat_source_command: home/qsh/cmd/heat_source
```

Field names accepted: see §4.1.

### 9.4 Per-heat-source block

```yaml
heat_sources:
  - name: HP1
    type: heat_pump
    sensors:
      flow_temp: home/hp1/flow
      power_input:
        topic: home/hp1/power
        category: power
      return_temp: home/hp1/return
      cop: home/hp1/cop
      flow_rate: home/hp1/flow_rate
      total_energy: home/hp1/energy
      heat_output: home/hp1/heat_output
    mqtt:
      command_topic: home/hp1/cmd          # optional; overrides default
```

Slots not configured for a source are absent; capability flags for those slots are cleared. The `mqtt.command_topic` override is per-source — without it, the default `<prefix>/heat_source/<slug>/command` is used.

### 9.5 Per-room block

```yaml
room_mqtt_topics:
  living_room:
    room_temp: zigbee2mqtt/sensor.living_room_temp
    occupancy_sensor: zigbee2mqtt/sensor.living_room_occupancy
    valve_position: zigbee2mqtt/sensor.living_room_trv  # single topic
    valve_setpoint: zigbee2mqtt/sensor.living_room_trv/set
    trv_setpoint: zigbee2mqtt/sensor.living_room_trv/set_temp

  hallway:
    room_temp:
      topic: zigbee2mqtt/sensor.hallway_temp
      format: json
      json_path: temperature
      availability:
        topic: zigbee2mqtt/sensor.hallway_temp/availability
        online_match: "==online"
    valve_position:                         # multi-emitter list
      - zigbee2mqtt/sensor.hallway_rad1
      - zigbee2mqtt/sensor.hallway_rad2
    valve_setpoint:
      - zigbee2mqtt/cmd/hallway_rad1/setpoint
      - zigbee2mqtt/cmd/hallway_rad2/setpoint
```

For multi-emitter lists, each entry MUST produce a unique terminal-component stem within the room (§3.5).

### 9.6 Per-room auxiliary outputs

```yaml
room_aux_outputs:
  utility_room:
    dhw_pump:
      mqtt_topic: home/utility/dhw_pump/set
      on_payload: "ON"        # optional; default "on"
      off_payload: "OFF"      # optional; default "off"
```

### 9.7 Forecast

```yaml
mqtt:
  inputs:
    forecast:
      topic: home/weather/forecast
```

The forecast topic's payload schema is governed by a separate sub-contract — see the QSH forecast topic documentation.

## 10. Manual-override and shadow-mode semantics

### 10.1 Shadow mode

The `<prefix>/control/dfan_control` topic carries the master shadow / live toggle. When set to `false` (or `off`), QSH is in SHADOW MODE: the supervisory pipeline runs normally, generates outputs, populates the dashboard, but does NOT publish hardware commands to:

- `mqtt.outputs.flow_temp`
- `mqtt.outputs.mode`
- `mqtt.outputs.heat_source_command`
- `room_mqtt_topics.<room>.valve_setpoint` (subject to manual-override carve-out below)
- `room_mqtt_topics.<room>.trv_setpoint`
- Per-source command topics (§4.4)
- Auxiliary outputs (§4.6)

Notifications, shadow mirrors, and inputs are unaffected by shadow mode.

### 10.2 Manual override

When a room is in MANUAL state per the QSH manual-state logic (the operator has explicitly commanded a valve position locally via the engineering UI), the driver publishes the operator-commanded position to the room's `valve_position` topic REGARDLESS of shadow mode. This is the only exception to shadow-mode suppression.

Behavioural contract:

- The MANUAL publish is at the operator's commanded position percentage (0–100, integer if accepting integer publishes, else float).
- The MANUAL publish is on the SAME topic listed as the room's `valve_position` input in YAML — i.e. QSH publishes back to the same topic from which it reads observed position. This is the only such write-to-input case.
- The MANUAL publish occurs once on MANUAL engagement and again on operator-commanded position change. It does NOT publish per cycle.
- An AUTO publish that occurs under shadow mode is a bug — the driver logs a warning-level annunciation if this is observed.
- The carve-out is scoped to direct-TRV position publishes ONLY. It does NOT extend to: HP flow/mode publishes (§4.1), per-source commands (§4.4), shoulder commands (§4.1 `heat_source_command`), indirect-TRV setpoint publishes (§4.2 `trv_setpoint`), auxiliary outputs (§4.6).

Conformance for receiving devices: the TRV / valve controller MUST act on writes to its `valve_position` topic regardless of the publish source (operator vs supervisory). The MANUAL semantics are at the QSH layer, not at the device layer.

## 11. Conformance test criteria

A field MQTT installation passes conformance when ALL of the following tests pass. These criteria are intended to be implemented as an automated test harness — installer runs it, captures pass/fail output, addresses failures before connecting QSH.

### 11.1 Topic-presence tests

For each input configured in the installer's QSH YAML:
- T-1.1: The configured topic is published at least once within 60 seconds of test start.
- T-1.2: The payload parses cleanly per the declared format (`plain` numeric, `plain` string, or `json` + `json_path`).
- T-1.3: If an `availability` spec is configured, the availability topic is published at least once within 60 seconds AND the payload matches the `online_match` expression.

For each output configured in the installer's QSH YAML:
- T-1.4: The topic is subscribable by the test harness (broker ACL permits subscription on the QSH-side credentials).
- T-1.5: No external publisher is publishing on the output topic during the test window (5-minute observation) — QSH is the sole writer.

### 11.2 Fixed-path tests

- T-2.1: `<prefix>/control/dfan_control` has a retained value at test start (any retained value). Missing = fail per §5.
- T-2.2: External writes to `<prefix>/shadow/*` are NOT observed during a 5-minute window. (Conformance requires QSH-exclusive write on shadow topics.)
- T-2.3: External writes to `<prefix>/notifications` are NOT observed.

### 11.3 Payload-format tests

For a sample of 10 published messages per input topic (collected over a 10-minute window):
- T-3.1: Numeric payloads parse as `float` without exception.
- T-3.2: For `format: json` mappings, the JSON parses cleanly and the `json_path` resolves to a value of the expected type.
- T-3.3: String enum payloads (e.g. `hot_water_active`) match one of the documented value sets (true-set / false-set per §3.2).

### 11.4 Cadence tests

Over a 30-minute window, for each input topic:
- T-4.1: At least one publish per `fresh` threshold for the topic's category. If no publish, the test reports the input as a candidate for cadence violation. The installer either confirms the publisher should publish faster, or overrides category to a slower default in YAML.
- T-4.2: No more than 1000 publishes per minute on any single topic. (Sanity check against publish-storm misconfigurations.)

### 11.5 QoS / retain tests

- T-5.1: Control topics (§5) have retain=True on their last published value (best-effort — `dfan_control` MUST; others SHOULD).
- T-5.2: Output topics QSH publishes to are NOT retained externally (i.e. the topic does not have a pre-existing retained message from another publisher).

### 11.6 Multi-emitter tests

For any per-room field configured as a list:
- T-6.1: Each list entry produces a unique terminal-component stem.
- T-6.2: Each list entry is independently published per T-1.1.

### 11.7 Reporting

The harness produces a single JSON report at exit:

```json
{
  "schema_version": "1",
  "tested_at": "YYYY-MM-DDTHH:MM:SSZ",
  "broker": "host:port",
  "topic_prefix": "qsh",
  "result": "pass" | "fail",
  "tests": {
    "T-1.1": {"status": "pass" | "fail", "details": [...] },
    "T-1.2": {...}
  },
  "failed_inputs": [...],
  "failed_outputs": [...],
  "recommendations": [...]
}
```

`result: fail` blocks QSH connection. The installer addresses each failed test before re-running the harness.

## 12. Worked example — gas boiler hybrid install

Illustrative YAML for a gas-boiler hybrid installation (a heating system with a gas boiler as the primary heat source rather than an electric heat pump). Demonstrates the `boiler_power_input` slot usage and the per-heat-source `sensors` block for non-heat-pump primary sources.

```yaml
mqtt:
  broker: 192.168.1.10
  port: 1883
  topic_prefix: qsh
  publish_mqtt_shadow: true
  mqtt_legacy_shadow_topics: false

  staleness_defaults:
    temperature:
      fresh: 600
      unavailable: 1800
    power:
      fresh: 60
      unavailable: 180

  inputs:
    outdoor_temp: weather/oat
    hp_flow_temp: boiler/flow_temp
    hp_return_temp: boiler/return_temp
    hp_power:
      topic: boiler/electrical_power
      category: power
    boiler_power_input:
      topic: boiler/fuel_input_kw
      category: power
      availability:
        topic: boiler/status
        online_match: "==online"

  outputs:
    flow_temp: cmd/boiler/flow_temp
    mode: cmd/boiler/mode

heat_sources:
  - name: gas_boiler
    type: boiler
    efficiency: 0.85
    sensors:
      flow_temp: boiler/flow_temp
      power_input: boiler/fuel_input_kw
      return_temp: boiler/return_temp
    mqtt:
      command_topic: cmd/boiler/source_cmd

room_mqtt_topics:
  living_room:
    room_temp: zigbee2mqtt/lr_temp
    valve_position: zigbee2mqtt/lr_trv
    valve_setpoint: zigbee2mqtt/cmd/lr_trv/set_position
    trv_setpoint: zigbee2mqtt/cmd/lr_trv/set_temp
  bedroom:
    room_temp: zigbee2mqtt/bed_temp
    valve_position: zigbee2mqtt/bed_trv
    trv_setpoint: zigbee2mqtt/cmd/bed_trv/set_temp
```

In this configuration, the gas boiler is treated as the primary heat source. Fuel input power is published to `boiler/fuel_input_kw` and consumed via the `boiler_power_input` field; the configured efficiency η = 0.85 is used by QSH aggregation logic to estimate thermal output.

## 13. Version History

| Version | Change |
|---------|--------|
| 1 | Initial release. |
| 1.1 | §2.1 Prefix amended. Clarified that the prefix applies uniformly to user-mapped topics (`mqtt.inputs`, `mqtt.outputs`, `heat_sources[].sensors`, `room_mqtt_topics`) but that QSH-owned diagnostic topics (LWT, notifications, shadow mirrors) fall back to the literal string `qsh` when `topic_prefix` is unset rather than going prefix-less. Added note distinguishing `topic_prefix` from `client_id` (independent settings sharing the same `qsh` default — a common source of confusion). |
