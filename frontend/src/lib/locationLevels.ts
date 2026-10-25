// INSTRUCTION-570C — the data-sharing location levels and their UX text.
// The form of a postcode value is the server's rule (qsh/telemetry_location.py).
// This file holds no check of that form.
import type { LocationLevel } from '../types/config'

export interface LocationLevelText {
  level: LocationLevel
  label: string
  shares: string
  canUse: string[]
  cannotUse: string[]
  privacyNote: string | null
  placeholder: string | null
  inputLabel: string | null
}

export const LOCATION_HEADING = 'Location detail'

export const LOCATION_INTRO =
  'Choose how much location detail QSH gives the swarm. More detail lets the swarm time its warnings for your home more accurately. You can change this at any time.'

export const LOCATION_STATUS_NOTE =
  'These swarm functions are in development. Your installation shares data now. It does not receive warnings or shared learning yet. Your choice sets what your home can use when each function starts. A warning also needs other QSH homes in the path of the weather.'

export const LOCATION_SHARES_HEADING = 'You share'
export const LOCATION_CAN_USE_HEADING = 'Your home can use'
export const LOCATION_CANNOT_USE_HEADING = 'Your home cannot use'

export const LOCATION_INPUT_HELP = 'Do not enter your full postcode.'

export const LOCATION_INTERNATIONAL_NOTE =
  'Postcode levels are for UK addresses. International installations share the region only. Type the name of a region only. Do not type an address or a postcode.'

export const LOCATION_LOWERING_NOTE =
  'If you lower the level, QSH replaces the value in the swarm registry at its next connection. If you turn data sharing off, QSH sends nothing more, and the swarm registry then keeps the last value until you ask for its deletion.'

export const LOCATION_LEVELS: LocationLevelText[] = [
  {
    level: 'region',
    label: 'Region only',
    shares: 'Your region, for example London.',
    canUse: [
      'Shared learning from similar homes.',
      'Weather-front warnings for your region as a whole.',
    ],
    cannotUse: ['Warnings timed for your home.', 'Solar warnings.'],
    privacyNote: null,
    placeholder: null,
    inputLabel: null,
  },
  {
    level: 'district',
    label: 'Postcode district',
    shares: 'The first part of your postcode, for example SW1A.',
    canUse: [
      'Everything in Region only.',
      'Weather-front warnings timed for your area.',
      'Solar warnings for slower changes, when another QSH home is near you.',
    ],
    cannotUse: ['Solar warnings for faster changes.'],
    privacyNote:
      'With your floor area and heat pump type, a postcode district can be enough to identify your home from public records. QSH keeps it in the swarm registry and does not put it in the data packets it sends.',
    placeholder: 'SW1A',
    inputLabel: 'First part of your postcode',
  },
  {
    level: 'sector',
    label: 'Postcode sector',
    shares: 'The first part of your postcode and the next digit, for example SW1A 1.',
    canUse: [
      'Everything in Postcode district.',
      'Solar warnings for faster changes, when another QSH home is near you.',
    ],
    cannotUse: ['Nothing more. This is the most detailed level.'],
    privacyNote:
      'A postcode sector is a smaller area than a district. It is easier to identify your home at this level.',
    placeholder: 'SW1A 1',
    inputLabel: 'First part of your postcode and the next digit',
  },
]

export function telemetryLocationFields(
  agreed: boolean,
  regionMode: 'uk' | 'international',
  level: LocationLevel,
  code: string,
): { location_level?: LocationLevel; location_code?: string } {
  if (!agreed || regionMode !== 'uk' || level === 'region') return {}
  return { location_level: level, location_code: code }
}
