import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SolvedLayout, LayoutRoom } from './buildingLayout'
import type { BuildingLiveData, BuildingViewMode } from './buildingTypes'
import type { FaceValue } from '../types/config'
import { normaliseFaceRefs } from '../types/config'

const FLOOR_HEIGHT_FALLBACK = 2.6
const EXPLODE_LIFT = 3.5
const PRESET_FRAMES = 30
const BOUNDARY_STRIP_THICKNESS = 0.08

interface PresetAnim {
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  startTarget: THREE.Vector3
  endTarget: THREE.Vector3
  frame: number
  total: number
}

interface RoomVisual {
  mesh: THREE.Mesh
  edges: THREE.LineSegments
  labelSprite: THREE.Sprite
  labelTexture: THREE.CanvasTexture
  boundaryStrips: THREE.Mesh[]
  baseY: number
  floor: number
  ceilingM: number
}

function tempToColor(temp: number | null): THREE.Color {
  if (temp == null || !isFinite(temp)) return new THREE.Color(0x6b7280)
  const cold = new THREE.Color(0x3b82f6)
  const comfort = new THREE.Color(0x22c55e)
  const warm = new THREE.Color(0xf59e0b)
  const hot = new THREE.Color(0xef4444)
  if (temp <= 15) return cold
  if (temp < 19) return cold.clone().lerp(comfort, (temp - 15) / 4)
  if (temp <= 22) return comfort
  if (temp < 25) return comfort.clone().lerp(warm, (temp - 22) / 3)
  if (temp < 28) return warm.clone().lerp(hot, (temp - 25) / 3)
  return hot
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class BuildingEngine {
  private canvas: HTMLCanvasElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer | null = null
  private controls: OrbitControls | null = null
  private raycaster: THREE.Raycaster
  private roomGroup: THREE.Group
  private ambient: THREE.AmbientLight
  private dirLight: THREE.DirectionalLight
  private ground: THREE.Mesh
  private grid: THREE.GridHelper
  private roomVisuals: Map<string, RoomVisual> = new Map()
  private layout: SolvedLayout | null = null
  private viewMode: BuildingViewMode = '3d'
  private dark = true
  private rafId = 0
  private clickCallback: ((roomName: string | null) => void) | null = null
  private domClickHandler: (e: MouseEvent) => void
  private keyDownHandler: (e: KeyboardEvent) => void
  private preset: PresetAnim | null = null
  private destroyed = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0f172a)
    this.scene.fog = new THREE.Fog(0x0f172a, 60, 220)

    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1)
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 300)
    this.camera.position.set(25, 20, 25)
    this.camera.lookAt(0, 0, 0)

    this.raycaster = new THREE.Raycaster()

    this.ambient = new THREE.AmbientLight(0xffffff, 0.45)
    this.scene.add(this.ambient)

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.85)
    this.dirLight.position.set(30, 50, 20)
    this.dirLight.castShadow = true
    this.dirLight.shadow.mapSize.set(1024, 1024)
    this.dirLight.shadow.camera.near = 1
    this.dirLight.shadow.camera.far = 120
    this.scene.add(this.dirLight)

    const groundGeom = new THREE.PlaneGeometry(200, 200)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.95,
      metalness: 0,
    })
    this.ground = new THREE.Mesh(groundGeom, groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    this.grid = new THREE.GridHelper(200, 80, 0x475569, 0x334155)
    this.grid.position.y = 0.01
    this.scene.add(this.grid)

    this.roomGroup = new THREE.Group()
    this.scene.add(this.roomGroup)

    this.initRenderer()

    this.domClickHandler = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect()
      const w = rect.width || this.canvas.clientWidth || 1
      const h = rect.height || this.canvas.clientHeight || 1
      const x = ((e.clientX - rect.left) / w) * 2 - 1
      const y = -((e.clientY - rect.top) / h) * 2 + 1
      this.handleClick({ x, y })
    }
    this.canvas.addEventListener('click', this.domClickHandler)

    this.keyDownHandler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'n') this.animateTo('north')
      else if (key === 's') this.animateTo('south')
      else if (key === 'e') this.animateTo('east')
      else if (key === 'w') this.animateTo('west')
      else if (key === 't') this.animateTo('top')
    }
    window.addEventListener('keydown', this.keyDownHandler)
  }

  private initRenderer(): void {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
      })
      this.renderer.setPixelRatio(window.devicePixelRatio || 1)
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.0
      this.renderer.shadowMap.enabled = true
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
      const cw = this.canvas.clientWidth || 640
      const ch = this.canvas.clientHeight || 480
      this.renderer.setSize(cw, ch, false)

      this.controls = new OrbitControls(this.camera, this.renderer.domElement)
      this.controls.enableDamping = true
      this.controls.dampingFactor = 0.08
      this.controls.minDistance = 2
      this.controls.maxDistance = 150
      this.controls.target.set(0, 2, 0)
      this.controls.update()
    } catch {
      this.renderer = null
      this.controls = null
    }
  }

  setLayout(layout: SolvedLayout, rooms: Record<string, LayoutRoom>): void {
    this.layout = layout
    this.clearRoomVisuals()

    const cx = layout.centroid.x
    const cz = layout.centroid.z

    for (const [name, solved] of Object.entries(layout.rooms)) {
      const roomCfg = rooms[name]
      if (!roomCfg) continue
      const ceilingM = roomCfg.ceiling_m > 0 ? roomCfg.ceiling_m : FLOOR_HEIGHT_FALLBACK
      const baseY = solved.floor * ceilingM

      const geom = new THREE.BoxGeometry(solved.w, ceilingM, solved.d)
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.55,
        roughness: 0.35,
        metalness: 0,
        clearcoat: 0.4,
        clearcoatRoughness: 0.3,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geom, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.position.set(
        solved.x + solved.w / 2 - cx,
        baseY + ceilingM / 2,
        solved.z + solved.d / 2 - cz,
      )
      mesh.userData = { roomName: name }
      this.roomGroup.add(mesh)

      const edgesGeom = new THREE.EdgesGeometry(geom)
      const edgesMat = new THREE.LineBasicMaterial({
        color: 0xcbd5e1,
        transparent: true,
        opacity: 0.6,
      })
      const edges = new THREE.LineSegments(edgesGeom, edgesMat)
      edges.position.copy(mesh.position)
      this.roomGroup.add(edges)

      const boundaryStrips = this.buildBoundaryStrips(roomCfg, solved, ceilingM, cx, cz, baseY)
      for (const strip of boundaryStrips) this.roomGroup.add(strip)

      const { sprite, texture } = this.createLabelSprite(name, null, null)
      sprite.position.set(
        mesh.position.x,
        baseY + ceilingM + 0.6,
        mesh.position.z,
      )
      sprite.scale.set(2.5, 1.25, 1)
      this.roomGroup.add(sprite)

      this.roomVisuals.set(name, {
        mesh,
        edges,
        labelSprite: sprite,
        labelTexture: texture,
        boundaryStrips,
        baseY,
        floor: solved.floor,
        ceilingM,
      })
    }

    if (this.controls) {
      this.controls.target.set(0, 2, 0)
      this.controls.update()
    }

    const span = Math.max(layout.buildingWidth, 10)
    const dist = span * 2
    this.camera.position.set(dist * 0.7, dist * 0.7, dist * 0.7)
    this.camera.lookAt(0, 2, 0)

    this.applyView()
  }

  private buildBoundaryStrips(
    roomCfg: LayoutRoom,
    solved: { x: number; z: number; w: number; d: number },
    ceilingM: number,
    cx: number,
    cz: number,
    baseY: number,
  ): THREE.Mesh[] {
    const strips: THREE.Mesh[] = []
    const env = roomCfg.envelope
    const walls: Array<{ key: 'north_wall' | 'east_wall' | 'south_wall' | 'west_wall'; geom: [number, number]; pos: [number, number, number] }> = [
      { key: 'north_wall', geom: [solved.w, ceilingM], pos: [solved.x + solved.w / 2 - cx, baseY + ceilingM / 2, solved.z - cz] },
      { key: 'south_wall', geom: [solved.w, ceilingM], pos: [solved.x + solved.w / 2 - cx, baseY + ceilingM / 2, solved.z + solved.d - cz] },
      { key: 'east_wall',  geom: [solved.d, ceilingM], pos: [solved.x + solved.w - cx, baseY + ceilingM / 2, solved.z + solved.d / 2 - cz] },
      { key: 'west_wall',  geom: [solved.d, ceilingM], pos: [solved.x - cx, baseY + ceilingM / 2, solved.z + solved.d / 2 - cz] },
    ]

    for (const wall of walls) {
      const face = env[wall.key]
      if (normaliseFaceRefs(face).length > 0) continue
      const color = this.boundaryColor(face)
      const g = new THREE.PlaneGeometry(wall.geom[0], wall.geom[1])
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const strip = new THREE.Mesh(g, m)
      strip.position.set(wall.pos[0], wall.pos[1], wall.pos[2])
      if (wall.key === 'east_wall' || wall.key === 'west_wall') {
        strip.rotation.y = Math.PI / 2
      }
      const offset = BOUNDARY_STRIP_THICKNESS
      if (wall.key === 'north_wall') strip.position.z -= offset
      else if (wall.key === 'south_wall') strip.position.z += offset
      else if (wall.key === 'east_wall') strip.position.x += offset
      else if (wall.key === 'west_wall') strip.position.x -= offset
      strips.push(strip)
    }

    if (env.floor && typeof env.floor === 'string') {
      const g = new THREE.PlaneGeometry(solved.w, solved.d)
      const m = new THREE.MeshBasicMaterial({
        color: this.boundaryColor(env.floor),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const strip = new THREE.Mesh(g, m)
      strip.rotation.x = -Math.PI / 2
      strip.position.set(
        solved.x + solved.w / 2 - cx,
        baseY - BOUNDARY_STRIP_THICKNESS,
        solved.z + solved.d / 2 - cz,
      )
      strips.push(strip)
    }

    if (env.ceiling && typeof env.ceiling === 'string') {
      const g = new THREE.PlaneGeometry(solved.w, solved.d)
      const m = new THREE.MeshBasicMaterial({
        color: this.boundaryColor(env.ceiling),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const strip = new THREE.Mesh(g, m)
      strip.rotation.x = -Math.PI / 2
      strip.position.set(
        solved.x + solved.w / 2 - cx,
        baseY + ceilingM + BOUNDARY_STRIP_THICKNESS,
        solved.z + solved.d / 2 - cz,
      )
      strips.push(strip)
    }

    return strips
  }

  private boundaryColor(face: FaceValue | null | undefined): number {
    if (face === 'external') return 0x3b82f6
    if (face === 'ground') return 0x78350f
    if (face === 'roof') return 0x64748b
    if (face === 'unheated') return 0xa855f7
    return 0x475569
  }

  private buildLabelTexture(
    roomName: string,
    temp: number | null,
    target: number | null,
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, 256, 128)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
      ctx.fillRect(0, 0, 256, 128)
      ctx.fillStyle = '#f1f5f9'
      ctx.font = 'bold 28px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(roomName, 128, 40)
      if (temp != null) {
        ctx.fillStyle = '#cbd5e1'
        ctx.font = '24px sans-serif'
        const tText = target != null
          ? `${temp.toFixed(1)}° / ${target.toFixed(1)}°`
          : `${temp.toFixed(1)}°`
        ctx.fillText(tText, 128, 88)
      }
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }

  private createLabelSprite(
    roomName: string,
    temp: number | null,
    target: number | null,
  ): { sprite: THREE.Sprite; texture: THREE.CanvasTexture } {
    const texture = this.buildLabelTexture(roomName, temp, target)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(material)
    return { sprite, texture }
  }

  setData(data: BuildingLiveData): void {
    for (const [name, visual] of this.roomVisuals) {
      const roomData = data.rooms[name]
      const temp = roomData?.temp ?? null
      const target = roomData?.target ?? null

      const mat = visual.mesh.material as THREE.MeshPhysicalMaterial
      mat.color.copy(tempToColor(temp))

      visual.labelTexture.dispose()
      const texture = this.buildLabelTexture(name, temp, target)
      const oldMat = visual.labelSprite.material
      const newMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      })
      visual.labelSprite.material = newMat
      oldMat.dispose()
      visual.labelTexture = texture
    }
    this.applyView()
  }

  setView(mode: BuildingViewMode): void {
    this.viewMode = mode
    this.applyView()
  }

  private applyView(): void {
    for (const visual of this.roomVisuals.values()) {
      const mat = visual.mesh.material as THREE.MeshPhysicalMaterial
      let y = visual.baseY + visual.ceilingM / 2
      let roomOpacity = 0.55
      let edgeOpacity = 0.6
      let stripOpacity = 0.35
      let wireframe = false

      if (this.viewMode === 'exploded') {
        y += visual.floor * EXPLODE_LIFT
      } else if (this.viewMode === 'thermal') {
        roomOpacity = 1.0
        edgeOpacity = 0
      } else if (this.viewMode === 'envelope') {
        roomOpacity = 0.15
        edgeOpacity = 0.3
        stripOpacity = 0.85
      } else {
        wireframe = false
      }

      mat.opacity = roomOpacity
      mat.wireframe = wireframe
      mat.needsUpdate = true
      visual.mesh.position.y = y
      visual.edges.position.y = y
      const edgeMat = visual.edges.material as THREE.LineBasicMaterial
      edgeMat.opacity = edgeOpacity
      edgeMat.visible = edgeOpacity > 0

      const labelY = visual.floor * EXPLODE_LIFT * (this.viewMode === 'exploded' ? 1 : 0)
        + visual.baseY + visual.ceilingM + 0.6
      visual.labelSprite.position.y = labelY

      for (const strip of visual.boundaryStrips) {
        const sm = strip.material as THREE.MeshBasicMaterial
        sm.opacity = stripOpacity
        if (this.viewMode === 'exploded') {
          strip.position.y += visual.floor * EXPLODE_LIFT -
            (strip.position.y - (strip.userData.origY ?? strip.position.y))
        }
      }
    }
  }

  setDark(dark: boolean): void {
    if (this.dark === dark) return
    this.dark = dark
    if (dark) {
      this.scene.background = new THREE.Color(0x0f172a)
      if (this.scene.fog) (this.scene.fog as THREE.Fog).color.set(0x0f172a)
      ;(this.ground.material as THREE.MeshStandardMaterial).color.set(0x1e293b)
    } else {
      this.scene.background = new THREE.Color(0xf8fafc)
      if (this.scene.fog) (this.scene.fog as THREE.Fog).color.set(0xf8fafc)
      ;(this.ground.material as THREE.MeshStandardMaterial).color.set(0xe2e8f0)
    }
  }

  resize(): void {
    const cw = this.canvas.clientWidth || 640
    const ch = this.canvas.clientHeight || 480
    this.camera.aspect = cw / ch
    this.camera.updateProjectionMatrix()
    if (this.renderer) {
      this.renderer.setSize(cw, ch, false)
    }
  }

  start(): void {
    if (this.destroyed) return
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
    const loop = () => {
      this.frame()
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  private frame(): void {
    if (this.preset) this.stepPreset()
    if (this.controls) this.controls.update()
    if (this.renderer) this.renderer.render(this.scene, this.camera)
  }

  private stepPreset(): void {
    if (!this.preset || !this.controls) {
      this.preset = null
      return
    }
    this.preset.frame += 1
    const t = Math.min(1, this.preset.frame / this.preset.total)
    const e = easeInOutCubic(t)
    this.camera.position.lerpVectors(this.preset.startPos, this.preset.endPos, e)
    this.controls.target.lerpVectors(this.preset.startTarget, this.preset.endTarget, e)
    if (t >= 1) this.preset = null
  }

  private animateTo(view: 'north' | 'south' | 'east' | 'west' | 'top'): void {
    if (!this.layout) return
    const span = Math.max(this.layout.buildingWidth, 10)
    const dist = span * 1.8
    let endPos: THREE.Vector3
    const endTarget = new THREE.Vector3(0, 2, 0)
    const height = span * 0.6
    switch (view) {
      case 'north': endPos = new THREE.Vector3(0, height, -dist); break
      case 'south': endPos = new THREE.Vector3(0, height, dist); break
      case 'east':  endPos = new THREE.Vector3(dist, height, 0); break
      case 'west':  endPos = new THREE.Vector3(-dist, height, 0); break
      case 'top':   endPos = new THREE.Vector3(0.01, dist * 1.2, 0.01); break
    }
    const startTarget = this.controls
      ? this.controls.target.clone()
      : new THREE.Vector3(0, 2, 0)
    this.preset = {
      startPos: this.camera.position.clone(),
      endPos,
      startTarget,
      endTarget,
      frame: 0,
      total: PRESET_FRAMES,
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stop()
    this.canvas.removeEventListener('click', this.domClickHandler)
    window.removeEventListener('keydown', this.keyDownHandler)

    this.clearRoomVisuals()

    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) {
        for (const m of mat) this.disposeMaterial(m)
      } else if (mat) {
        this.disposeMaterial(mat)
      }
    })

    if (this.controls) {
      this.controls.dispose()
      this.controls = null
    }
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }
  }

  private disposeMaterial(mat: THREE.Material): void {
    const anyMat = mat as unknown as { map?: THREE.Texture }
    if (anyMat.map) anyMat.map.dispose()
    mat.dispose()
  }

  private clearRoomVisuals(): void {
    for (const visual of this.roomVisuals.values()) {
      this.roomGroup.remove(visual.mesh)
      this.roomGroup.remove(visual.edges)
      this.roomGroup.remove(visual.labelSprite)
      for (const strip of visual.boundaryStrips) this.roomGroup.remove(strip)

      visual.mesh.geometry.dispose()
      ;(visual.mesh.material as THREE.Material).dispose()
      visual.edges.geometry.dispose()
      ;(visual.edges.material as THREE.Material).dispose()
      visual.labelTexture.dispose()
      ;(visual.labelSprite.material as THREE.Material).dispose()
      for (const strip of visual.boundaryStrips) {
        strip.geometry.dispose()
        ;(strip.material as THREE.Material).dispose()
      }
    }
    this.roomVisuals.clear()
  }

  onRoomSelect(cb: (roomName: string | null) => void): void {
    this.clickCallback = cb
  }

  handleClick(ndc: { x: number; y: number }): void {
    if (!this.clickCallback) return
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera)
    const meshes: THREE.Mesh[] = []
    for (const visual of this.roomVisuals.values()) meshes.push(visual.mesh)
    const intersects = this.raycaster.intersectObjects(meshes, false)
    if (intersects.length > 0) {
      const hit = intersects[0].object
      const name = (hit.userData as { roomName?: string } | undefined)?.roomName
      this.clickCallback(name ?? null)
      return
    }
    this.clickCallback(null)
  }
}
