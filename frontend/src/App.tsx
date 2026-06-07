import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import { ReconnectingOverlay } from './components/ReconnectingOverlay'
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
import { Scop } from './pages/Scop'
import { Forecast } from './pages/Forecast'
import { Valves } from './pages/Valves'
import { Swarm } from './pages/Swarm'
import { useLiveConnection } from './hooks/useLive'
import { apiUrl } from './lib/api'
import { ENGINEERING_PAGES } from './lib/constants'

export type Page = 'home' | 'rooms' | 'liveview' | 'settings' | 'wizard' | 'schedule' | 'away' | 'engineering' | 'historian' | 'balancing' | 'statistics' | 'scop' | 'forecast' | 'valves' | 'swarm'

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

  const { disconnectedSince } = useLiveConnection()

  // Guard: if engineering toggle is off and current page is engineering-only, show home
  const activePage = !engineering && (ENGINEERING_PAGES as readonly string[]).includes(page)
    ? 'home' as Page
    : page

  // First-run detection: route to wizard ONLY when the backend authoritatively
  // says so. /api/status's `setup_mode` is the canonical signal. The
  // /api/config "Config not yet loaded" check is a fallback for the case
  // where /api/status itself is unreachable — it must NOT fire on a normal
  // boot where /api/status returns 200 with setup_mode=false but
  // /api/config's _config_ref has not yet been populated by the first
  // pipeline cycle (INSTRUCTION-240 root cause; the backend reorder closes
  // that window, this guard closes the class).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const statusResp = await fetch(apiUrl('api/status'))
        if (statusResp.ok) {
          const statusBody: unknown = await statusResp.json().catch(() => null)
          if (statusBody && typeof statusBody === 'object') {
            const sm = (statusBody as { setup_mode?: unknown }).setup_mode
            if (sm === true && !cancelled) setPage('wizard')
            // If /api/status answered with a parseable JSON object, trust it.
            // sm === false → home page. sm === undefined-but-status-OK → home
            // page (older schema; conservative). Do NOT fall through to
            // /api/config in either of those cases. A null / non-object body
            // (rare: empty response, parse failure) does NOT terminate here
            // and falls through to the /api/config fallback — the
            // conservative branch documented at V1.5 finding 4.
            return
          }
        }
      } catch {
        // network error / fetch threw — fall through to /api/config fallback
      }
      try {
        const configResp = await fetch(apiUrl('api/config'))
        const configBody: unknown = await configResp.json().catch(() => null)
        if (
          configBody &&
          typeof configBody === 'object' &&
          (configBody as { error?: unknown }).error === 'Config not yet loaded'
        ) {
          if (!cancelled) setPage('wizard')
        }
      } catch {
        // routing fetch failure must never white-screen the app
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Wizard is full-screen (no sidebar)
  if (activePage === 'wizard') {
    return (
      <>
        <Wizard
          onComplete={() => { setWizardCanExit(false); setPage('home') }}
          onExit={wizardCanExit ? () => { setWizardCanExit(false); setPage('settings') } : undefined}
        />
        <ReconnectingOverlay disconnectedSince={disconnectedSince} />
      </>
    )
  }

  return (
    <>
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
        {activePage === 'scop' && <Scop />}
        {activePage === 'forecast' && <Forecast />}
        {activePage === 'valves' && <Valves />}
        {activePage === 'swarm' && <Swarm />}
        {activePage === 'settings' && (
          <Settings onRunWizard={() => { setWizardCanExit(true); setPage('wizard') }} />
        )}
      </Layout>
      <ReconnectingOverlay disconnectedSince={disconnectedSince} />
    </>
  )
}
