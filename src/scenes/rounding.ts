/**
 * Prologue: a rounding error.
 *
 * A weather record draws itself across the dark like a pen trace. The camera travels back to
 * the middle of it; the number the machine held appears, loses its last three digits at the
 * visitor's click, and a second trace starts from that point. The two agree, then part. Then
 * the flat record lifts off the page: plotted in space instead of against time, the same two
 * runs wrap themselves into the butterfly.
 */
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { InterleavedBufferAttribute } from 'three'
import { rampColor } from '../engine/palettes'
import { at, easeInOut, easeOut, type SceneFactory } from '../film/types'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../scene/trajectories/lineMaterial'
import { rk4Step } from '../sim/cpu'
import { sound } from '../sound/audio'
import { getSystem } from '../systems'
import { FLOOR, LORENZ_SEED, haze, lorenzFlow, resetLorenz, silk, veil } from './kit/shared'

/** system time between stored samples */
const SAMPLE = 0.005
/** where the second run starts, and where the record ends (system time) */
const T0 = 15
const TOTAL = 46
/** chart scale: world units per unit of time, and per unit of x */
const KX = 0.105
const KY = 0.027

interface Run {
  /** xyz per sample, system units */
  pts: Float64Array
  /** first sample's time */
  t0: number
  n: number
}

function integrate(from: [number, number, number], t0: number, t1: number): Run {
  const sys = getSystem('lorenz')
  const P = sys.params.map((p) => p.default)
  const n = Math.round((t1 - t0) / SAMPLE) + 1
  const pts = new Float64Array(n * 3)
  const p = new Float64Array(from)
  const per = Math.round(SAMPLE / sys.dt)
  for (let i = 0; i < n; i++) {
    pts.set(p, i * 3)
    for (let k = 0; k < per; k++) rk4Step(sys, p, P, sys.dt)
  }
  return { pts, t0, n }
}

/** One run as a glowing line that can lie flat as a chart or wrap into the attractor. */
class Trace {
  readonly line: Line2
  private readonly start: InterleavedBufferAttribute
  private readonly run: Run
  private readonly material
  private lastFold = -1
  /** samples drawn so far (fractional) */
  drawn = 0

  constructor(run: Run, color: THREE.Color, width: number) {
    this.run = run
    this.material = createTrajectoryLineMaterial(width)
    const g = new LineGeometry()
    g.setPositions(new Float32Array(run.n * 3))
    const cols = new Float32Array(run.n * 3)
    for (let i = 0; i < run.n; i++) cols.set([color.r, color.g, color.b], i * 3)
    g.setColors(cols)
    this.start = g.getAttribute('instanceStart') as InterleavedBufferAttribute
    this.line = new Line2(g, this.material)
    this.line.frustumCulled = false
    this.line.renderOrder = 20
    g.instanceCount = 0
  }

  /** world position of sample i for a given fold (0 = flat chart, 1 = in space) */
  place(i: number, fold: number, out: THREE.Vector3): THREE.Vector3 {
    const { pts, t0 } = this.run
    const k = Math.min(this.run.n - 1, Math.max(0, i)) * 3
    const x = pts[k]
    const y = pts[k + 1]
    const z = pts[k + 2]
    const t = t0 + (k / 3) * SAMPLE
    // chart: time runs left to right, the record's value up and down
    const cx = (t - T0) * KX
    const cy = x * KY
    // space: the system's own frame (ρ = 28), z up
    const s = 1 / 27.1
    const wx = x * s
    const wy = (z - 24.8) * s
    const wz = -y * s
    return out.set(cx + (wx - cx) * fold, cy + (wy - cy) * fold, wz * fold)
  }

  update(fold: number, opacity: number, dpr: number) {
    if (fold !== this.lastFold) {
      this.lastFold = fold
      const a = this.start.data.array as Float32Array
      const v = new THREE.Vector3()
      this.place(0, fold, v)
      let px = v.x
      let py = v.y
      let pz = v.z
      for (let i = 1, o = 0; i < this.run.n; i++, o += 6) {
        this.place(i, fold, v)
        a[o] = px
        a[o + 1] = py
        a[o + 2] = pz
        a[o + 3] = v.x
        a[o + 4] = v.y
        a[o + 5] = v.z
        px = v.x
        py = v.y
        pz = v.z
      }
      this.start.data.needsUpdate = true
    }
    this.line.geometry.instanceCount = Math.max(0, Math.min(this.run.n - 1, Math.floor(this.drawn)))
    this.material.opacity = opacity
    this.material.uniforms.opacity.value = opacity
    this.line.visible = opacity > 0.003 && this.drawn >= 1
    setLinePixelRatio(this.material, dpr)
  }

  dispose() {
    this.line.geometry.dispose()
    this.material.dispose()
  }
}

const rounding: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const cloud = veil(engine)
  const flow = lorenzFlow(engine)

  // the record, and the run restarted from the rounded number
  const a = integrate(LORENZ_SEED, 0, TOTAL)
  const i0 = Math.round(T0 / SAMPLE)
  const restart: [number, number, number] = [a.pts[i0 * 3] * (1 - 0.000127 / 0.506127), a.pts[i0 * 3 + 1], a.pts[i0 * 3 + 2]]
  const b = integrate(restart, T0, TOTAL)
  // the sample at which the two visibly part company
  let split = b.n - 1
  for (let i = 0; i < b.n; i++) {
    if (Math.abs(b.pts[i * 3] - a.pts[(i0 + i) * 3]) > 2.2) {
      split = i
      break
    }
  }

  // the record in a cool pale ink, the rerun in a warm one
  const white = new THREE.Color(1, 1, 1)
  const cold = rampColor(palette, 0.3).lerp(white, 0.45).multiplyScalar(2.6)
  const hot = rampColor(palette, 0.78).lerp(white, 0.1).multiplyScalar(2.6)
  const old = new Trace(a, cold, 2)
  const fresh = new Trace(b, hot, 2)
  root.add(old.line, fresh.line)

  let fold = 0
  let opacity = 0
  /** samples per second each trace is drawing at */
  let oldRate = 0
  let freshRate = 0
  let rounded = false
  let chasing: 'old' | 'fresh' | null = 'old'
  const head = new THREE.Vector3()
  const anchor = new THREE.Vector3()
  old.place(i0, 0, anchor)

  let number: ReturnType<typeof ctx.label> | null = null
  let delta: ReturnType<typeof ctx.label> | null = null

  // keep the camera a little ahead of whichever pen is drawing
  const chase = (target: THREE.Vector3) => {
    if (chasing === 'old') old.place(Math.floor(old.drawn), 0, head)
    else if (chasing === 'fresh') fresh.place(Math.floor(fresh.drawn), 0, head)
    else return
    target.set(head.x + 0.35, 0, 0)
  }

  const round = () => {
    if (rounded) return
    rounded = true
    number?.setHtml('0.506<i class="lost">127</i>')
    number?.el.classList.add('is-rounded')
    sound.sfx('tick', 0.5)
    fresh.drawn = 1
    chasing = 'fresh'
    rig.track(chase)
  }

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0
      void dust.morphTo(cloud, haze(palette), { seconds: 3, swirl: 1.4 })
      rig.shot({ target: [-T0 * KX + 0.35, 0, 0], distance: 2.3, azimuth: 0, elevation: 0, orbit: 0, aperture: 0.002, fov: 38 }, 2.8)
      // the record starts drawing once the title has let go, and runs across the first four lines
      ctx.after(2.4, () => {
        ctx.tween(1.6, (u) => (opacity = u), { ease: easeOut })
        oldRate = (a.n - 1) / Math.max(8, ctx.until(3) + 1.5)
        old.drawn = 1
        rig.track(chase)
      })
    },

    cues: [
      // "wants to see one stretch of it again": travel back along the record
      at(2, () => {
        chasing = null
        rig.shot({ target: [anchor.x + 0.25, 0, 0], distance: 1.9 }, Math.max(3, ctx.until(4)))
      }),
      at(4, () => {
        number = ctx.label('0.506127', { kind: 'big', at: anchor, align: 'above', dy: -86, leader: true })
      }),
      at(5, 'only had room', () => {
        number?.setHtml('0.506<i class="doomed">127</i>')
      }),
      at(6, () => {
        delta = ctx.label('a difference of 0.000127', { kind: 'note', at: anchor, align: 'below', dy: 96 })
        // pace the new run so the two part company as the narrator says so
        freshRate = split / Math.max(4, ctx.until(8) + 0.6)
      }),
      at(8, () => {
        number?.remove()
        delta?.remove()
        freshRate = (b.n - 1 - fresh.drawn) / Math.max(5, ctx.until(10) - 0.5)
        chasing = null
        const mid = (fresh.drawn * SAMPLE) * KX + 0.9
        rig.shot({ target: [mid, 0, 0], distance: 3.3 }, 6)
      }),
      // "Drawn in space, they look like this."
      at(10, 'Drawn in space', () => {
        freshRate = b.n
        sound.sfx('fold', 0.7)
        ctx.tween(6.5, (u) => (fold = u), { ease: easeInOut })
        // wound onto the butterfly the lines overlap many times over: turn them down as they fold
        ctx.tween(6.5, (u) => (opacity = 1 - 0.45 * u))
        rig.shot({ target: [0, -0.24, 0], distance: 3.85, azimuth: 28, elevation: 11, orbit: 2.5, aperture: 0.004 }, 6.5)
        resetLorenz(flow)
        dust.floorY = FLOOR
        engine.backdrop.floor = 1
        void dust.morphTo(flow, { ...silk(palette, flow.speedNorm), gain: 0.2 }, { seconds: 6, swirl: 1.2 })
      }),
      at(11, () => {
        ctx.tween(4, (u) => (dust.look.gain = 0.2 + 0.3 * u))
        ctx.tween(4, (u) => (opacity = 0.55 - 0.2 * u))
      }),
    ],

    gates: { round },

    update(dt) {
      if (old.drawn >= 1) old.drawn = Math.min(a.n - 1, old.drawn + oldRate * dt)
      if (fresh.drawn >= 1) fresh.drawn = Math.min(b.n - 1, fresh.drawn + freshRate * dt)
      const dpr = engine.renderer.getPixelRatio()
      old.update(fold, opacity, dpr)
      fresh.update(fold, opacity, dpr)
    },

    exit() {
      ctx.tween(1.6, (u) => (opacity = (1 - u) * opacity))
    },

    dispose() {
      old.dispose()
      fresh.dispose()
    },

    notes: [
      'In the winter of 1961 Edward Lorenz was running a twelve-variable model of the atmosphere on a Royal McBee LGP-30. To repeat part of a run he typed in the state from a printout, which showed three decimal places; the machine worked with six. The printout said 0.506. The machine had been holding 0.506127.',
      'The record drawn here is from the three-equation system he published two years later, in "Deterministic Nonperiodic Flow". The restarted run differs from the original by exactly that rounding, and nothing else.',
    ],
  }
}

export default rounding
