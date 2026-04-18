import type { QshConfigYaml, RoomConfigYaml } from '../../../types/config'

/** 3-room config: 2 rooms with envelope, 1 without. Used by hook/component/page tests. */
export const MOCK_ROOMS: Record<string, RoomConfigYaml> = {
  lounge: {
    area_m2: 20,
    ceiling_m: 2.5,
    floor: 0,
    envelope: {
      north_wall: 'external',
      south_wall: 'external',
      east_wall: { room: 'kitchen' },
      west_wall: 'external',
      floor: 'ground',
      ceiling: 'roof',
    },
    control_mode: 'indirect',
  },
  kitchen: {
    area_m2: 16,
    ceiling_m: 2.5,
    floor: 0,
    envelope: {
      north_wall: 'external',
      south_wall: 'external',
      east_wall: 'external',
      west_wall: { room: 'lounge' },
      floor: 'ground',
      ceiling: 'roof',
    },
    control_mode: 'indirect',
  },
  utility: {
    area_m2: 6,
    ceiling_m: 2.4,
    floor: 0,
    // No envelope — excluded from layout.
  },
}

export const MOCK_CONFIG: QshConfigYaml = {
  driver: 'ha',
  rooms: MOCK_ROOMS,
}

/** Config with rooms but none having envelope data. */
export const MOCK_CONFIG_NO_ENVELOPE: QshConfigYaml = {
  driver: 'ha',
  rooms: {
    lounge: { area_m2: 20, ceiling_m: 2.5, floor: 0 },
    kitchen: { area_m2: 16, ceiling_m: 2.5, floor: 0 },
  },
}

/** MOCK_CONFIG with one extra room — triggers a distinct JSON.stringify. */
export const MOCK_CONFIG_EXTENDED: QshConfigYaml = {
  driver: 'ha',
  rooms: {
    ...MOCK_ROOMS,
    bedroom: {
      area_m2: 14,
      ceiling_m: 2.5,
      floor: 1,
      envelope: {
        north_wall: 'external',
        east_wall: 'external',
        south_wall: 'external',
        west_wall: 'external',
        floor: { room: 'lounge' },
        ceiling: 'roof',
      },
      control_mode: 'indirect',
    },
  },
}
