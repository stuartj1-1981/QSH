import { type ReactNode } from 'react'
import {
  Home as HomeIcon,
  Flame,
  Zap,
  Thermometer,
  HardDrive,
  Settings,
  Gauge,
  Sun,
  CloudSun,
  Droplets,
  Database,
  BarChart3,
  Leaf,
  Link as LinkIcon,
  Building,
} from 'lucide-react'
import { cn } from '../../lib/utils'

export type SettingsSection =
  | 'rooms'
  | 'building-layout'
  | 'heat_source'
  | 'tariff'
  | 'thermal'
  | 'control'
  | 'external_setpoints'
  | 'seasonal_tuning'
  | 'outdoor_weather'
  | 'solar_battery'
  | 'hot_water'
  | 'historian'
  | 'data_sharing'
  | 'backup'
  | 'system'

const SECTIONS: { id: SettingsSection; label: string; icon: typeof HomeIcon }[] = [
  { id: 'rooms', label: 'Rooms', icon: HomeIcon },
  { id: 'building-layout', label: 'Building Layout', icon: Building },
  { id: 'heat_source', label: 'Heat Source', icon: Flame },
  { id: 'tariff', label: 'Tariff', icon: Zap },
  { id: 'thermal', label: 'Thermal', icon: Thermometer },
  { id: 'control', label: 'Control', icon: Gauge },
  { id: 'external_setpoints', label: 'External Setpoints', icon: LinkIcon },
  { id: 'seasonal_tuning', label: 'Seasonal Tuning', icon: Leaf },
  { id: 'outdoor_weather', label: 'Outdoor & Weather', icon: CloudSun },
  { id: 'solar_battery', label: 'Solar & Battery', icon: Sun },
  { id: 'hot_water', label: 'Hot Water', icon: Droplets },
  { id: 'historian', label: 'Historian', icon: Database },
  { id: 'data_sharing', label: 'Data Sharing', icon: BarChart3 },
  { id: 'backup', label: 'Backup', icon: HardDrive },
  { id: 'system', label: 'System', icon: Settings },
]

interface SettingsLayoutProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  children: ReactNode
}

export function SettingsLayout({
  activeSection,
  onSectionChange,
  children,
}: SettingsLayoutProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:gap-6">
      {/* Section nav — horizontal scroll on mobile, vertical sidebar on desktop */}
      <nav className="flex lg:flex-col lg:w-48 lg:shrink-0 gap-1 overflow-x-auto pb-3 lg:pb-0 lg:overflow-x-visible mb-4 lg:mb-0 -mx-4 px-4 lg:mx-0 lg:px-0">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onSectionChange(id)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 lg:w-full',
              activeSection === id
                ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]'
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0 w-full">{children}</div>
    </div>
  )
}
