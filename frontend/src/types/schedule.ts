export interface TimeBlock {
  from: string // "HH:MM:SS"
  to: string   // "HH:MM:SS"
}

export type DayName =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export const ALL_DAYS: DayName[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

export const DAY_LABELS: Record<DayName, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

export type WeekSchedule = Record<DayName, TimeBlock[]>

export interface RoomSchedule {
  enabled: boolean
  schedule: WeekSchedule
  current_state: string
  has_occupancy_sensor: boolean
  occupancy_sensor_entity: string | null
}

export interface SchedulesResponse {
  rooms: Record<string, RoomSchedule>
}

export type PresetName = 'weekday_9_to_5' | 'always_home' | 'school_hours' | 'bedrooms_overnight'

export const PRESET_LABELS: Record<PresetName, string> = {
  weekday_9_to_5: '9 to 5',
  always_home: 'Always Home',
  school_hours: 'School Hours',
  bedrooms_overnight: 'Bedrooms Overnight',
}

// Comfort schedule types

export interface ComfortPeriod {
  from: string  // "HH:MM"
  to: string    // "HH:MM"
  temp: number
}

export interface ComfortScheduleResponse {
  enabled: boolean
  periods: ComfortPeriod[]
  active_temp: number | null
}

// Away mode types

export interface ZoneAwayState {
  active: boolean
  days: number
  is_persistent: boolean
  computed_depth_c: number
  current_temp: number | null
  target_temp: number | null
  occupancy_state: string
}

export interface RecoveryRoom {
  current_temp: number
  target_temp: number
  delta_c: number
  estimated_minutes: number
}

export interface AwayStateResponse {
  whole_house: {
    active: boolean
    days: number
    days_remaining?: number
  }
  per_zone: Record<string, ZoneAwayState>
  recovery: {
    active: boolean
    rooms: Record<string, RecoveryRoom>
  }
  operating_state: string
}
