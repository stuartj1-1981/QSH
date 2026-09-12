export const TARIFF = {
  hpEuid: 'The unique identifier for your heat pump on the Octopus network. Found on the heat pump sticker or in Octopus account settings.',
  importRate: 'The price you pay per kWh of electricity imported from the grid.',
  exportRate: 'The price you receive per kWh of electricity exported to the grid.',
  fallbackRates: 'Backup rates used when live tariff data is temporarily unavailable. Set these to your typical rates. Export blank = no export credit assumed; solar surplus is priced at the import rate and solar-adjusted pricing stays off. (Advanced: set energy.electricity.octopus_export_tariff_code in YAML to decode a live export rate instead — requires your Octopus API key and export tariff code.)',
  weatherComp: 'Adjusts flow temperature based on outdoor temperature. Improves efficiency in milder weather by lowering the flow temp automatically.',
  fixedFlowTemp: 'The constant flow temperature used when weather compensation is turned off. Higher values heat faster but use more energy.',
} as const

export const HEAT_SOURCE = {
  hpModel: 'Select your heat pump model so QSH can use the correct performance curves and limits.',
  maxFlowTemp: 'The highest water temperature this source runs to in normal operation. Must sit inside the appliance flow capability below.',
  minFlowTemp: 'The lowest water temperature this source runs to. Lower values improve efficiency but may slow heating. Must sit inside the appliance flow capability.',
  capabilityMin: 'The lowest flow temperature your appliance can physically produce. Leave blank to use the type default. A modern condensing gas boiler often runs 30–40 °C weather-compensated flow — assert that here to unlock it.',
  capabilityMax: 'The highest flow temperature your appliance can physically produce (its rated maximum). Leave blank to use the type default. Many condensing gas boilers top out around 82–85 °C.',
} as const

export const HOT_WATER = {
  hwSensor: 'The Home Assistant sensor that reads your hot water cylinder temperature.',
  preCharge: 'Warms the cylinder ahead of scheduled hot water times using cheap-rate electricity, saving money.',
  plumbingPlan: 'How your heating and hot water pipework is arranged. Affects when the system can heat water vs rooms.',
  signalsGroup: 'How QSH detects that the heat pump has diverted to hot water. Either signal alone is enough; if both are set, ON from either marks DHW active (logical OR).',
  signalsPrimary: 'The primary DHW active indicator. For HA, a water_heater entity whose state goes off/eco/electric/heat_pump/gas/performance/idle when not heating water and on/high_demand/heat when heating. For MQTT, a topic publishing the same payload set.',
  signalsBoolean: "Optional second indicator OR'd with the primary. Accepts on, true, 1, heat, high_demand as ON. Use when your installation exposes a clean boolean alongside (or instead of) the water_heater entity.",
  scheduleOctopus: 'For Octopus heat pumps, QSH reads DHW activity live from the Octopus API (WATER-zone heat demand) instead of imposing a fixed time. The Cosy’s own schedule and boost drive the cylinder; QSH reacts to demand and does not read a forward schedule (the Octopus schedule is write-only). The water-heater entity is then used for tank temperature only.',
} as const

export const SOLAR = {
  solarEntity: 'The Home Assistant sensor that reports your solar panel generation in watts or kilowatts.',
  batteryEntity: 'The Home Assistant sensor that reports your home battery state of charge as a percentage.',
  diversionThreshold: 'The minimum surplus solar power (in watts) before QSH diverts energy to heating instead of exporting.',
} as const

/** Settings -> Historian, one text per mode and variant (INSTRUCTION-524B
 *  T5). The UI offers the built-in store only; no text asks for InfluxDB.
 *  `HistorianChoice` picks the variant from the mode, `setup.active`,
 *  `section.enabled` and `isParked(section)`. */
export const HISTORIAN = {
  unknown: {
    noSetup: 'QSH cannot read the historian state.',
    unread:
      'QSH has not read the built-in store yet. It reads it when heating control starts; during first setup, that is after the setup is deployed. If this does not change after a restart, read the add-on log.',
    noState: 'QSH reports a built-in store but not its state. Try again.',
  },
  unavailable: 'The built-in store cannot run on this system.',
  unreadable:
    'This system has a built-in store that QSH cannot read. Read the add-on log.',
  migratingParked: {
    active:
      'InfluxDB still records your history, but the move to the built-in store is paused by historian.store.shadow.',
    inactive:
      'Nothing is recorded: the move of your history to the built-in store is paused by historian.store.shadow.',
    // Review finding R1, carried by DISPATCH-NOTE-524A-524B-2026-09-12.md.
    // The cleared text keyed the parked branch on `active` alone, so a
    // disabled historian was told the key was the reason nothing is
    // recorded when the first cause is that the historian is off. RESUME
    // writes `enabled: true` with `store.shadow: true`, so one press does
    // fix both, and this text says so.
    notEnabled:
      'The historian is off, and the move of your history to the built-in store is also paused by historian.store.shadow. Resume the move turns the historian on and continues the move.',
    advice:
      'If InfluxDB still runs, resume the move. If InfluxDB is gone, resume the move, then set historian.store.cutover_force: true in qsh.yaml and use Cut over on the Store page (Engineering mode). History not yet copied is lost.',
  },
  migrating: {
    active:
      'QSH is moving your history from InfluxDB to the built-in store. When the move is complete, QSH uses the built-in store.',
    enabledNotActive:
      'History is being moved from InfluxDB, but nothing is recorded: InfluxDB did not answer when QSH last started. If InfluxDB is gone, set historian.store.cutover_force: true in qsh.yaml and use Cut over on the Store page (Engineering mode). History not yet copied is lost.',
    notEnabled:
      'A move of history from InfluxDB to the built-in store is not finished. Turn the historian on to continue it.',
  },
  builtin: {
    recording: 'The historian records to the built-in store.',
    enabledNotActive:
      'The built-in store holds your history, but nothing is recorded now. Use the built-in store only to fix this.',
    notEnabled:
      'The built-in store holds your history. Turn the historian on to record to it.',
  },
  legacy: {
    lead:
      'This system records history to InfluxDB (InfluxDB answered when QSH last started). QSH no longer supports InfluxDB.',
    move: 'Move the history to the built-in store.',
    noStore: 'The built-in store did not start. Read the add-on log.',
  },
  fresh: {
    lead:
      'QSH keeps its history in its own store on this system. You do not need InfluxDB.',
    oldInflux: 'History in an old InfluxDB is not copied.',
    // `active` alone cannot say this: an InfluxDB that answered makes it
    // true. No write fixes a store that fails to open.
    storeDidNotStart:
      'The built-in store did not start, so nothing is recorded. Read the add-on log.',
  },
} as const

export const SOURCE_SELECTION = {
  mode: 'Choose which heat source QSH uses. Auto mode picks the cheapest or greenest option each cycle based on your preference slider. Manual modes lock to a single source.',
  preference: 'Slide towards Eco to favour lower carbon emissions, or towards Cost to favour lower running costs. At 70% (default), cost is the primary factor with some weight given to carbon.',
  dwell: 'Minimum time before switching sources. Protects the compressor and avoids thermal shock. Default 30 minutes.',
  deadband: 'The alternative source must score this much better (%) before QSH switches. Prevents switching on marginal differences. Default 10%.',
  maxSwitches: 'Maximum source switches per day. Prevents excessive cycling in marginal weather. Default 6.',
  sourceStatus: 'Shows each heat source\'s current state, efficiency, and cost per kWh of heat delivered. The active source is highlighted.',
  fuelCostEntity: 'An HA sensor or MQTT topic providing the current fuel cost in £/kWh. For advanced users who calculate their own costs including standing charges and PV offset.',
  carbonFactor: 'Carbon emissions per kWh of fuel input. Electricity varies with the grid mix; gas and LPG are fixed values from BEIS conversion factors.',
  pumpMaxSpeed: 'Maximum pump speed as a percentage. Reduce below 100% if high speeds cause turbulent flow noise in the pipework.',
} as const

export const BALANCING = {
  suggestion: 'A recommended lockshield valve adjustment to improve flow balance across your zones.',
  severity: 'How far the zone flow deviates from the ideal. Higher deviation means the zone is more out of balance.',
} as const

export const OCCUPANCY = {
  sensorClass: 'Presence sensors (mmWave/radar) report continuously while PIRs report movement only. The choice sets the default debounce when no explicit value is given below — 10s for presence, 60s for motion.',
  predictive: 'Learns your occupancy patterns to preheat ahead of arrival. The learner needs observation time before it predicts anything — this is not an immediate-effect switch.',
  debounce: 'How long an occupancy reading must hold before QSH acts on it. Filters out brief sensor flicker.',
  fallback: 'What QSH assumes about occupancy when the sensor stops reporting.',
  watchdog: 'How long to hold the last known occupancy state before degrading to \'Assume Occupied\'.',
} as const

export const SWARM = {
  inputs:
    'Each swarm input this unit can consume. The light shows whether the unit is using that data on live control — green: in use; amber: observing (received but not applied live); red: no data; grey: reserved (channel not yet active).',
  thermal_envelope:
    'Cohort-learned heat-loss (U) and thermal-mass (C) priors. When in use, the swarm’s U/C estimates blend into this unit’s live model.',
  solar_capture:
    'Cohort-learned solar-gain priors that bootstrap this unit’s solar capture before it has enough sunny-day observations of its own.',
  disturbance_relay:
    'Disturbance events corroborated across nearby cohort units (e.g. a cold snap) and relayed to this unit. Reserved — not yet active.',
  rl_benchmarking:
    'Cohort benchmark data for the reinforcement-learning policy. Reserved — not yet active.',
  global_no_signal:
    'No fresh reading of the fleet GLOBAL gate — the coordinator is unreachable or the last read has aged out. Live consumption is held (Watchdog).',
  local_standby:
    'No authorisation issued for this channel yet — the coordinator has not set a local gate. Default pre-coordinator state, not a fault.',
} as const
