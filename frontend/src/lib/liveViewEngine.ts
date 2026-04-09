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

interface LabelInfo {
  roomId: string; x: number; y: number; w: number; h: number
  pinnedY: number; text: string; subtext: string
}

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
  }
  showLabels: boolean
  compactLabels: boolean
  labelPasses: number
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
const SPREAD = 10

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
      fontSize: { title: 16, annotation: 12, nodeTemp: 11, labelName: 10, labelSub: 9 },
      showLabels: true, compactLabels: false, labelPasses: 120,
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
      fontSize: { title: 14, annotation: 11, nodeTemp: 11, labelName: 9, labelSub: 8 },
      showLabels: true, compactLabels: true, labelPasses: 80,
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
    this.lastTime = 0
    const loop = (time: number) => {
      this.frame(time)
      this.animFrameId = requestAnimationFrame(loop)
    }
    this.animFrameId = requestAnimationFrame(loop)
  }

  stop(): void { cancelAnimationFrame(this.animFrameId) }

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
      let maxGap = 0
      let midAngle = 0
      for (let i = 0; i < sorted.length; i++) {
        const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 2 * Math.PI
        const gap = next - sorted[i]
        if (gap > maxGap) { maxGap = gap; midAngle = sorted[i] + gap / 2 }
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
      const flow = this.buildPath(this.lp.cx, this.lp.cy, pos.nx, pos.ny, 1)
      const ret = [...flow].reverse()
      const neural = this.buildPath(this.lp.cx, this.lp.cy, pos.nx, pos.ny, -1)
      this.paths.set(room.id, { flow, ret, neural })
    }

    // DHW paths
    if (this.dhwPos) {
      const flow = this.buildPath(this.lp.cx, this.lp.cy, this.dhwPos.x, this.dhwPos.y, 1)
      const returnPath = [...flow].reverse()
      this.dhwPaths = { flow, returnPath }
    }
  }

  private buildPath(x0: number, y0: number, x1: number, y1: number, side: number): Point[] {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    // Perpendicular unit vector
    const px = -dy / len
    const py = dx / len
    const curvature = (Math.random() * 0.6 + 0.7) * side * SPREAD
    const pts: Point[] = []
    for (let i = 0; i <= PATH_SEGMENTS; i++) {
      const t = i / PATH_SEGMENTS
      const envelope = Math.sin(Math.PI * t)
      const bx = x0 + dx * t + px * curvature * envelope
      const by = y0 + dy * t + py * curvature * envelope
      pts.push({ x: bx, y: by })
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

    if (!this.data) {
      this.drawWaiting(dtS)
      return
    }
    this.update(dtS)
    this.draw()
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
    for (const room of this.data.rooms) {
      if (Math.random() < 0.3 * dt * this.particleScale) {
        this.neuralP.push({
          t: 0, speed: 0.2 + Math.random() * 0.1,
          roomId: room.id, alpha: 0.6, radius: 2,
        })
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
    if (Math.random() < 3 * dt * this.particleScale) {
      this.dhwP.push({
        t: 0, speed: 0.2 + Math.random() * 0.1,
        pathType: Math.random() < 0.6 ? 'flow' : 'return', alpha: 0.8,
      })
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
    this.drawDHWCylinder()
    this.drawRoomNodes()
    this.drawHeart()
    this.drawParticles()
    this.drawLabels()
    this.drawAnnotations()
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

    for (const room of this.data.rooms) {
      const pathSet = this.paths.get(room.id)
      if (!pathSet) continue
      const alpha = 0.15 + (room.valve / 100) * 0.4

      // Flow path (warm)
      ctx.beginPath()
      ctx.strokeStyle = this.hexAlpha(this.C.accent, alpha)
      ctx.lineWidth = this.$s(1.5)
      this.strokePath(pathSet.flow)
      ctx.stroke()

      // Return path (cool)
      ctx.beginPath()
      ctx.strokeStyle = this.hexAlpha(this.C.blue, alpha * 0.7)
      ctx.lineWidth = this.$s(1)
      this.strokePath(pathSet.ret)
      ctx.stroke()

      // Neural path (dotted purple)
      ctx.save()
      ctx.setLineDash([this.$s(3), this.$s(6)])
      ctx.beginPath()
      ctx.strokeStyle = this.hexAlpha(this.C.purple, alpha * 0.5)
      ctx.lineWidth = this.$s(0.8)
      this.strokePath(pathSet.neural)
      ctx.stroke()
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

    // Power readout
    ctx.fillStyle = this.C.text
    ctx.font = `bold ${this.$s(11)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${this.data.hp.power_kw.toFixed(1)}kW`, cx, cy)

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
  // drawLabels — collision-resolved room labels
  // -------------------------------------------------------------------

  private drawLabels(): void {
    if (!this.data || !this.lp.showLabels) return
    const { ctx } = this

    // Phase 1: compute initial label positions
    const labels: LabelInfo[] = []
    ctx.font = `${this.$s(this.lp.fontSize.labelName)}px sans-serif`
    const labelH = this.lp.compactLabels ? 16 : 28

    for (const room of this.data.rooms) {
      const pos = this.roomPos.get(room.id)
      if (!pos) continue
      const r = this.roomRadius(room)
      const text = room.name
      const subtext = this.lp.compactLabels ? '' : `${room.temp.toFixed(1)}° / ${room.target.toFixed(1)}°`
      const tw = this.lp.compactLabels
        ? ctx.measureText(text).width
        : Math.max(ctx.measureText(text).width, ctx.measureText(subtext).width)
      const w = tw / this.sc + 8
      const h = labelH
      const x = pos.nx - w / 2
      const isUpperHalf = pos.ny < this.lp.cy
      const y = isUpperHalf ? pos.ny - r - h - 8 : pos.ny + r + 8
      labels.push({ roomId: room.id, x, y, w, h, pinnedY: y, text, subtext })
    }

    // Phase 2: pairwise overlap resolution
    // NOTE: O(rooms^2) per pass — at 13 rooms the 120-pass resolution is
    // negligible; at 20+ rooms it may consume frame budget.
    for (let pass = 0; pass < this.lp.labelPasses; pass++) {
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i]
          const b = labels[j]
          if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
            const push = (a.y + a.h - b.y) / 2 + 1
            a.y -= push
            b.y += push
          }
        }
      }
    }

    // Phase 3: boundary clamping
    for (const l of labels) {
      l.y = Math.max(10, Math.min(this.lp.dh - l.h - 10, l.y))
      l.pinnedY = l.y
    }

    // Phase 4: AABB-vs-circle node avoidance
    for (const l of labels) {
      for (const room of this.data.rooms) {
        const pos = this.roomPos.get(room.id)
        if (!pos) continue
        const r = this.roomRadius(room) + 4
        const closestX = Math.max(l.x, Math.min(pos.nx, l.x + l.w))
        const closestY = Math.max(l.y, Math.min(pos.ny, l.y + l.h))
        const dx = pos.nx - closestX
        const dy = pos.ny - closestY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < r) {
          if (pos.ny < this.lp.cy) {
            l.y = pos.ny - r - l.h - 2
          } else {
            l.y = pos.ny + r + 2
          }
        }
      }
    }

    // Phase 5: draw labels with connector lines
    for (const l of labels) {
      const pos = this.roomPos.get(l.roomId)
      if (!pos) continue

      // Connector line
      const rr = this.roomRadius(this.data.rooms.find(r => r.id === l.roomId)!)
      const labelAbove = l.y + l.h < pos.ny
      ctx.beginPath()
      if (labelAbove) {
        ctx.moveTo(this.$x(pos.nx), this.$y(pos.ny - rr))
        ctx.lineTo(this.$x(l.x + l.w / 2), this.$y(l.y + l.h))
      } else {
        ctx.moveTo(this.$x(pos.nx), this.$y(pos.ny + rr))
        ctx.lineTo(this.$x(l.x + l.w / 2), this.$y(l.y))
      }
      ctx.strokeStyle = this.hexAlpha(this.C.border, 0.5)
      ctx.lineWidth = this.$s(0.8)
      ctx.stroke()

      // Label background
      ctx.fillStyle = this.hexAlpha(this.C.bgCard, 0.85)
      ctx.beginPath()
      ctx.roundRect(this.$x(l.x), this.$y(l.y), this.$s(l.w), this.$s(l.h), this.$s(3))
      ctx.fill()

      // Label text
      ctx.fillStyle = this.C.text
      ctx.font = `bold ${this.$s(this.lp.fontSize.labelName)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(l.text, this.$x(l.x + l.w / 2), this.$y(l.y + 2))

      if (!this.lp.compactLabels && l.subtext) {
        ctx.fillStyle = this.C.textMuted
        ctx.font = `${this.$s(this.lp.fontSize.labelSub)}px sans-serif`
        ctx.fillText(l.subtext, this.$x(l.x + l.w / 2), this.$y(l.y + 15))
      }
    }
  }

  // -------------------------------------------------------------------
  // drawAnnotations
  // -------------------------------------------------------------------

  private drawAnnotations(): void {
    if (!this.data) return
    const { ctx } = this
    const margin = 20

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

    if (this.portrait) {
      // Mobile: stack bottom bar into two left-aligned lines
      ctx.fillStyle = this.C.textMuted
      ctx.font = `${this.$s(this.lp.fontSize.annotation)}px sans-serif`
      ctx.textAlign = 'left'
      ctx.fillText(
        `${this.data.state.label} · ${this.data.source.name}`,
        this.$x(margin), this.$y(this.lp.dh - 42),
      )

      ctx.fillStyle = this.C.green
      ctx.fillText(
        `COP ${this.data.hp.cop.toFixed(1)}`,
        this.$x(margin), this.$y(this.lp.dh - 24),
      )
    } else {
      // Desktop: three-across bottom bar
      const bottomY = this.lp.dh - 30
      ctx.fillStyle = this.C.textMuted
      ctx.font = `${this.$s(this.lp.fontSize.annotation)}px sans-serif`
      ctx.textAlign = 'left'
      ctx.fillText(this.data.state.label, this.$x(30), this.$y(bottomY))

      ctx.textAlign = 'center'
      ctx.fillText(this.data.source.name, this.$x(this.lp.cx), this.$y(bottomY))

      ctx.textAlign = 'right'
      ctx.fillStyle = this.C.green
      ctx.fillText(
        `COP ${this.data.hp.cop.toFixed(1)}`,
        this.$x(this.lp.dw - 30), this.$y(bottomY),
      )
    }
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
  // Utility
  // -------------------------------------------------------------------

  private hexAlpha(hex: string, alpha: number): string {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
    return hex + a
  }
}
