import type { LiveViewData, LiveViewRoom } from './liveViewTypes'

// ---------------------------------------------------------------------------
// Internal particle / layout types (not exported)
// ---------------------------------------------------------------------------

interface FlowParticle {
  t: number; speed: number; roomId: string; isReturn: boolean; alpha: number
}

interface NeuralPulse {
  t: number; speed: number; roomId: string; alpha: number; radius: number
}

interface WallLeak {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; size: number; roomId: string
}

interface DHWParticle {
  t: number; speed: number; pathType: 'flow' | 'return'; alpha: number
}

interface RoomPosition { nx: number; ny: number }
interface Point { x: number; y: number }

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

interface Palette {
  bg: string; bgCard: string; text: string; textMuted: string; border: string
  accent: string; green: string; amber: string; blue: string; red: string
  cyan: string; purple: string; ice: string; heatLoss: string; heatLossGlow: string
}

// ---------------------------------------------------------------------------
// Layout profile — portrait-aware design space
// ---------------------------------------------------------------------------

interface LayoutProfile {
  dw: number
  dh: number
  cx: number
  cy: number
  roomRing: number
  dhwRing: number
  hpRadius: number
  minRoomRadius: number
  maxRoomRadius: number
  fontSize: {
    title: number
    annotation: number
    nodeTemp: number
    labelName: number
    labelSub: number
    labelStatus: number
  }
  showLabels: boolean
  compactLabels: boolean
}

// ---------------------------------------------------------------------------
// Heart beat parameters per strategy
// ---------------------------------------------------------------------------

interface HeartParams { colour: string; hz: number; amp: number }

const HEART_PARAMS: Record<string, HeartParams> = {
  heating:     { colour: '#e67e22', hz: 1.2, amp: 0.08 },
  equilibrium: { colour: '#22c55e', hz: 0.6, amp: 0.04 },
  hw:          { colour: '#06b6d4', hz: 0.9, amp: 0.06 },
  cycle_pause: { colour: '#f59e0b', hz: 0.3, amp: 0.03 },
  monitoring:  { colour: '#94a3b8', hz: 0.2, amp: 0.02 },
  shadow:      { colour: '#a855f7', hz: 0.15, amp: 0.02 },
}

const PATH_SEGMENTS = 40
const SPREAD = 14
// Hard cap per particle array — defends GPU budget on HA Companion WebView
// when a tab returns to focus after a long background period and spawn rate
// × dt would otherwise produce a burst.
const MAX_PARTICLES_PER_TYPE = 200

// ---------------------------------------------------------------------------
// LiveViewEngine
// ---------------------------------------------------------------------------

export class LiveViewEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private data: LiveViewData | null = null
  private animFrameId = 0

  // Layout profile (portrait-aware design space)
  private lp: LayoutProfile = LiveViewEngine.desktopProfile()
  private portrait = false
  // Halve particle count on mobile to stay within GPU budget on HA Companion WebView.
  // Mobile canvas pixel area is ~25% of desktop but 0.5 (not 0.25) keeps the
  // animation visually active — particles are already smaller due to scaling.
  private particleScale = 1

  static desktopProfile(): LayoutProfile {
    return {
      dw: 1040, dh: 760, cx: 520, cy: 380,
      roomRing: 240, dhwRing: 285, hpRadius: 36,
      minRoomRadius: 18, maxRoomRadius: 40,
      fontSize: { title: 16, annotation: 12, nodeTemp: 11, labelName: 12, labelSub: 10, labelStatus: 10 },
      showLabels: true, compactLabels: false,
    }
  }

  // cy: 330 — HP at y=330 with ring=155 gives topmost node at y=175 (155px title
  // clearance) and bottommost at y=485. On iPhone SE (568px viewport, ~488px after
  // header), scale ≈ 488/720 = 0.68, so bottommost node renders at pixel 330 with
  // 158px below for labels/annotations.
  static mobileProfile(): LayoutProfile {
    return {
      dw: 480, dh: 720, cx: 240, cy: 330,
      roomRing: 155, dhwRing: 195, hpRadius: 34,
      minRoomRadius: 20, maxRoomRadius: 36,
      fontSize: { title: 14, annotation: 11, nodeTemp: 11, labelName: 9, labelSub: 8, labelStatus: 8 },
      showLabels: true, compactLabels: true,
    }
  }

  // Layout
  private roomPos: Map<string, RoomPosition> = new Map()
  private roomAngles: number[] = []
  private paths: Map<string, { flow: Point[]; ret: Point[]; neural: Point[] }> = new Map()
  private dhwPos: { x: number; y: number; angle: number } | null = null
  private dhwPaths: { flow: Point[]; returnPath: Point[] } | null = null

  // Particles
  private flowP: FlowParticle[] = []
  private neuralP: NeuralPulse[] = []
  private wallP: WallLeak[] = []
  private dhwP: DHWParticle[] = []

  // Heartbeat
  private heartPhase = 0
  private pulseScale = 1
  private heartRing = 0

  // Shoulder cycling
  private shoulderTimer = 0
  private shoulderHpOn = true

  // DHW cylinder fill
  private dhwFill = 0

  // Defrost
  private defrostPhase = 0

  // Scaling
  private sc = 1
  private ox = 0
  private oy = 0

  // Timing
  private lastTime = 0
  private prevRoomCount = 0

  // FPS instrumentation (engineering overlay)
  private fps = 0
  private fpsAccum = 0
  private fpsFrames = 0
  private engineering = false

  // Palette
  private dark = true
  private C: Palette = LiveViewEngine.darkPalette()

  private static darkPalette(): Palette {
    return {
      bg: '#0f172a', bgCard: '#1e293b', text: '#f1f5f9',
      textMuted: '#94a3b8', border: '#334155', accent: '#e67e22',
      green: '#22c55e', amber: '#f59e0b', blue: '#3b82f6',
      red: '#ef4444', cyan: '#06b6d4', purple: '#a855f7', ice: '#7dd3fc',
      heatLoss: '#ef4444', heatLossGlow: '#dc2626',
    }
  }

  private static lightPalette(): Palette {
    return {
      bg: '#f8f9fa', bgCard: '#ffffff', text: '#1a1a2e',
      textMuted: '#6b7280', border: '#e5e7eb', accent: '#e67e22',
      green: '#16a34a', amber: '#d97706', blue: '#2563eb',
      red: '#dc2626', cyan: '#0891b2', purple: '#9333ea', ice: '#38bdf8',
      heatLoss: '#dc2626', heatLossGlow: '#b91c1c',
    }
  }

  // -------------------------------------------------------------------
  // Constructor / lifecycle
  // -------------------------------------------------------------------

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.resize()
  }

  setData(data: LiveViewData): void {
    this.data = data
    if (data.rooms.length !== this.prevRoomCount) {
      this.layoutRooms()
      this.computePaths()
      this.prevRoomCount = data.rooms.length
    }
  }

  start(): void {
    // Idempotent: cancel any in-flight RAF handle before starting a new loop
    // so double-start (e.g. mount + visibilitychange race) does not leak
    // animation callbacks. Resetting lastTime ensures the first post-(re)start
    // frame uses dt = 16 ms instead of a stale time - lastTime delta.
    if (this.animFrameId !== 0) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = 0
    }
    this.lastTime = 0
    const loop = (time: number) => {
      this.frame(time)
      this.animFrameId = requestAnimationFrame(loop)
    }
    this.animFrameId = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.animFrameId)
    // Zero the handle so start() can correctly recognise the stopped state
    // and we do not cancelAnimationFrame a stale id on the next start.
    this.animFrameId = 0
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1
    const cw = this.canvas.clientWidth || this.lp.dw
    const ch = this.canvas.clientHeight || this.lp.dh
    this.canvas.width = cw * dpr
    this.canvas.height = ch * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 5% hysteresis band prevents rapid profile toggling near square aspect ratios
    const isPortrait = this.portrait
      ? cw <= ch * 1.05   // already portrait — stay until clearly landscape
      : ch > cw * 1.05    // currently landscape — switch only when clearly portrait

    if (isPortrait !== this.portrait) {
      this.portrait = isPortrait
      this.lp = isPortrait ? LiveViewEngine.mobileProfile() : LiveViewEngine.desktopProfile()
      if (this.data) {
        this.layoutRooms()
        this.computePaths()
      }
    }

    this.particleScale = this.portrait ? 0.5 : 1

    const sx = cw / this.lp.dw
    const sy = ch / this.lp.dh
    this.sc = Math.min(sx, sy)
    this.ox = (cw - this.lp.dw * this.sc) / 2
    this.oy = (ch - this.lp.dh * this.sc) / 2
  }

  destroy(): void {
    this.stop()
    this.flowP.length = 0
    this.neuralP.length = 0
    this.wallP.length = 0
    this.dhwP.length = 0
  }

  setDark(dark: boolean): void {
    if (dark === this.dark) return
    this.dark = dark
    this.C = dark ? LiveViewEngine.darkPalette() : LiveViewEngine.lightPalette()
  }

  setEngineering(on: boolean): void {
    this.engineering = on
  }

  getFps(): number { return this.fps }

  // -------------------------------------------------------------------
  // Coordinate helpers
  // -------------------------------------------------------------------

  private $x(x: number): number { return x * this.sc + this.ox }
  private $y(y: number): number { return y * this.sc + this.oy }
  private $s(s: number): number { return s * this.sc }

  // -------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------

  private isHW(): boolean { return this.data?.state.strategy === 'hw' }
  private isShadow(): boolean { return this.data?.state.strategy === 'shadow' }
  private isDefrost(): boolean { return this.data?.state.cyclePause === 'defrost' }

  private copColour(cop: number): string {
    if (cop >= 4.0) return this.C.green
    if (cop >= 3.0) return this.C.amber
    if (cop >= 2.0) return this.C.accent
    return this.C.red
  }

  private hpActive(): boolean {
    if (!this.data) return false
    const s = this.data.state
    if (s.strategy === 'shadow' || s.strategy === 'monitoring') return false
    if (s.strategy === 'cycle_pause') return false
    if (s.season === 'shoulder') return this.shoulderHpOn
    return true
  }

  // -------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------

  private layoutRooms(): void {
    if (!this.data) return
    const rooms = this.data.rooms
    const n = rooms.length
    this.roomPos.clear()
    this.roomAngles = []

    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
      this.roomAngles.push(angle)
      this.roomPos.set(rooms[i].id, {
        nx: this.lp.cx + Math.cos(angle) * this.lp.roomRing,
        ny: this.lp.cy + Math.sin(angle) * this.lp.roomRing,
      })
    }

    // DHW position: largest angular gap
    this.dhwPos = null
    this.dhwPaths = null
    if (this.data.dhw.hasCylinder && n > 0) {
      const sorted = [...this.roomAngles].sort((a, b) => a - b)

      // Build candidate gaps sorted by size (largest first)
      const gaps: { mid: number; size: number }[] = []
      for (let i = 0; i < sorted.length; i++) {
        const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 2 * Math.PI
        const size = next - sorted[i]
        gaps.push({ mid: sorted[i] + size / 2, size })
      }
      gaps.sort((a, b) => b.size - a.size)

      // Minimum angular clearance from any room node (in radians).
      // At dhwRing=285 and roomRing=240, a 15° clearance gives ~60px
      // separation at the room ring — enough to avoid visual overlap
      // with the largest room nodes (~40px radius).
      const MIN_CLEARANCE = (15 * Math.PI) / 180  // 15 degrees

      // Pick the first gap whose midpoint has at least MIN_CLEARANCE
      // from every room angle. If no gap qualifies (very dense layouts),
      // fall back to the largest gap (original behaviour).
      let midAngle = gaps[0].mid  // fallback
      for (const g of gaps) {
        const clear = sorted.every(a => {
          let diff = Math.abs(g.mid - a)
          if (diff > Math.PI) diff = 2 * Math.PI - diff
          return diff >= MIN_CLEARANCE
        })
        if (clear) { midAngle = g.mid; break }
      }

      this.dhwPos = {
        x: this.lp.cx + Math.cos(midAngle) * this.lp.dhwRing,
        y: this.lp.cy + Math.sin(midAngle) * this.lp.dhwRing,
        angle: midAngle,
      }
    }
  }

  // -------------------------------------------------------------------
  // Bezier path computation
  // -------------------------------------------------------------------

  private computePaths(): void {
    if (!this.data) return
    this.paths.clear()

    for (const room of this.data.rooms) {
      const pos = this.roomPos.get(room.id)
      if (!pos) continue
      const centre = this.buildCentrePath(this.lp.cx, this.lp.cy, pos.nx, pos.ny)
      const flow = this.offsetPath(centre, 1)
      const ret = this.offsetPath(centre, -1).reverse()
      const neural = centre.map(p => ({ ...p }))
      this.paths.set(room.id, { flow, ret, neural })
    }

    // DHW paths
    if (this.dhwPos) {
      const centre = this.buildCentrePath(this.lp.cx, this.lp.cy, this.dhwPos.x, this.dhwPos.y)
      const flow = this.offsetPath(centre, 1)
      const returnPath = this.offsetPath(centre, -1).reverse()
      this.dhwPaths = { flow, returnPath }
    }
  }

  private buildCentrePath(x0: number, y0: number, x1: number, y1: number): Point[] {
    const pts: Point[] = []
    for (let i = 0; i <= PATH_SEGMENTS; i++) {
      const t = i / PATH_SEGMENTS
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t })
    }
    return pts
  }

  private offsetPath(src: Point[], side: number): Point[] {
    const pts: Point[] = []
    const last = src.length - 1
    for (let i = 0; i <= last; i++) {
      const prev = src[Math.max(0, i - 1)]
      const next = src[Math.min(last, i + 1)]
      const tdx = next.x - prev.x
      const tdy = next.y - prev.y
      const tLen = Math.sqrt(tdx * tdx + tdy * tdy) || 1
      // Perpendicular unit vector
      const px = -tdy / tLen
      const py = tdx / tLen
      const t = i / last
      const envelope = Math.sin(Math.PI * t)
      pts.push({ x: src[i].x + px * SPREAD * envelope * side, y: src[i].y + py * SPREAD * envelope * side })
    }
    return pts
  }

  private pathLerp(path: Point[], t: number): Point {
    const idx = t * (path.length - 1)
    const i = Math.min(Math.floor(idx), path.length - 2)
    const f = idx - i
    return {
      x: path[i].x + (path[i + 1].x - path[i].x) * f,
      y: path[i].y + (path[i + 1].y - path[i].y) * f,
    }
  }

  // -------------------------------------------------------------------
  // Frame / update
  // -------------------------------------------------------------------

  private frame(time: number): void {
    const dt = this.lastTime === 0 ? 16 : Math.min(time - this.lastTime, 50)
    this.lastTime = time
    const dtS = dt / 1000

    // FPS accumulator — recompute once per second of render-time.
    this.fpsAccum += dt
    this.fpsFrames += 1
    if (this.fpsAccum >= 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccum)
      this.fpsAccum = 0
      this.fpsFrames = 0
    }

    if (!this.data) {
      this.drawWaiting(dtS)
      if (this.engineering) this.drawFpsOverlay()
      return
    }
    this.update(dtS)
    this.draw()
    if (this.engineering) this.drawFpsOverlay()
  }

  private update(dt: number): void {
    if (!this.data) return
    const state = this.data.state

    // Heartbeat
    const hp = HEART_PARAMS[state.strategy] ?? HEART_PARAMS.heating
    this.heartPhase += dt * hp.hz * Math.PI * 2
    const beat = Math.sin(this.heartPhase)
    this.pulseScale = 1 + hp.amp * Math.max(0, beat)
    if (beat > 0.98) this.heartRing = 1
    this.heartRing = Math.max(0, this.heartRing - dt * 1.5)

    // Shoulder cycling (toggle every 8s)
    if (state.season === 'shoulder') {
      this.shoulderTimer += dt
      if (this.shoulderTimer >= 8) {
        this.shoulderTimer -= 8
        this.shoulderHpOn = !this.shoulderHpOn
      }
    } else {
      this.shoulderHpOn = true
      this.shoulderTimer = 0
    }

    // DHW fill
    if (this.isHW() && this.data.dhw.hasCylinder) {
      this.dhwFill = Math.min(1, this.dhwFill + dt * 0.15)
    } else {
      this.dhwFill = Math.max(0, this.dhwFill - dt * 0.3)
    }

    // Defrost
    if (this.isDefrost()) {
      this.defrostPhase += dt * 0.8
    }

    // Spawn & update particles
    this.updateFlowParticles(dt)
    this.updateNeuralPulses(dt)
    this.updateWallLeaks(dt)
    this.updateDHWParticles(dt)
  }

  // -------------------------------------------------------------------
  // Particle systems
  // -------------------------------------------------------------------

  private updateFlowParticles(dt: number): void {
    if (!this.data) return
    // No flow particles when HP is inactive (shadow, monitoring, cycle pause)
    if (!this.hpActive() && !this.isHW()) return
    const isHwActive = this.isHW()
    const plan = this.data.dhw.hwPlan

    // Hard cap guard — skip spawning if array is already saturated.
    if (this.flowP.length < MAX_PARTICLES_PER_TYPE) {
      for (const room of this.data.rooms) {
        if (room.valve <= 0) continue
        // Plumbing-aware: W/Y plans stop room particles during HW
        if (isHwActive && (plan === 'W' || plan === 'Y')) continue
        // S/S+ plans: reduced rate during HW
        const rateMult = isHwActive && (plan === 'S' || plan === 'S+') ? 0.3 : 1
        const spawnRate = (room.valve / 100) * 2.5 * rateMult * this.particleScale
        if (Math.random() < spawnRate * dt) {
          this.flowP.push({
            t: 0, speed: 0.15 + Math.random() * 0.1,
            roomId: room.id, isReturn: false, alpha: 0.7 + Math.random() * 0.3,
          })
        }
        // Return particles at lower rate (particleScale already in spawnRate)
        if (Math.random() < spawnRate * 0.6 * dt) {
          this.flowP.push({
            t: 0, speed: 0.12 + Math.random() * 0.08,
            roomId: room.id, isReturn: true, alpha: 0.5 + Math.random() * 0.3,
          })
        }
      }
    }

    // Move & cull
    for (let i = this.flowP.length - 1; i >= 0; i--) {
      this.flowP[i].t += this.flowP[i].speed * dt
      if (this.flowP[i].t > 1) this.flowP.splice(i, 1)
    }
  }

  private updateNeuralPulses(dt: number): void {
    if (!this.data) return
    const s = this.data.state.strategy
    if (s !== 'heating' && s !== 'equilibrium') {
      // Remove existing
      this.neuralP.length = 0
      return
    }
    // Hard cap guard — skip spawning if array is already saturated.
    if (this.neuralP.length < MAX_PARTICLES_PER_TYPE) {
      for (const room of this.data.rooms) {
        if (Math.random() < 0.3 * dt * this.particleScale) {
          this.neuralP.push({
            t: 0, speed: 0.2 + Math.random() * 0.1,
            roomId: room.id, alpha: 0.6, radius: 2,
          })
        }
      }
    }
    for (let i = this.neuralP.length - 1; i >= 0; i--) {
      const p = this.neuralP[i]
      p.t += p.speed * dt
      p.alpha = 0.6 * (1 - p.t)
      p.radius = 2 + p.t * 4
      if (p.t > 1) this.neuralP.splice(i, 1)
    }
  }

  private updateWallLeaks(dt: number): void {
    if (!this.data) return
    // Hard cap guard — skip spawning if array is already saturated.
    if (this.wallP.length < MAX_PARTICLES_PER_TYPE) {
      for (const room of this.data.rooms) {
        const pos = this.roomPos.get(room.id)
        if (!pos) continue
        const rate = room.u * 3
        if (Math.random() < rate * dt * this.particleScale) {
          const angle = Math.random() * Math.PI * 2
          this.wallP.push({
            x: pos.nx, y: pos.ny,
            vx: Math.cos(angle) * (20 + Math.random() * 15),
            vy: Math.sin(angle) * (20 + Math.random() * 15),
            life: 0, maxLife: 1.5 + Math.random(), size: 1.5 + Math.random(),
            roomId: room.id,
          })
        }
      }
    }
    for (let i = this.wallP.length - 1; i >= 0; i--) {
      const p = this.wallP[i]
      p.life += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.life >= p.maxLife) this.wallP.splice(i, 1)
    }
  }

  private updateDHWParticles(dt: number): void {
    if (!this.data || !this.isHW() || !this.data.dhw.hasCylinder || !this.dhwPaths) {
      this.dhwP.length = 0
      return
    }
    // Hard cap guard — skip spawning if array is already saturated.
    if (this.dhwP.length < MAX_PARTICLES_PER_TYPE) {
      if (Math.random() < 3 * dt * this.particleScale) {
        this.dhwP.push({
          t: 0, speed: 0.2 + Math.random() * 0.1,
          pathType: Math.random() < 0.6 ? 'flow' : 'return', alpha: 0.8,
        })
      }
    }
    for (let i = this.dhwP.length - 1; i >= 0; i--) {
      this.dhwP[i].t += this.dhwP[i].speed * dt
      if (this.dhwP[i].t > 1) this.dhwP.splice(i, 1)
    }
  }

  // -------------------------------------------------------------------
  // Drawing — main pipeline
  // -------------------------------------------------------------------

  private draw(): void {
    if (!this.data) return
    const { ctx } = this
    const cw = this.canvas.clientWidth || this.lp.dw
    const ch = this.canvas.clientHeight || this.lp.dh
    ctx.clearRect(0, 0, cw, ch)

    this.drawBackground(cw, ch)
    this.drawEdges()
    this.drawRoomNodes()
    this.drawDHWCylinder()
    this.drawHeart()
    this.drawParticles()
    this.drawLabels()
    this.drawAnnotations()
    this.drawLegend()
    if (this.isDefrost()) this.drawDefrost()
  }

  // -------------------------------------------------------------------
  // drawWaiting — null-data visual
  // -------------------------------------------------------------------

  private drawWaiting(dt: number): void {
    const { ctx } = this
    const cw = this.canvas.clientWidth || this.lp.dw
    const ch = this.canvas.clientHeight || this.lp.dh
    ctx.clearRect(0, 0, cw, ch)
    this.drawBackground(cw, ch)

    // Slow pulse for dimmed heart outline
    this.heartPhase += dt * 0.12 * Math.PI * 2
    const pulse = 1 + 0.03 * Math.sin(this.heartPhase)

    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.arc(this.$x(this.lp.cx), this.$y(this.lp.cy), this.$s(this.lp.hpRadius * pulse), 0, Math.PI * 2)
    ctx.strokeStyle = this.C.accent
    ctx.lineWidth = this.$s(2)
    ctx.stroke()
    ctx.restore()

    // Title
    ctx.fillStyle = this.C.text
    ctx.font = `${this.$s(18)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('How Heat Lives in Your Home', this.$x(this.lp.cx), this.$y(this.portrait ? 60 : 80))

    // Waiting label
    ctx.fillStyle = this.C.textMuted
    ctx.font = `${this.$s(14)}px sans-serif`
    ctx.fillText('Waiting for data\u2026', this.$x(this.lp.cx), this.$y(this.lp.cy + 70))
  }

  // -------------------------------------------------------------------
  // drawBackground
  // -------------------------------------------------------------------

  private drawBackground(cw: number, ch: number): void {
    const { ctx } = this
    ctx.fillStyle = this.C.bg
    ctx.fillRect(0, 0, cw, ch)

    // Subtle radial gradient
    const grd = ctx.createRadialGradient(
      this.$x(this.lp.cx), this.$y(this.lp.cy), 0,
      this.$x(this.lp.cx), this.$y(this.lp.cy), this.$s(400),
    )
    if (this.dark) {
      grd.addColorStop(0, 'rgba(30,41,59,0.5)')
      grd.addColorStop(1, 'rgba(15,23,42,0)')
    } else {
      grd.addColorStop(0, 'rgba(226,232,240,0.5)')
      grd.addColorStop(1, 'rgba(248,249,250,0)')
    }
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, cw, ch)
  }

  // -------------------------------------------------------------------
  // drawEdges — Bezier flow/return/neural paths
  // -------------------------------------------------------------------

  private drawEdges(): void {
    if (!this.data) return
    const { ctx } = this
    const opacityMult = this.dark ? 1.0 : 1.8
    const shadowMod = this.isShadow() ? 0.3 : 1.0

    for (const room of this.data.rooms) {
      const pathSet = this.paths.get(room.id)
      if (!pathSet) continue
      const valveNorm = room.valve / 100

      ctx.save()
      ctx.lineCap = 'round'

      // Flow path (orange/accent) — outer glow
      ctx.save()
      ctx.globalAlpha = Math.min((0.04 + valveNorm * 0.06) * opacityMult * shadowMod, 0.95)
      ctx.strokeStyle = this.C.accent
      ctx.lineWidth = this.$s(4 + valveNorm * 4)
      ctx.shadowBlur = this.$s(8)
      ctx.shadowColor = this.C.accent
      ctx.beginPath()
      this.strokePath(pathSet.flow)
      ctx.stroke()
      ctx.restore()

      // Flow path (orange/accent) — inner core
      ctx.save()
      ctx.globalAlpha = Math.min((0.15 + valveNorm * 0.25) * opacityMult * shadowMod, 0.95)
      ctx.strokeStyle = this.C.accent
      ctx.lineWidth = this.$s(0.8 + valveNorm * 1.8)
      ctx.shadowBlur = this.$s(2)
      ctx.shadowColor = this.C.accent
      ctx.beginPath()
      this.strokePath(pathSet.flow)
      ctx.stroke()
      ctx.restore()

      // Neural path (cyan) — dashed, not dimmed in shadow
      ctx.save()
      ctx.setLineDash([this.$s(2), this.$s(5)])
      ctx.globalAlpha = Math.min((this.isShadow() ? 0.35 : 0.22) * opacityMult, 0.95)
      ctx.strokeStyle = this.C.cyan
      ctx.lineWidth = this.$s(0.6)
      ctx.shadowBlur = this.$s(3)
      ctx.shadowColor = this.C.cyan
      ctx.beginPath()
      this.strokePath(pathSet.neural)
      ctx.stroke()
      ctx.restore()

      // Return path (blue) — outer glow
      ctx.save()
      ctx.globalAlpha = Math.min((0.03 + valveNorm * 0.04) * opacityMult * shadowMod, 0.95)
      ctx.strokeStyle = this.C.blue
      ctx.lineWidth = this.$s(3 + valveNorm * 3)
      ctx.shadowBlur = this.$s(6)
      ctx.shadowColor = this.C.blue
      ctx.beginPath()
      this.strokePath(pathSet.ret)
      ctx.stroke()
      ctx.restore()

      // Return path (blue) — inner core
      ctx.save()
      ctx.globalAlpha = Math.min((0.12 + valveNorm * 0.21) * opacityMult * shadowMod, 0.95)
      ctx.strokeStyle = this.C.blue
      ctx.lineWidth = this.$s(0.6 + valveNorm * 1.2)
      ctx.shadowBlur = this.$s(2)
      ctx.shadowColor = this.C.blue
      ctx.beginPath()
      this.strokePath(pathSet.ret)
      ctx.stroke()
      ctx.restore()

      ctx.restore()
    }
  }

  private strokePath(pts: Point[]): void {
    const { ctx } = this
    if (pts.length < 2) return
    ctx.moveTo(this.$x(pts[0].x), this.$y(pts[0].y))
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(this.$x(pts[i].x), this.$y(pts[i].y))
    }
  }

  // -------------------------------------------------------------------
  // drawRoomNodes
  // -------------------------------------------------------------------

  private drawRoomNodes(): void {
    if (!this.data) return
    const { ctx } = this

    for (const room of this.data.rooms) {
      const pos = this.roomPos.get(room.id)
      if (!pos) continue
      const r = this.roomRadius(room)
      const cx = this.$x(pos.nx)
      const cy = this.$y(pos.ny)
      const sr = this.$s(r)

      // Fill based on status
      ctx.beginPath()
      ctx.arc(cx, cy, sr, 0, Math.PI * 2)
      ctx.fillStyle = this.roomColour(room)
      ctx.fill()

      // Valve arc border
      if (room.valve > 0) {
        const valveAngle = (room.valve / 100) * Math.PI * 2
        ctx.beginPath()
        ctx.arc(cx, cy, sr + this.$s(3), -Math.PI / 2, -Math.PI / 2 + valveAngle)
        ctx.strokeStyle = this.C.accent
        ctx.lineWidth = this.$s(2.5)
        ctx.stroke()
      }

      // Outer ring
      ctx.beginPath()
      ctx.arc(cx, cy, sr, 0, Math.PI * 2)
      ctx.strokeStyle = this.C.border
      ctx.lineWidth = this.$s(1)
      ctx.stroke()

      // Temp text
      ctx.fillStyle = this.C.text
      ctx.font = `bold ${this.$s(this.lp.fontSize.nodeTemp)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${room.temp.toFixed(1)}°`, cx, cy)
    }
  }

  private roomRadius(room: LiveViewRoom): number {
    return Math.max(this.lp.minRoomRadius, Math.min(this.lp.maxRoomRadius, 14 + room.area * 0.8))
  }

  private roomColour(room: LiveViewRoom): string {
    switch (room.status) {
      case 'heating': return this.C.accent
      case 'cold': return this.C.blue
      case 'away': return this.C.textMuted
      default: return this.C.green
    }
  }

  // -------------------------------------------------------------------
  // drawHeart
  // -------------------------------------------------------------------

  private drawHeart(): void {
    if (!this.data) return
    const { ctx } = this
    const hp = HEART_PARAMS[this.data.state.strategy] ?? HEART_PARAMS.heating
    const baseR = this.lp.hpRadius
    const cx = this.$x(this.lp.cx)
    const cy = this.$y(this.lp.cy)
    // Dim in shadow mode
    const shadowDim = this.isShadow() ? 0.5 : 1

    // Expanding ring on beat peak
    if (this.heartRing > 0) {
      ctx.save()
      ctx.globalAlpha = this.heartRing * 0.3
      ctx.beginPath()
      ctx.arc(cx, cy, this.$s(baseR * (1 + (1 - this.heartRing) * 0.5)), 0, Math.PI * 2)
      ctx.strokeStyle = hp.colour
      ctx.lineWidth = this.$s(2)
      ctx.stroke()
      ctx.restore()
    }

    // Main circle
    const sr = this.$s(baseR * this.pulseScale)
    ctx.save()
    ctx.globalAlpha = shadowDim
    ctx.beginPath()
    ctx.arc(cx, cy, sr, 0, Math.PI * 2)
    const grd = ctx.createRadialGradient(
      cx, this.$y(this.lp.cy - 8), 0,
      cx, cy, this.$s(baseR),
    )
    grd.addColorStop(0, hp.colour)
    grd.addColorStop(1, this.hexAlpha(hp.colour, 0.6))
    ctx.fillStyle = grd
    ctx.fill()
    // Border ring
    ctx.strokeStyle = this.C.border
    ctx.lineWidth = this.$s(1)
    ctx.stroke()
    ctx.restore()

    // Power readout (shifted up to make room for COP)
    ctx.fillStyle = this.C.text
    ctx.font = `bold ${this.$s(11)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${this.data.hp.power_kw.toFixed(1)}kW`, cx, cy - this.$s(5))

    // COP readout (below power, only when valid)
    const cop = this.data.hp.cop
    if (cop != null && cop > 0) {
      ctx.fillStyle = this.copColour(cop)
      ctx.font = `${this.$s(9)}px sans-serif`
      ctx.fillText(`COP ${cop.toFixed(1)}`, cx, cy + this.$s(8))
    }

    // Multi-source badge
    if (this.data.source.isMultiSource) {
      const bx = this.$x(this.lp.cx + 24)
      const by = this.$y(this.lp.cy + 24)
      ctx.beginPath()
      ctx.arc(bx, by, this.$s(8), 0, Math.PI * 2)
      // All boiler sub-types currently use amber palette.
      // LiveViewSource.type enum retained for future per-type differentiation.
      ctx.fillStyle = this.data.source.type === 'heat_pump' ? this.C.green : this.C.amber
      ctx.fill()
      ctx.fillStyle = this.C.text
      ctx.font = `bold ${this.$s(8)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+', bx, by)
    }
  }

  // -------------------------------------------------------------------
  // drawParticles
  // -------------------------------------------------------------------

  private drawParticles(): void {
    const { ctx } = this

    // Flow particles
    for (const p of this.flowP) {
      const pathSet = this.paths.get(p.roomId)
      if (!pathSet) continue
      const path = p.isReturn ? pathSet.ret : pathSet.flow
      const pt = this.pathLerp(path, p.t)
      ctx.beginPath()
      ctx.arc(this.$x(pt.x), this.$y(pt.y), this.$s(2.5), 0, Math.PI * 2)
      ctx.fillStyle = this.hexAlpha(p.isReturn ? this.C.blue : this.C.accent, p.alpha)
      ctx.fill()
    }

    // Neural pulses
    for (const p of this.neuralP) {
      const pathSet = this.paths.get(p.roomId)
      if (!pathSet) continue
      const pt = this.pathLerp(pathSet.neural, p.t)
      ctx.beginPath()
      ctx.arc(this.$x(pt.x), this.$y(pt.y), this.$s(p.radius), 0, Math.PI * 2)
      ctx.strokeStyle = this.hexAlpha(this.C.purple, p.alpha)
      ctx.lineWidth = this.$s(1)
      ctx.stroke()
    }

    // Wall leaks
    for (const p of this.wallP) {
      const fade = 1 - p.life / p.maxLife
      const px = this.$x(p.x)
      const py = this.$y(p.y)
      const sz = this.$s(p.size * 1.6)
      // Outer glow
      ctx.beginPath()
      ctx.arc(px, py, sz * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = this.hexAlpha(this.C.heatLossGlow, fade * 0.12)
      ctx.fill()
      // Core particle
      ctx.beginPath()
      ctx.arc(px, py, sz, 0, Math.PI * 2)
      ctx.fillStyle = this.hexAlpha(this.C.heatLoss, fade * 0.75)
      ctx.fill()
    }

    // DHW particles
    if (this.dhwPaths) {
      for (const p of this.dhwP) {
        const path = p.pathType === 'flow' ? this.dhwPaths.flow : this.dhwPaths.returnPath
        const pt = this.pathLerp(path, p.t)
        ctx.beginPath()
        ctx.arc(this.$x(pt.x), this.$y(pt.y), this.$s(3), 0, Math.PI * 2)
        ctx.fillStyle = this.hexAlpha(this.C.cyan, p.alpha)
        ctx.fill()
      }
    }
  }

  // -------------------------------------------------------------------
  // drawDHWCylinder
  // -------------------------------------------------------------------

  private drawDHWCylinder(): void {
    if (!this.data || !this.data.dhw.hasCylinder || !this.dhwPos) return
    const { ctx } = this
    const cx = this.$x(this.dhwPos.x)
    const cy = this.$y(this.dhwPos.y)
    const w = this.$s(30)
    const h = this.$s(50)

    // Cylinder body
    ctx.fillStyle = this.C.bgCard
    ctx.strokeStyle = this.isHW() ? this.C.cyan : this.C.border
    ctx.lineWidth = this.$s(1.5)

    // Body rect
    ctx.beginPath()
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, this.$s(4))
    ctx.fill()
    ctx.stroke()

    // Fill level
    if (this.dhwFill > 0) {
      const fillH = h * this.dhwFill
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, this.$s(4))
      ctx.clip()
      ctx.fillStyle = this.hexAlpha(this.C.cyan, 0.3)
      ctx.fillRect(cx - w / 2, cy + h / 2 - fillH, w, fillH)
      ctx.restore()
    }

    // Label
    ctx.fillStyle = this.C.textMuted
    ctx.font = `${this.$s(9)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('DHW', cx, cy + h / 2 + this.$s(4))
  }

  // -------------------------------------------------------------------
  // drawLabels — radial-vector labels (each label on the same ray as its room node)
  // -------------------------------------------------------------------

  private drawLabels(): void {
    if (!this.data || !this.lp.showLabels) return
    const { ctx } = this
    const GAP = 6   // design-space px between node edge and label
    const MARGIN = 8 // min distance from canvas edge

    // --- Phase 1: compute label boxes along each room's radial ray ---

    interface LabelBox {
      idx: number; ux: number; uy: number; nodeR: number
      boxW: number; boxH: number; boxX: number; boxY: number
      textAlign: CanvasTextAlign; nameText: string; subtext: string
      statusText: string; dist: number
    }
    const labels: LabelBox[] = []

    for (let i = 0; i < this.data.rooms.length; i++) {
      const room = this.data.rooms[i]
      const pos = this.roomPos.get(room.id)
      if (!pos) continue

      const r = this.roomRadius(room)
      const angle = this.roomAngles[i]
      const ux = Math.cos(angle)
      const uy = Math.sin(angle)

      // Text content — suppress "ok" status, only show non-normal states
      const nameText = room.name
      const subtext = this.lp.compactLabels ? '' : `${room.temp.toFixed(1)}° / ${room.target.toFixed(1)}°`
      const showStatus = !this.lp.compactLabels && room.status !== 'ok'
      const statusText = showStatus ? room.status : ''

      // Measure widths
      ctx.font = `bold ${this.$s(this.lp.fontSize.labelName)}px sans-serif`
      const nameW = ctx.measureText(nameText).width / this.sc
      let subW = 0
      if (subtext) {
        ctx.font = `${this.$s(this.lp.fontSize.labelSub)}px sans-serif`
        subW = ctx.measureText(subtext).width / this.sc
      }
      let statusW = 0
      if (statusText) {
        ctx.font = `${this.$s(this.lp.fontSize.labelSub)}px sans-serif`
        statusW = ctx.measureText(statusText).width / this.sc
      }
      const boxW = Math.max(nameW, subW, statusW) + 8
      // Height: name only (16), name+sub (28), name+sub+status (38)
      const boxH = this.lp.compactLabels ? 16 : (showStatus ? 38 : 28)

      // Initial distance from node centre along the radial ray
      const dist = r + GAP

      // Compute box position from dist
      const anchorX = pos.nx + ux * dist
      const anchorY = pos.ny + uy * dist
      const cosA = ux
      let boxX: number
      let textAlign: CanvasTextAlign
      if (cosA > 0.3) {
        boxX = anchorX; textAlign = 'left'
      } else if (cosA < -0.3) {
        boxX = anchorX - boxW; textAlign = 'right'
      } else {
        boxX = anchorX - boxW / 2; textAlign = 'center'
      }
      const boxY = anchorY - boxH / 2

      labels.push({ idx: i, ux, uy, nodeR: r, boxW, boxH, boxX, boxY,
        textAlign, nameText, subtext, statusText, dist })
    }

    // --- Phase 2: greedy placement search (guaranteed no overlap) ---
    // Sort labels by angle. For each label, search a grid of candidate
    // positions (radial distance × tangential offset) and accept the first
    // collision-free placement. This is O(n² × k) but guaranteed to find
    // a valid position because total label area is ~4% of canvas area.
    const LABEL_PAD = 3
    const sorted = labels.slice().sort((a, b) => {
      const angA = Math.atan2(a.uy, a.ux)
      const angB = Math.atan2(b.uy, b.ux)
      return angA - angB
    })

    const placed: LabelBox[] = []

    for (const label of sorted) {
      const pos = this.roomPos.get(this.data!.rooms[label.idx].id)
      if (!pos) { placed.push(label); continue }

      // Candidate grid: radial push-out distances and tangential offsets
      const RADIAL = [0, 14, 28, 42, 56, 70, 90]
      const TANGENT = [0, -16, 16, -32, 32, -48, 48, -64, 64]

      // Perpendicular unit vector to the radial ray
      const perpX = -label.uy
      const perpY = label.ux

      let bestX = label.boxX
      let bestY = label.boxY
      let found = false

      for (const rd of RADIAL) {
        if (found) break
        for (const td of TANGENT) {
          const d = label.nodeR + GAP + rd
          const ax = pos.nx + label.ux * d + perpX * td
          const ay = pos.ny + label.uy * d + perpY * td

          // Compute candidate box position with alignment
          let candX: number
          if (label.ux > 0.3) candX = ax
          else if (label.ux < -0.3) candX = ax - label.boxW
          else candX = ax - label.boxW / 2
          const candY = ay - label.boxH / 2

          // Boundary check first (cheapest)
          if (candX < MARGIN || candX + label.boxW > this.lp.dw - MARGIN ||
              candY < MARGIN || candY + label.boxH > this.lp.dh - MARGIN) {
            continue
          }

          // Check against already-placed labels
          let collides = false
          for (const p of placed) {
            if (candX < p.boxX + p.boxW + LABEL_PAD &&
                candX + label.boxW + LABEL_PAD > p.boxX &&
                candY < p.boxY + p.boxH + LABEL_PAD &&
                candY + label.boxH + LABEL_PAD > p.boxY) {
              collides = true; break
            }
          }

          // Check against all room node circles
          if (!collides) {
            for (const room of this.data!.rooms) {
              const rp = this.roomPos.get(room.id)
              if (!rp) continue
              const nr = this.roomRadius(room) + 3
              const nearX = Math.max(candX, Math.min(rp.nx, candX + label.boxW))
              const nearY = Math.max(candY, Math.min(rp.ny, candY + label.boxH))
              const ddx = rp.nx - nearX, ddy = rp.ny - nearY
              if (ddx * ddx + ddy * ddy < nr * nr) { collides = true; break }
            }
          }

          // Check against DHW cylinder
          if (!collides && this.dhwPos) {
            const dhwR = this.lp.hpRadius * 0.55 + 10
            const nearX = Math.max(candX, Math.min(this.dhwPos.x, candX + label.boxW))
            const nearY = Math.max(candY, Math.min(this.dhwPos.y, candY + label.boxH))
            const ddx = this.dhwPos.x - nearX, ddy = this.dhwPos.y - nearY
            if (ddx * ddx + ddy * ddy < dhwR * dhwR) collides = true
          }

          // Check against HP hub
          if (!collides) {
            const hpR = this.lp.hpRadius + 5
            const nearX = Math.max(candX, Math.min(this.lp.cx, candX + label.boxW))
            const nearY = Math.max(candY, Math.min(this.lp.cy, candY + label.boxH))
            const ddx = this.lp.cx - nearX, ddy = this.lp.cy - nearY
            if (ddx * ddx + ddy * ddy < hpR * hpR) collides = true
          }

          if (!collides) {
            bestX = candX
            bestY = candY
            found = true
            break
          }
        }
      }

      label.boxX = bestX
      label.boxY = bestY
      placed.push(label)
    }

    // --- Phase 3: recalculate text alignment from final position ---
    for (const l of labels) {
      const pos = this.roomPos.get(this.data!.rooms[l.idx].id)
      if (!pos) continue
      const labelCx = l.boxX + l.boxW / 2
      if (labelCx > pos.nx + 10) l.textAlign = 'left'
      else if (labelCx < pos.nx - 10) l.textAlign = 'right'
      else l.textAlign = 'center'
    }

    // --- Phase 4: draw (connector lines + pills + text) ---
    for (const l of labels) {
      const pos = this.roomPos.get(this.data!.rooms[l.idx].id)

      // Connector line for displaced labels
      if (pos) {
        const labelCx = l.boxX + l.boxW / 2
        const labelCy = l.boxY + l.boxH / 2
        const dx = labelCx - pos.nx
        const dy = labelCy - pos.ny
        const distFromNode = Math.sqrt(dx * dx + dy * dy)
        if (distFromNode > l.nodeR + GAP + 14) {
          const len = distFromNode || 1
          const sx = pos.nx + (dx / len) * (l.nodeR + 2)
          const sy = pos.ny + (dy / len) * (l.nodeR + 2)
          const ex = Math.max(l.boxX, Math.min(labelCx, l.boxX + l.boxW))
          const ey = Math.max(l.boxY, Math.min(labelCy, l.boxY + l.boxH))
          ctx.save()
          ctx.strokeStyle = this.hexAlpha(this.C.textMuted, 0.35)
          ctx.lineWidth = this.$s(1)
          ctx.setLineDash([this.$s(2), this.$s(2)])
          ctx.beginPath()
          ctx.moveTo(this.$x(sx), this.$y(sy))
          ctx.lineTo(this.$x(ex), this.$y(ey))
          ctx.stroke()
          ctx.restore()
        }
      }

      // Background pill
      ctx.fillStyle = this.hexAlpha(this.C.bgCard, 0.85)
      ctx.beginPath()
      ctx.roundRect(this.$x(l.boxX), this.$y(l.boxY), this.$s(l.boxW), this.$s(l.boxH), this.$s(3))
      ctx.fill()

      const textX = l.textAlign === 'left' ? l.boxX + 4
        : l.textAlign === 'right' ? l.boxX + l.boxW - 4
        : l.boxX + l.boxW / 2

      // Room name
      ctx.fillStyle = this.C.text
      ctx.font = `bold ${this.$s(this.lp.fontSize.labelName)}px sans-serif`
      ctx.textAlign = l.textAlign
      ctx.textBaseline = 'top'
      ctx.fillText(l.nameText, this.$x(textX), this.$y(l.boxY + 2))

      // Subtext: temp / target
      if (!this.lp.compactLabels && l.subtext) {
        ctx.fillStyle = this.C.textMuted
        ctx.font = `${this.$s(this.lp.fontSize.labelSub)}px sans-serif`
        ctx.fillText(l.subtext, this.$x(textX), this.$y(l.boxY + 14))
      }

      // Status — only non-ok states (colour-coded to match node)
      if (l.statusText) {
        ctx.fillStyle = this.roomColour(this.data!.rooms[l.idx])
        ctx.font = `${this.$s(this.lp.fontSize.labelSub)}px sans-serif`
        ctx.fillText(l.statusText, this.$x(textX), this.$y(l.boxY + 25))
      }
    }
  }

  // -------------------------------------------------------------------
  // drawAnnotations
  // -------------------------------------------------------------------

  private drawAnnotations(): void {
    if (!this.data) return
    const { ctx } = this

    // Title (top-left)
    ctx.fillStyle = this.C.text
    ctx.font = `${this.$s(this.lp.fontSize.title)}px sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('How Heat Lives in Your Home', this.$x(30), this.$y(25))

    // Outdoor temp (top-right)
    ctx.fillStyle = this.C.textMuted
    ctx.font = `${this.$s(this.lp.fontSize.annotation)}px sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText(
      `Outside ${this.data.hp.outdoor_temp.toFixed(1)}°C`,
      this.$x(this.lp.dw - 30), this.$y(28),
    )

    // Operating mode (top-right, below OAT) — colour-coded by season
    const SEASON_COLOUR: Record<string, string> = {
      winter: this.C.blue,
      shoulder: this.C.amber,
      summer: this.C.cyan,
      shadow: this.C.cyan,
    }
    ctx.fillStyle = SEASON_COLOUR[this.data.state.season] ?? this.C.textMuted
    ctx.font = `500 ${this.$s(this.lp.fontSize.annotation)}px sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText(this.data.state.label, this.$x(this.lp.dw - 30), this.$y(46))
  }

  // -------------------------------------------------------------------
  // drawLegend — bottom-left visual language key (desktop only)
  // -------------------------------------------------------------------

  private drawLegend(): void {
    if (!this.data || this.portrait) return
    const { ctx } = this

    const items: { colour: string; label: string }[] = [
      { colour: this.C.accent, label: 'Warm flow (arteries)' },
      { colour: this.C.blue, label: 'Cool return (veins)' },
      { colour: this.C.cyan, label: 'QSH neural (nervous system)' },
      { colour: this.C.heatLoss, label: 'Heat loss through walls' },
    ]
    if (this.isHW()) {
      items.push({ colour: this.C.purple, label: 'Hot water cylinder (DHW)' })
    }

    const baseY = this.lp.dh - 24
    const spacing = 15

    for (let i = 0; i < items.length; i++) {
      const y = baseY - (items.length - 1 - i) * spacing
      const dotX = this.$x(30)
      const dotY = this.$y(y)

      // Coloured dot
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.arc(dotX, dotY, this.$s(3), 0, Math.PI * 2)
      ctx.fillStyle = items[i].colour
      ctx.fill()

      // Label text
      ctx.globalAlpha = 0.6
      ctx.fillStyle = this.C.textMuted
      ctx.font = `${this.$s(9)}px sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(items[i].label, dotX + this.$s(8), dotY)
    }
    ctx.globalAlpha = 1
  }

  // -------------------------------------------------------------------
  // drawDefrost — ice crystals around heart
  // -------------------------------------------------------------------

  private drawDefrost(): void {
    const { ctx } = this
    const n = 6
    for (let i = 0; i < n; i++) {
      const angle = this.defrostPhase + (Math.PI * 2 * i) / n
      const dist = 55
      const x = this.$x(this.lp.cx + Math.cos(angle) * dist)
      const y = this.$y(this.lp.cy + Math.sin(angle) * dist)
      const s = this.$s(6)

      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle * 2)
      ctx.strokeStyle = this.C.ice
      ctx.lineWidth = this.$s(1.2)
      // Six-pointed crystal
      for (let a = 0; a < 6; a++) {
        const ra = (Math.PI * 2 * a) / 6
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(Math.cos(ra) * s, Math.sin(ra) * s)
        ctx.stroke()
        // Small branch
        const bx = Math.cos(ra) * s * 0.6
        const by = Math.sin(ra) * s * 0.6
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(bx + Math.cos(ra + 0.5) * s * 0.3, by + Math.sin(ra + 0.5) * s * 0.3)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  // -------------------------------------------------------------------
  // drawFpsOverlay — engineering-mode FPS readout (bottom-right)
  // -------------------------------------------------------------------

  private drawFpsOverlay(): void {
    const { ctx } = this
    const cw = this.canvas.clientWidth || this.lp.dw
    const ch = this.canvas.clientHeight || this.lp.dh

    ctx.save()
    // Palette may lack textMuted (defensive) — fall back to text with 50% alpha.
    const colour = this.C.textMuted ?? this.C.text
    if (!this.C.textMuted) ctx.globalAlpha = 0.5
    ctx.fillStyle = colour
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`fps: ${this.fps}`, cw - 8, ch - 6)
    ctx.restore()
  }

  // -------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------

  private hexAlpha(hex: string, alpha: number): string {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
    return hex + a
  }
}
