import { type ReactNode, useState } from 'react'
import { Sidebar } from './Sidebar'
import { Menu } from 'lucide-react'

interface LayoutProps {
  page: string
  onNavigate: (page: 'home' | 'rooms' | 'liveview' | 'settings' | 'wizard' | 'schedule' | 'away' | 'engineering' | 'historian' | 'balancing' | 'statistics') => void
  engineering: boolean
  onToggleEngineering: () => void
  dark: boolean
  onToggleDark: () => void
  children: ReactNode
}

export function Layout({
  page,
  onNavigate,
  engineering,
  onToggleEngineering,
  dark,
  onToggleDark,
  children,
}: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed lg:static z-40 h-full transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          page={page}
          onNavigate={(p) => {
            onNavigate(p)
            setSidebarOpen(false)
          }}
          engineering={engineering}
          onToggleEngineering={onToggleEngineering}
          dark={dark}
          onToggleDark={onToggleDark}
        />
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 p-4 lg:p-6"
            style={{ '--header-h': '60px' } as React.CSSProperties}>
        {/* Mobile header */}
        <div className="lg:hidden mb-4 flex items-center gap-3"
             style={{ '--header-h': '60px' } as React.CSSProperties}>
          <button
            className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="QSH" className="h-8 w-auto rounded" />
        </div>
        {children}
      </main>
    </div>
  )
}
