import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Rooms } from './pages/Rooms'
import { Wizard } from './pages/Wizard'
import { Settings } from './pages/Settings'
import { Schedule } from './pages/Schedule'
import { Away } from './pages/Away'
import { Engineering } from './pages/Engineering'
import { Historian } from './pages/Historian'
import { Balancing } from './pages/Balancing'
import { Statistics } from './pages/Statistics'
import { LiveView } from './pages/LiveView'
import { apiUrl } from './lib/api'
import { ENGINEERING_PAGES } from './lib/constants'

type Page = 'home' | 'rooms' | 'liveview' | 'settings' | 'wizard' | 'schedule' | 'away' | 'engineering' | 'historian' | 'balancing' | 'statistics'

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [wizardCanExit, setWizardCanExit] = useState(false)
  const [engineering, setEngineering] = useState(() =>
    localStorage.getItem('qsh-engineering') === 'true'
  )
  const [dark, setDark] = useState(() =>
    localStorage.getItem('qsh-dark') === 'true'
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('qsh-dark', String(dark))
  }, [dark])

  useEffect(() => {
    localStorage.setItem('qsh-engineering', String(engineering))
  }, [engineering])

  // Guard: if engineering toggle is off and current page is engineering-only, show home
  const activePage = !engineering && (ENGINEERING_PAGES as readonly string[]).includes(page)
    ? 'home' as Page
    : page

  // First-run detection: redirect to wizard if no config
  useEffect(() => {
    fetch(apiUrl('api/config'))
      .then((r) => r.json())
      .then((data) => {
        if (data?.error === 'Config not yet loaded') {
          setPage('wizard')
        }
      })
      .catch(() => {})
  }, [])

  // Wizard is full-screen (no sidebar)
  if (activePage === 'wizard') {
    return (
      <Wizard
        onComplete={() => { setWizardCanExit(false); setPage('home') }}
        onExit={wizardCanExit ? () => { setWizardCanExit(false); setPage('settings') } : undefined}
      />
    )
  }

  return (
    <Layout
      page={activePage}
      onNavigate={setPage}
      engineering={engineering}
      onToggleEngineering={() => setEngineering(!engineering)}
      dark={dark}
      onToggleDark={() => setDark(!dark)}
    >
      {activePage === 'home' && <Home engineering={engineering} onNavigate={setPage} />}
      {activePage === 'liveview' && <LiveView dark={dark} engineering={engineering} />}
      {activePage === 'rooms' && <Rooms engineering={engineering} />}
      {activePage === 'schedule' && <Schedule />}
      {activePage === 'away' && <Away />}
      {activePage === 'engineering' && <Engineering />}
      {activePage === 'historian' && <Historian />}
      {activePage === 'balancing' && <Balancing />}
      {activePage === 'statistics' && <Statistics />}
      {activePage === 'settings' && (
        <Settings onRunWizard={() => { setWizardCanExit(true); setPage('wizard') }} />
      )}
    </Layout>
  )
}
