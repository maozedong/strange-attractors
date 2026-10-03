/**
 * The planar double pendulum, in plain doubles: no three.js, so the stage and `verify.ts` run
 * exactly the same integrator.
 *
 * Angles are measured from the downward vertical, counter-clockwise positive; the pivot is at
 * the origin and gravity points along −y. With δ = θ1 − θ2 and D = 2m1 + m2 − m2·cos 2δ
 * (= 2(m1 + m2·sin²δ), never zero), the equations of motion from the Lagrangian are
 *
 *   θ1'' = [ −g(2m1 + m2) sin θ1 − m2 g sin(θ1 − 2θ2) − 2 m2 sin δ (ω2² L2 + ω1² L1 cos δ) ] / (L1 D)
 *   θ2'' = [ 2 sin δ ( ω1² L1 (m1 + m2) + g (m1 + m2) cos θ1 + ω2² L2 m2 cos δ ) ] / (L2 D)
 *
 * and the conserved energy (zero of potential at the pivot) is
 *
 *   E = ½(m1 + m2) L1² ω1² + ½ m2 L2² ω2² + m2 L1 L2 ω1 ω2 cos δ − (m1 + m2) g L1 cos θ1 − m2 g L2 cos θ2
 */

export const G = 9.81
export const M1 = 1
export const M2 = 1
/** arm lengths, render units */
export const L1 = 0.72
export const L2 = 0.72
/** pivot to tip with both arms in line */
export const PENDULUM_LENGTH = L1 + L2

/** fixed integration step, seconds (RK4) */
export const DT = 1 / 720
/** release angle of both arms, radians from hanging straight down (≈ 115°: high energy, chaotic) */
export const THETA0 = 2.0
export const MAX_COPIES = 200

const M12 = M1 + M2

/**
 * θ1'' and θ2'' at the state x = [θ1, ω1, θ2, ω2], written into out[0], out[1]. State in and
 * result out go through typed arrays so no double crosses a call boundary: V8 boxes number
 * arguments of calls it does not inline (it inlines only two of RK4's four call sites).
 */
export function accelerations(x: Float64Array, out: Float64Array): void {
  const t1 = x[0]
  const w1 = x[1]
  const t2 = x[2]
  const w2 = x[3]
  const d = t1 - t2
  const sd = Math.sin(d)
  const cd = Math.cos(d)
  const den = 2 * M1 + M2 - M2 * Math.cos(2 * d)
  out[0] = (-G * (2 * M1 + M2) * Math.sin(t1) - M2 * G * Math.sin(t1 - 2 * t2) - 2 * sd * M2 * (w2 * w2 * L2 + w1 * w1 * L1 * cd)) / (L1 * den)
  out[1] = (2 * sd * (w1 * w1 * L1 * M12 + G * M12 * Math.cos(t1) + w2 * w2 * L2 * M2 * cd)) / (L2 * den)
}

export function energy(t1: number, w1: number, t2: number, w2: number): number {
  const kinetic = 0.5 * M12 * L1 * L1 * w1 * w1 + 0.5 * M2 * L2 * L2 * w2 * w2 + M2 * L1 * L2 * w1 * w2 * Math.cos(t1 - t2)
  const potential = -M12 * G * L1 * Math.cos(t1) - M2 * G * L2 * Math.cos(t2)
  return kinetic + potential
}

/**
 * How far the tip can reach at the release energy: horizontally the full arm length, down to
 * −L1 − L2, and up to the highest point the energy allows (outer arm straight up, inner arm as
 * high as E permits). For framing.
 */
export const PENDULUM_BOUNDS = (() => {
  const e = energy(THETA0, 0, THETA0, 0)
  // maximise −(L1 cos θ1 + L2 cos θ2) subject to −g(M12 L1 cos θ1 + M2 L2 cos θ2) ≤ E
  let top = -Infinity
  for (let i = 0; i <= 4000; i++) {
    const c2 = -1 + (2 * i) / 4000
    // smallest cos θ1 the energy allows for this cos θ2
    const c1 = Math.max(-1, (-e / G - M2 * L2 * c2) / (M12 * L1))
    if (c1 > 1) continue
    top = Math.max(top, -(L1 * c1 + L2 * c2))
  }
  return { left: -PENDULUM_LENGTH, right: PENDULUM_LENGTH, bottom: -PENDULUM_LENGTH, top }
})()

/** RK4 scratch: stage state in, accelerations out */
const x = new Float64Array(4)
const k = new Float64Array(2)

/**
 * N double pendulums integrated together with a fixed-step RK4. All arrays are allocated once
 * for MAX_COPIES; `reset` and `step` allocate nothing.
 */
export class PendulumEnsemble {
  readonly t1 = new Float64Array(MAX_COPIES)
  readonly w1 = new Float64Array(MAX_COPIES)
  readonly t2 = new Float64Array(MAX_COPIES)
  readonly w2 = new Float64Array(MAX_COPIES)
  count = 0
  /** integration steps since the last reset; time = steps × DT */
  steps = 0

  constructor(
    count = 100,
    nudge = 1e-6,
    readonly dt = DT,
  ) {
    this.reset(count, nudge)
  }

  get time(): number {
    return this.steps * this.dt
  }

  /** Everyone back at the release angle; copy k of N gets θ1 += nudge·(2k/(N−1) − 1). */
  reset(count: number, nudge: number): void {
    const n = Math.max(1, Math.min(MAX_COPIES, Math.round(count) || 1))
    this.count = n
    this.steps = 0
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? (2 * i) / (n - 1) - 1 : 0
      this.t1[i] = THETA0 + nudge * u
      this.t2[i] = THETA0
      this.w1[i] = 0
      this.w2[i] = 0
    }
  }

  /** One RK4 step of every copy. */
  step(): void {
    const h = this.dt
    const h2 = h / 2
    const { t1, w1, t2, w2 } = this
    for (let i = 0; i < this.count; i++) {
      const a1 = t1[i]
      const b1 = w1[i]
      const a2 = t2[i]
      const b2 = w2[i]

      x[0] = a1
      x[1] = b1
      x[2] = a2
      x[3] = b2
      accelerations(x, k)
      const k1t1 = b1
      const k1w1 = k[0]
      const k1t2 = b2
      const k1w2 = k[1]

      x[0] = a1 + h2 * k1t1
      x[1] = b1 + h2 * k1w1
      x[2] = a2 + h2 * k1t2
      x[3] = b2 + h2 * k1w2
      accelerations(x, k)
      const k2t1 = x[1]
      const k2w1 = k[0]
      const k2t2 = x[3]
      const k2w2 = k[1]

      x[0] = a1 + h2 * k2t1
      x[1] = b1 + h2 * k2w1
      x[2] = a2 + h2 * k2t2
      x[3] = b2 + h2 * k2w2
      accelerations(x, k)
      const k3t1 = x[1]
      const k3w1 = k[0]
      const k3t2 = x[3]
      const k3w2 = k[1]

      x[0] = a1 + h * k3t1
      x[1] = b1 + h * k3w1
      x[2] = a2 + h * k3t2
      x[3] = b2 + h * k3w2
      accelerations(x, k)
      const k4t1 = x[1]
      const k4w1 = k[0]
      const k4t2 = x[3]
      const k4w2 = k[1]

      const s = h / 6
      t1[i] = a1 + s * (k1t1 + 2 * k2t1 + 2 * k3t1 + k4t1)
      w1[i] = b1 + s * (k1w1 + 2 * k2w1 + 2 * k3w1 + k4w1)
      t2[i] = a2 + s * (k1t2 + 2 * k2t2 + 2 * k3t2 + k4t2)
      w2[i] = b2 + s * (k1w2 + 2 * k2w2 + 2 * k3w2 + k4w2)
    }
    this.steps++
  }

  /**
   * Standard deviation of the tip positions: the RMS distance of the tips from their mean,
   * render units (two passes, so a spread of 1e-9 is still resolved).
   */
  spread(): number {
    const n = this.count
    if (n < 2) return 0
    const { t1, t2 } = this
    let mx = 0
    let my = 0
    for (let i = 0; i < n; i++) {
      mx += L1 * Math.sin(t1[i]) + L2 * Math.sin(t2[i])
      my -= L1 * Math.cos(t1[i]) + L2 * Math.cos(t2[i])
    }
    mx /= n
    my /= n
    let ss = 0
    for (let i = 0; i < n; i++) {
      const dx = L1 * Math.sin(t1[i]) + L2 * Math.sin(t2[i]) - mx
      const dy = -(L1 * Math.cos(t1[i]) + L2 * Math.cos(t2[i])) - my
      ss += dx * dx + dy * dy
    }
    return Math.sqrt(ss / n)
  }
}
