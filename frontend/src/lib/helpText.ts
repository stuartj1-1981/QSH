export const TARIFF = {
  hpEuid: 'The unique identifier for your heat pump on the Octopus network. Found on the heat pump sticker or in Octopus account settings.',
  importRate: 'The price you pay per kWh of electricity imported from the grid.',
  exportRate: 'The price you receive per kWh of electricity exported to the grid.',
  fallbackRates: 'Backup rates used when live tariff data is temporarily unavailable. Set these to your typical rates.',
  weatherComp: 'Adjusts flow temperature based on outdoor temperature. Improves efficiency in milder weather by lowering the flow temp automatically.',
  fixedFlowTemp: 'The constant flow temperature used when weather compensation is turned off. Higher values heat faster but use more energy.',
} as const

export const HEAT_SOURCE = {
  hpModel: 'Select your heat pump model so QSH can use the correct performance curves and limits.',
  maxFlowTemp: 'The highest water temperature your heat pump can produce. Check your heat pump manual for this limit.',
  minFlowTemp: 'The lowest water temperature your heat pump will use. Lower values improve efficiency but may slow heating.',
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

export const HISTORIAN = {
  enabled: 'Logs system data to InfluxDB for long-term charts and analysis. Requires an InfluxDB add-on or server.',
  host: 'The hostname or IP address of your InfluxDB server. Use the add-on name if running as a Home Assistant add-on.',
  database: 'The InfluxDB database name where QSH stores its data. Created automatically on first write.',
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
