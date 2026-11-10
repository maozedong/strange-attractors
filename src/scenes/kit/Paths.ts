/**
 * A few trajectories of a system, integrated on the CPU in double precision (so a gap of one
 * part in a billion means something) and drawn as glowing lines with a bright head.
 */
import * as THREE from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { TrajectoryLine } from '../../scene/trajectories/TrajectoryLine'
import { HeadPoints } from '../../scene/trajectories/HeadPoints'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import { rk4Step } from '../../sim/cpu'
import type { AttractorSystem, Vec3 } from '../../types'

export class Paths {
  /** add to the scene; the group carries the z-up to y-up turn */
  readonly object = new THREE.Group()
  /** simulated time since `start`, system units */
  time = 0
  /** time units per second */
  rate = 1
  /** overall brightness, 0..1 */
  opacity = 1
  /** distance between path 0 and path 1, system units (NaN with a single path) */
  gap = NaN

  private readonly lines: TrajectoryLine[] = []
  private readonly materials: LineMaterial[] = []
  private readonly heads: HeadPoints
  private readonly colors: THREE.Color[]
  private readonly drawn = new THREE.Color()
  private sys: AttractorSystem
  private P: number[]
  private count = 0
  private owed = 0
  /** keep every k-th step in the drawn history */
  private stride = 2
  private sinceKept = 0

  constructor(sys: AttractorSystem, params: number[], colors: THREE.Color[], width = 1.6) {
    this.sys = sys
    this.P = params
    this.colors = colors
    this.object.rotation.x = -Math.PI / 2
    for (let i = 0; i < colors.length; i++) {
      const m = createTrajectoryLineMaterial(width)
      const line = new TrajectoryLine(m)
      line.line.renderOrder = 20
      this.materials.push(m)
      this.lines.push(line)
      this.object.add(line.line)
    }
    this.heads = new HeadPoints(colors.length)
    this.heads.points.renderOrder = 21
    this.object.add(this.heads.points)
  }

  /** begin `origins.length` paths; `history` points are kept and drawn per path */
  start(origins: Vec3[], history = 3000, fade = true) {
    this.count = Math.min(origins.length, this.lines.length)
    this.time = 0
    this.owed = 0
    this.sinceKept = 0
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i]
      if (i < this.count) {
        l.allocate(history, fade)
        l.restart(origins[i][0], origins[i][1], origins[i][2])
      } else {
        l.hide()
      }
    }
    this.heads.setCount(this.count)
    this.measure()
  }

  /** current position of a path, system coordinates */
  position(i: number): Float64Array {
    return this.lines[i].p
  }

  /** world position of a path's head */
  headWorld(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.sys.frame(this.P)
    const p = this.lines[i].p
    return out.set((p[0] - f.center[0]) * f.scale, (p[2] - f.center[2]) * f.scale, -(p[1] - f.center[1]) * f.scale)
  }

  update(dt: number, dpr: number) {
    const sys = this.sys
    this.owed += (dt * this.rate) / sys.dt
    let steps = Math.min(240, Math.floor(this.owed))
    this.owed -= steps
    while (steps-- > 0) {
      for (let i = 0; i < this.count; i++) rk4Step(sys, this.lines[i].p, this.P, sys.dt)
      this.time += sys.dt
      if (++this.sinceKept >= this.stride) {
        this.sinceKept = 0
        for (let i = 0; i < this.count; i++) {
          const p = this.lines[i].p
          this.lines[i].push(p[0], p[1], p[2])
        }
      }
    }
    this.measure()

    const f = sys.frame(this.P)
    for (let i = 0; i < this.count; i++) {
      const l = this.lines[i]
      this.drawn.copy(this.colors[i]).multiplyScalar(this.opacity)
      l.markColorsDirty()
      l.write(f.center[0], f.center[1], f.center[2], f.scale, this.drawn)
      const p = l.p
      this.heads.setPosition(i, (p[0] - f.center[0]) * f.scale, (p[1] - f.center[1]) * f.scale, (p[2] - f.center[2]) * f.scale)
      this.heads.setColor(i, this.drawn)
      setLinePixelRatio(this.materials[i], dpr)
    }
    this.heads.setPixelRatio(dpr)
    this.object.visible = this.opacity > 0.002
  }

  dispose() {
    for (const l of this.lines) l.dispose()
    for (const m of this.materials) m.dispose()
    this.heads.dispose()
  }

  private measure() {
    if (this.count < 2) {
      this.gap = NaN
      return
    }
    const a = this.lines[0].p
    const b = this.lines[1].p
    this.gap = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  }
}

/**
 * How long two copies started `gap` apart take to disagree by `threshold` (system units), in
 * system time. Scenes use it to pace a run so the split lands on the narrator's words.
 */
export function timeToSplit(sys: AttractorSystem, params: number[], origin: Vec3, gap: number, threshold: number, limit = 80): number {
  const a = new Float64Array(origin)
  const b = new Float64Array([origin[0] + gap, origin[1], origin[2]])
  const steps = Math.ceil(limit / sys.dt)
  for (let i = 0; i < steps; i++) {
    rk4Step(sys, a, params, sys.dt)
    rk4Step(sys, b, params, sys.dt)
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > threshold) return (i + 1) * sys.dt
  }
  return limit
}
