// Shared UI defaults for the fixed-rate tariff inputs.
//
// Single source of truth for the £/kWh fixed-rate defaults shown on the
// tariff surfaces. Seeded into committed state on provider switch / hydrate
// so the deploy payload always carries a rate — the backend requires it and
// rejects a `provider: 'fixed'` config with no rate (boots into setup mode).
//
// Consumed by the wizard tariff step (INSTRUCTION-303) and the Settings
// tariff panel (INSTRUCTION-304). This module is the only place these
// literals live — do not re-declare them at a call site.

/** Default electricity fixed rate (£/kWh). */
export const DEFAULT_ELEC_FIXED_RATE = 0.245

/** Default gas fixed rate (£/kWh). */
export const DEFAULT_GAS_FIXED_RATE = 0.07
