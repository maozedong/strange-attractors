import { Color, DoubleSide, Group } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { rk4Step } from '../../sim/cpu'
import { resetSeparation, SEP_CAP, tele } from '../../sim/telemetry'
import type { AttractorSystem, TrajCommand } from '../../types'
import { HeadPoints } from './HeadPoints'
import { createTrajectoryLineMaterial, setLinePixelRatio } from './lineMaterial'
import { setTrajectoryHead, setTrajectoryHeadCount } from './heads'
import { TrajectoryLine } from './TrajectoryLine'

const MAX_TRAJECTORIES = 2
/** world y of the reflective floor (the parent group maps local z to world y) */
const FLOOR_Y = -1.25
/** brightness of the reflection relative to the line */
const MIRROR_DIM = 0.3
const INV_SQRT3 = 1 / Math.sqrt(3)
/** separation chart cadence: one sample per this much simulated time */
const SAMPLE_DT = 0.05
const SAMPLE_EPS = 1e-9

/**
 * CPU trajectories integrated in lockstep with the GPU swarm (same steps, same dt) and the
 * three.js objects that draw them. Framework-free; the <Trajectories /> component drives it.
 */
export class TrajectoryEngine {
  /** add to a group rotated by -π/2 about x */
  readonly root = new Group()

  private readonly material: LineMaterial
  private readonly mirrorMaterial: LineMaterial
  private readonly mirrorRoot = new Group()
  private readonly mirrors: Line2[] = []
  private readonly tracks: TrajectoryLine[] = []
  private readonly heads = new HeadPoints(MAX_TRAJECTORIES)
  private readonly colors: Color[] = [new Color(), new Color()]
  private count = 0
  private lastSampleT = 0

  /** system + frame of the previous update, to remap the history when the system changes */
  private prevSys: AttractorSystem | null = null
  private prevCx = 0
  private prevCy = 0
  private prevCz = 0
  private prevScale = 1

  constructor(linewidth = 1.6) {
    this.material = createTrajectoryLineMaterial(linewidth)
    this.mirrorMaterial = createTrajectoryLineMaterial(linewidth)
    this.mirrorMaterial.color.setScalar(MIRROR_DIM)
    this.mirrorMaterial.side = DoubleSide
    // reflection in the floor: local z is world up, so mirror z about the floor height
    this.mirrorRoot.scale.set(1, 1, -1)
    this.mirrorRoot.position.z = 2 * FLOOR_Y
    for (let k = 0; k < MAX_TRAJECTORIES; k++) {
      const t = new TrajectoryLine(this.material)
      this.tracks.push(t)
      this.root.add(t.line)
      const m = new Line2(t.line.geometry, this.mirrorMaterial)
      m.frustumCulled = false
      this.mirrors.push(m)
      this.mirrorRoot.add(m)
    }
    this.root.add(this.mirrorRoot)
    this.root.add(this.heads.points)
  }

  setColors(a: string, b: string): void {
    this.colors[0].set(a)
    this.colors[1].set(b)
    for (let k = 0; k < MAX_TRAJECTORIES; k++) {
      this.tracks[k].markColorsDirty()
      this.heads.setColor(k, this.colors[k])
    }
  }

  setLinewidth(px: number): void {
    this.material.linewidth = px
    this.mirrorMaterial.linewidth = px
  }

  /**
   * CSS pixels. Line2.onBeforeRender overwrites this every draw with renderer.getViewport(),
   * which is also in CSS pixels, so `linewidth` stays in CSS pixels at any device pixel ratio.
   */
  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height)
    this.mirrorMaterial.resolution.set(width, height)
  }

  setPixelRatio(dpr: number): void {
    this.heads.setPixelRatio(dpr)
    setLinePixelRatio(this.material, dpr)
    setLinePixelRatio(this.mirrorMaterial, dpr)
  }

  /**
   * Once per frame, after SimClock. `render` = whether the lines are visible this frame; when
   * false the trajectories keep integrating but GPU buffers are not rewritten.
   */
  update(cmds: TrajCommand[], sys: AttractorSystem, P: number[], render: boolean): void {
    let started = false
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i]
      if (c.type === 'start') {
        this.start(c, sys, P)
        started = true
      } else {
        this.clear()
        started = false
      }
    }

    const n = this.count
    if (n === 0) return

    const frame = sys.frame(P)
    const cx = frame.center[0]
    const cy = frame.center[1]
    const cz = frame.center[2]
    const s = frame.scale

    if (this.prevSys !== null && this.prevSys !== sys) {
      // Same idea as the swarm's switchSystem: keep every point where it is on screen.
      const k = this.prevScale / s
      for (let j = 0; j < n; j++) this.tracks[j].remap(this.prevCx, this.prevCy, this.prevCz, k, cx, cy, cz)
    }
    this.prevSys = sys
    this.prevCx = cx
    this.prevCy = cy
    this.prevCz = cz
    this.prevScale = s

    // On the start frame SimClock has already counted this frame's steps, then start() reset
    // simTime to 0. Not stepping keeps the trajectories exactly at simTime.
    const steps = started ? 0 : tele.stepsThisFrame
    if (steps > 0) this.integrate(sys, P, steps, tele.dt, cx, cy, cz)

    if (n === 2) tele.twinSep = this.separation()

    for (let k = 0; k < n; k++) {
      const p = this.tracks[k].p
      const rx = (p[0] - cx) * s
      const ry = (p[1] - cy) * s
      const rz = (p[2] - cz) * s
      this.heads.setPosition(k, rx, ry, rz)
      setTrajectoryHead(k, rx, rz, -ry)
    }

    if (render) {
      for (let k = 0; k < n; k++) this.tracks[k].write(cx, cy, cz, s, this.colors[k])
    }
    // the track may have swapped its geometry on (re)allocation; the reflection follows it
    for (let k = 0; k < MAX_TRAJECTORIES; k++) {
      const m = this.mirrors[k]
      const g = this.tracks[k].line.geometry
      if (m.geometry !== g) m.geometry = g
      m.visible = k < n
    }
  }

  dispose(): void {
    setTrajectoryHeadCount(0)
    for (const t of this.tracks) t.dispose()
    this.material.dispose()
    this.mirrorMaterial.dispose()
    this.heads.dispose()
  }

  private start(cmd: Extract<TrajCommand, { type: 'start' }>, sys: AttractorSystem, P: number[]): void {
    const count = cmd.count === 2 ? 2 : 1
    const history = Math.max(2, Math.floor(cmd.history) || 0)
    let [ox, oy, oz] = cmd.origin
    if (!Number.isFinite(ox + oy + oz)) [ox, oy, oz] = sys.seed(P)

    tele.simTime = 0
    resetSeparation()

    for (let k = 0; k < MAX_TRAJECTORIES; k++) {
      if (k < count) this.tracks[k].allocate(history, cmd.fade)
      else this.tracks[k].hide()
    }
    this.tracks[0].restart(ox, oy, oz)
    if (count === 2) {
      const e = (cmd.nudge || 0) * INV_SQRT3
      this.tracks[1].restart(ox + e, oy + e, oz + e)
    }

    this.count = count
    this.prevSys = null // the origin is already in the current system's units
    this.heads.setCount(count)
    setTrajectoryHeadCount(count)

    if (count === 2) {
      const d = this.separation()
      tele.twinSep = d
      this.sample(0, d)
    }
  }

  private clear(): void {
    for (const t of this.tracks) t.hide()
    this.count = 0
    this.prevSys = null
    this.heads.setCount(0)
    setTrajectoryHeadCount(0)
    tele.twinSep = NaN
  }

  private integrate(
    sys: AttractorSystem,
    P: number[],
    steps: number,
    dt: number,
    cx: number,
    cy: number,
    cz: number,
  ): void {
    const n = this.count
    const bound = sys.bound(P)
    const b2 = bound * bound
    const twins = n === 2
    // SimClock already advanced simTime by this frame's steps; t0 is where this frame began
    const t0 = tele.simTime - steps * dt

    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < n; k++) {
        const tr = this.tracks[k]
        const p = tr.p
        rk4Step(sys, p, P, dt)
        const dx = p[0] - cx
        const dy = p[1] - cy
        const dz = p[2] - cz
        // written so NaN/Infinity also fail the test
        if (dx * dx + dy * dy + dz * dz <= b2) {
          tr.push(p[0], p[1], p[2])
        } else {
          const sd = sys.seed(P)
          tr.restart(sd[0], sd[1], sd[2])
        }
      }
      if (twins) {
        // sample per step, not per frame, so the cadence holds at any frame rate or speed
        const t = t0 + (i + 1) * dt
        if (t - this.lastSampleT >= SAMPLE_DT - SAMPLE_EPS) this.sample(t, this.separation())
      }
    }
  }

  private sample(t: number, d: number): void {
    const i = tele.sepCount
    if (i < SEP_CAP) {
      tele.sepT[i] = t
      tele.sepD[i] = d
      tele.sepCount = i + 1
    }
    this.lastSampleT = t
  }

  private separation(): number {
    const a = this.tracks[0].p
    const b = this.tracks[1].p
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
}
