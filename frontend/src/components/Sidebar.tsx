import { Home, LayoutGrid, Settings, Wrench, Sun, Moon, Calendar, Plane, BarChart3, Scale, TrendingUp, Activity } from 'lucide-react'
import { cn } from '../lib/utils'

interface SidebarProps {
  page: string
  onNavigate: (page: 'home' | 'rooms' | 'liveview' | 'settings' | 'wizard' | 'schedule' | 'away' | 'engineering' | 'historian' | 'balancing' | 'statistics') => void
  engineering: boolean
  onToggleEngineering: () => void
  dark: boolean
  onToggleDark: () => void
}

export function Sidebar({
  page,
  onNavigate,
  engineering,
  onToggleEngineering,
  dark,
  onToggleDark,
}: SidebarProps) {
  return (
    <div className="w-[220px] h-full flex flex-col bg-[var(--bg-card)] border-r border-[var(--border)]">
      {/* Logo */}
      <div className="p-4 border-b border-[var(--border)] flex flex-col items-center">
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="Quantum Swarm Heating"
          className="w-36 h-auto mb-1 rounded-lg"
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1">
        <NavItem
          icon={<Home size={18} />}
          label="Home"
          active={page === 'home'}
          onClick={() => onNavigate('home')}
        />
        <NavItem
          icon={<Activity size={18} />}
          label="Live View"
          active={page === 'liveview'}
          onClick={() => onNavigate('liveview')}
        />
        <NavItem
          icon={<LayoutGrid size={18} />}
          label="Rooms"
          active={page === 'rooms'}
          onClick={() => onNavigate('rooms')}
        />
        <NavItem
          icon={<Calendar size={18} />}
          label="Schedule"
          active={page === 'schedule'}
          onClick={() => onNavigate('schedule')}
        />
        <NavItem
          icon={<Plane size={18} />}
          label="Away"
          active={page === 'away'}
          onClick={() => onNavigate('away')}
        />
        <NavItem
          icon={<TrendingUp size={18} />}
          label="Statistics"
          active={page === 'statistics'}
          onClick={() => onNavigate('statistics')}
        />
        {engineering && (
          <>
            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Engineering
            </p>
            <NavItem
              icon={<Wrench size={18} />}
              label="Engineering"
              active={page === 'engineering'}
              onClick={() => onNavigate('engineering')}
            />
            <NavItem
              icon={<Scale size={18} />}
              label="Balancing"
              active={page === 'balancing'}
              onClick={() => onNavigate('balancing')}
            />
            <NavItem
              icon={<BarChart3 size={18} />}
              label="Historian"
              active={page === 'historian'}
              onClick={() => onNavigate('historian')}
            />
            <NavItem
              icon={<Settings size={18} />}
              label="Settings"
              active={page === 'settings'}
              onClick={() => onNavigate('settings')}
            />
          </>
        )}
      </nav>

      {/* Footer controls */}
      <div className="p-3 border-t border-[var(--border)] space-y-2">
        <button
          onClick={onToggleEngineering}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
            engineering
              ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg)]'
          )}
        >
          <Wrench size={16} />
          Engineering
        </button>
        <button
          onClick={onToggleDark}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:bg-[var(--bg)]"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]'
      )}
    >
      {icon}
      {label}
    </button>
  )
}
