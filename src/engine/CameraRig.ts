/**
 * The camera operator. Scenes ask for shots ("be here, looking there, in four seconds") and the
 * rig eases between them on a fixed clock, so moves land on the narration. Between moves it
 * drifts in a slow orbit and breathes a little, like a held camera.
 *
 * The visitor can always take over: drag to orbit, wheel or pinch to move in. When they let go
 * the rig waits a moment and eases back onto the scripted move (unless `free` is on, in the lab).
 */
import * as THREE from 'three'

export interface Shot {
  target?: [number, number, number]
  distance?: number
  /** degrees round the vertical axis; 0 looks along −z from +z */
  azimuth?: number
  /** degrees above the horizon */
  elevation?: number
  fov?: number
  /** degrees per second of idle orbit after the move */
  orbit?: number
  /** lens opening: 0 = everything sharp, 0.02 = shallow */
  aperture?: number
  /** focus this far in front of (+) or behind (−) the target */
  focusOffset?: number
  /** overrides applied when the frame is taller than wide */
  portrait?: Omit<Shot, 'portrait'>
}

interface State {
  target: THREE.Vector3
  distance: number
  azimuth: number
  elevation: number
  fov: number
  aperture: number
  focusOffset: number
}

const DEG = Math.PI / 180
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function makeState(): State {
  return { target: new THREE.Vector3(), distance: 3.2, azimuth: 20, elevation: 14, fov: 38, aperture: 0.012, focusOffset: 0 }
}

function copyState(from: State, to: State) {
  to.target.copy(from.target)
  to.distance = from.distance
  to.azimuth = from.azimuth
  to.elevation = from.elevation
  to.fov = from.fov
  to.aperture = from.aperture
  to.focusOffset = from.focusOffset
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  /** lab mode: the visitor's orbit is kept instead of easing back */
  free = false
  /** a scene is using the pointer for something else */
  locked = false
  /** distance and lens for the dust's depth of field, updated every frame */
  focus = 3
  aperture = 0.012
  /** shift the picture so the subject sits in the uncovered part of the screen (CSS pixels) */
  offsetX = 0
  offsetY = 0
  /** 0..1 handheld drift; set to 0 for reduced motion */
  breath = 1

  private readonly from = makeState()
  private readonly goal = makeState()
  private readonly now = makeState()
  private moveClock = 0
  private moveSeconds = 0
  private orbit = 0
  private follow: ((target: THREE.Vector3) => void) | null = null

  private userAz = 0
  private userEl = 0
  private userZoom = 0
  private idle = 0
  private dragging = false
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private pinch = 0
  private width = 1
  private height = 1
  private offNowX = 0
  private offNowY = 0
  private time = 0
  private readonly dispose_: (() => void)[] = []

  constructor() {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 80)
    this.apply()
  }

  /** Move to a shot over `seconds` (0 = cut). Unspecified fields keep their current goal. */
  shot(shot: Shot, seconds = 0) {
    const s = this.portrait && shot.portrait ? { ...shot, ...shot.portrait } : shot
    copyState(this.now, this.from)
    const g = this.goal
    if (s.target) g.target.set(s.target[0], s.target[1], s.target[2])
    if (s.distance !== undefined) g.distance = s.distance
    if (s.azimuth !== undefined) {
      // go the short way round
      let az = s.azimuth
      while (az - this.now.azimuth > 180) az -= 360
      while (az - this.now.azimuth < -180) az += 360
      g.azimuth = az
    }
    if (s.elevation !== undefined) g.elevation = s.elevation
    if (s.fov !== undefined) g.fov = s.fov
    if (s.aperture !== undefined) g.aperture = s.aperture
    if (s.focusOffset !== undefined) g.focusOffset = s.focusOffset
    if (s.orbit !== undefined) this.orbit = s.orbit
    this.follow = null
    this.moveClock = 0
    this.moveSeconds = seconds
    if (seconds <= 0) {
      copyState(g, this.now)
      copyState(g, this.from)
    }
  }

  /** Keep the target on something that moves. */
  track(fn: ((target: THREE.Vector3) => void) | null) {
    this.follow = fn
  }

  /** forget the visitor's orbit at once (used on scene changes) */
  recentre(seconds = 1.2) {
    this.idle = 99
    this.returnRate = 1 / Math.max(0.2, seconds)
  }
  private returnRate = 0.9

  get portrait() {
    return this.height > this.width * 1.05
  }

  get dragged() {
    return this.dragging
  }

  attach(dom: HTMLElement) {
    const down = (e: PointerEvent) => {
      if (this.locked) return
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this.dragging = true
      this.idle = 0
      if (this.pointers.size === 2) this.pinch = this.pinchDistance()
      dom.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId)
      if (!p || this.locked) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (this.pointers.size >= 2) {
        const d = this.pinchDistance()
        if (this.pinch > 0) this.userZoom = THREE.MathUtils.clamp(this.userZoom + Math.log(this.pinch / d), -1.6, 1.2)
        this.pinch = d
      } else {
        this.userAz -= dx * 0.28
        this.userEl = THREE.MathUtils.clamp(this.userEl + dy * 0.22, -80, 80)
      }
      this.idle = 0
    }
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId)
      if (this.pointers.size === 0) this.dragging = false
      this.pinch = 0
    }
    const wheel = (e: WheelEvent) => {
      if (this.locked) return
      e.preventDefault()
      this.userZoom = THREE.MathUtils.clamp(this.userZoom + e.deltaY * 0.0012, -1.6, 1.2)
      this.idle = 0
    }
    dom.addEventListener('pointerdown', down)
    dom.addEventListener('pointermove', move)
    dom.addEventListener('pointerup', up)
    dom.addEventListener('pointercancel', up)
    dom.addEventListener('wheel', wheel, { passive: false })
    this.dispose_.push(() => {
      dom.removeEventListener('pointerdown', down)
      dom.removeEventListener('pointermove', move)
      dom.removeEventListener('pointerup', up)
      dom.removeEventListener('pointercancel', up)
      dom.removeEventListener('wheel', wheel)
    })
  }

  setSize(width: number, height: number) {
    this.width = width
    this.height = height
    this.camera.aspect = width / Math.max(1, height)
  }

  update(dt: number) {
    this.time += dt
    const g = this.goal
    const n = this.now

    if (this.orbit !== 0 && !this.dragging) {
      const d = this.orbit * dt
      g.azimuth += d
      this.from.azimuth += d
    }

    if (this.moveSeconds > 0 && this.moveClock < this.moveSeconds) {
      this.moveClock += dt
      const u = ease(Math.min(1, this.moveClock / this.moveSeconds))
      const f = this.from
      n.target.lerpVectors(f.target, g.target, u)
      // distance eases in log space so a long pull-back does not rush at the start
      n.distance = Math.exp(Math.log(f.distance) + (Math.log(g.distance) - Math.log(f.distance)) * u)
      n.azimuth = f.azimuth + (g.azimuth - f.azimuth) * u
      n.elevation = f.elevation + (g.elevation - f.elevation) * u
      n.fov = f.fov + (g.fov - f.fov) * u
      n.aperture = f.aperture + (g.aperture - f.aperture) * u
      n.focusOffset = f.focusOffset + (g.focusOffset - f.focusOffset) * u
    } else {
      copyState(g, n)
    }
    if (this.follow) {
      this.follow(g.target)
      n.target.lerp(g.target, 1 - Math.exp(-dt * 7))
    }

    // the visitor's hand eases back to the script once they let go
    if (!this.dragging && !this.free) {
      this.idle += dt
      if (this.idle > 2.2) {
        const k = 1 - Math.exp(-dt * this.returnRate)
        this.userAz -= this.userAz * k
        this.userEl -= this.userEl * k
        this.userZoom -= this.userZoom * k
        if (Math.abs(this.userAz) + Math.abs(this.userEl) + Math.abs(this.userZoom) < 0.01) this.returnRate = 0.9
      }
    }

    const kOff = 1 - Math.exp(-dt * 3)
    this.offNowX += (this.offsetX - this.offNowX) * kOff
    this.offNowY += (this.offsetY - this.offNowY) * kOff
    this.apply()
  }

  dispose() {
    for (const d of this.dispose_) d()
  }

  private pinchDistance() {
    const [a, b] = [...this.pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y) || 1
  }

  private apply() {
    const n = this.now
    const cam = this.camera
    const aspect = this.width / Math.max(1, this.height)
    // shots are composed for a wide frame; on a tall one pull back so the same width fits
    const back = aspect < 1.45 ? Math.min(2.6, 1.45 / aspect) : 1

    const b = this.breath
    const az = (n.azimuth + this.userAz + b * 0.5 * Math.sin(this.time * 0.21)) * DEG
    const el = THREE.MathUtils.clamp(n.elevation + this.userEl + b * 0.35 * Math.sin(this.time * 0.17 + 1.3), -88, 88) * DEG
    const dist = n.distance * back * Math.exp(this.userZoom)

    cam.position.set(n.target.x + dist * Math.cos(el) * Math.sin(az), n.target.y + dist * Math.sin(el), n.target.z + dist * Math.cos(el) * Math.cos(az))
    cam.lookAt(n.target)
    cam.fov = n.fov
    cam.near = Math.max(0.005, dist * 0.01)
    cam.far = Math.max(80, dist * 30)

    if (Math.abs(this.offNowX) > 0.5 || Math.abs(this.offNowY) > 0.5) {
      cam.setViewOffset(this.width, this.height, this.offNowX, this.offNowY, this.width, this.height)
    } else if (cam.view?.enabled) {
      cam.clearViewOffset()
    }
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()

    this.focus = Math.max(0.05, dist - n.focusOffset)
    this.aperture = n.aperture
  }
}
