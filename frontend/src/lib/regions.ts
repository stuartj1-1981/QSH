/**
 * Canonical UK region list (Met Office standard — 16 entries).
 * Single source of truth for wizard and Settings.
 */
export const UK_REGIONS = [
  'North East England',
  'North West England',
  'Yorkshire and the Humber',
  'East Midlands',
  'West Midlands',
  'East of England',
  'London',
  'South East England',
  'South West England',
  'Wales',
  'East Scotland',
  'West Scotland',
  'North Scotland',
  'Northern Ireland',
  'Channel Islands',
  'Isle of Man',
] as const

export type UkRegion = (typeof UK_REGIONS)[number]
