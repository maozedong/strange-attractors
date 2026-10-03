/**
 * Hyperion's tumble: a rigid triaxial body on a fixed Keplerian orbit around Saturn, turned by
 * Saturn's gravity gradient (Wisdom, Peale & Mignard 1984). Pure numbers, no three.js, so
 * verify.ts runs exactly the steps the stage runs.
 *
 * Units: mean motion n = 1, so one orbit takes 2π time units. Lengths only enter as a / r.
 * Frames:
 *  - inertial: the orbit lies in the x-y plane, periapsis on +x, motion counter-clockwise about +z
 *  - body: principal axes; x is the long axis (smallest moment A), y the middle one (B), z the
 *    short one (largest moment C)
 * The attitude q = (w, x, y, z) maps body vectors to inertial ones (v_in = q v_b q*). The angular
 * velocity ω is in body coordinates.
 *
 * Equations (body frame):
 *   A ω̇x = τx + (B − C) ωy ωz        τ = 3 n² (a/r)³ (û × I û),  û = unit vector Saturn → moon
 *   B ω̇y = τy + (C − A) ωz ωx        (the torque is quadratic in û, so its sign does not matter)
 *   C ω̇z = τz + (A − B) ωx ωy        q̇ = ½ q ⊗ (0, ω)
 * integrated with classical RK4 at a fixed step, the quaternion renormalised after every step.
 */

/** Hyperion's orbital period in days (21.276 d) */
export const HYPERION_PERIOD_DAYS = 21.28
/** orbital eccentricity */
export const HYPERION_ECCENTRICITY = 0.1
/** semi-axes of the triaxial ellipsoid, render units (Hyperion is ~360 × 266 × 205 km) */
export const HYPERION_SEMI_AXES: readonly [number, number, number] = [0.26, 0.19, 0.15]
/** integration step, in time units where one orbit is 2π */
export const HYPERION_DT = 0.002
/** the twin starts turned this far (radians) about the orbit normal */
/** a tenth of a degree: the narration's "started a tenth of a degree apart" (a millionth needs ~20 orbits to show) */
export const TWIN_OFFSET_RAD = (0.1 * Math.PI) / 180
/** the initial spin axis leans this far (radians) off the orbit normal, about the long axis */
export const INITIAL_TILT_RAD = (2 * Math.PI) / 180

const TAU = 2 * Math.PI

export interface Moments {
  A: number
  B: number
  C: number
}

/** principal moments of a uniform solid ellipsoid with semi-axes a ≥ b ≥ c and mass 1 */
export function ellipsoidMoments(a: number, b: number, c: number): Moments {
  return { A: (b * b + c * c) / 5, B: (a * a + c * c) / 5, C: (a * a + b * b) / 5 }
}

export const HYPERION_MOMENTS: Moments = ellipsoidMoments(...HYPERION_SEMI_AXES)

// ---------------------------------------------------------------- the orbit

/** eccentric anomaly E from the mean anomaly M (Kepler's equation M = E − e sin E), Newton's method */
export function eccentricAnomaly(M: number, e: number): number {
  const m = M - TAU * Math.round(M / TAU)
  let E = m + e * Math.sin(m)
  for (let i = 0; i < 16; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E))
    E -= d
    if (Math.abs(d) < 1e-15) break
  }
  return E
}

/**
 * The orbit at time t (n = 1, periapsis at t = 0): writes [cos f, sin f, r / a, 3 (a / r)³] into
 * `out`, where f is the true anomaly.
 */
export function orbitAt(t: number, e: number, out: Float64Array): Float64Array {
  const E = eccentricAnomaly(t, e)
  const cE = Math.cos(E)
  const sE = Math.sin(E)
  const r = 1 - e * cE
  out[0] = (cE - e) / r
  out[1] = (Math.sqrt(1 - e * e) * sE) / r
  out[2] = r
  out[3] = 3 / (r * r * r)
  return out
}

// ---------------------------------------------------------------- quaternions as plain arrays

type Quat = [w: number, x: number, y: number, z: number]
type Vec3 = [number, number, number]

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ]
}

function quatAxisAngle(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(axis[0], axis[1], axis[2])
  const s = Math.sin(angle / 2) / l
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s]
}

export interface InitialAttitude {
  /** attitude quaternion (w, x, y, z), body → inertial */
  q: Quat
  /** body angular velocity */
  w: Vec3
}

export interface InitialOptions {
  /** lean of the spin axis off the orbit normal, about the long axis (default INITIAL_TILT_RAD) */
  tilt?: number
  /** extra rotation applied in the inertial frame (default none) */
  offset?: number
  /** inertial axis of that rotation (default the orbit normal, +z) */
  offsetAxis?: Vec3
  /** spin rate about the body's short axis, in units of n (default 1: synchronous) */
  spin?: number
}

/**
 * The start, at periapsis: the long axis (body +x) points at Saturn (inertial −x), the short axis
 * lies along the orbit normal leaned by `tilt` about the long axis, spinning at `spin` · n about
 * the short axis.
 */
export function initialAttitude(opts: InitialOptions = {}): InitialAttitude {
  const tilt = opts.tilt ?? INITIAL_TILT_RAD
  const face = quatMul(quatAxisAngle([0, 0, 1], Math.PI), quatAxisAngle([1, 0, 0], tilt))
  const q = opts.offset ? quatMul(quatAxisAngle(opts.offsetAxis ?? [0, 0, 1], opts.offset), face) : face
  return { q, w: [0, 0, opts.spin ?? 1] }
}

// ---------------------------------------------------------------- the rigid bodies

export interface TumbleOptions {
  bodies: number
  e?: number
  moments?: Moments
  dt?: number
  /** the gravity-gradient torque (default on) */
  torque?: boolean
}

const STRIDE = 7

/**
 * Any number of rigid bodies sharing one orbit (the twins), stepped together so each step solves
 * Kepler's equation once per RK4 stage time. Allocation-free after construction.
 */
export class TumbleSim {
  readonly bodies: number
  readonly e: number
  readonly A: number
  readonly B: number
  readonly C: number
  readonly dt: number
  torque: boolean
  /** completed steps; the time is steps · dt, exact and identical wherever the sim runs */
  steps = 0
  /** per body: qw qx qy qz ωx ωy ωz */
  readonly y: Float64Array
  /**
   * When set (3 per body), receives the inertial torque impulse ∫ τ dt, accumulated with the RK4
   * stage weights. verify.ts uses it; the stage leaves it null.
   */
  impulse: Float64Array | null = null

  private readonly k1: Float64Array
  private readonly k2: Float64Array
  private readonly k3: Float64Array
  private readonly k4: Float64Array
  private readonly tmp: Float64Array
  private readonly o0 = new Float64Array(4)
  private readonly oh = new Float64Array(4)
  private readonly o1 = new Float64Array(4)
  private cachedStep = -1

  constructor(opts: TumbleOptions) {
    const m = opts.moments ?? HYPERION_MOMENTS
    this.bodies = opts.bodies
    this.e = opts.e ?? HYPERION_ECCENTRICITY
    this.A = m.A
    this.B = m.B
    this.C = m.C
    this.dt = opts.dt ?? HYPERION_DT
    this.torque = opts.torque ?? true
    const n = opts.bodies * STRIDE
    this.y = new Float64Array(n)
    this.k1 = new Float64Array(n)
    this.k2 = new Float64Array(n)
    this.k3 = new Float64Array(n)
    this.k4 = new Float64Array(n)
    this.tmp = new Float64Array(n)
  }

  get t(): number {
    return this.steps * this.dt
  }

  setBody(i: number, a: InitialAttitude): void {
    const o = i * STRIDE
    const l = Math.hypot(a.q[0], a.q[1], a.q[2], a.q[3])
    for (let k = 0; k < 4; k++) this.y[o + k] = a.q[k] / l
    for (let k = 0; k < 3; k++) this.y[o + 4 + k] = a.w[k]
  }

  /** back to t = 0 (the caller then sets the bodies) */
  rewind(): void {
    this.steps = 0
    this.cachedStep = -1
  }

  advance(count: number): void {
    for (let i = 0; i < count; i++) this.step()
  }

  /** one RK4 step of dt */
  step(): void {
    const h = this.dt
    const y = this.y
    const tmp = this.tmp
    const n = y.length
    const s = this.steps
    // the orbit at the end of the last step is the orbit at the start of this one
    if (this.cachedStep === s) this.o0.set(this.o1)
    else orbitAt(s * h, this.e, this.o0)
    orbitAt((2 * s + 1) * (h / 2), this.e, this.oh)
    orbitAt((s + 1) * h, this.e, this.o1)
    this.cachedStep = s + 1

    this.deriv(this.o0, y, this.k1, h / 6)
    for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * this.k1[i]
    this.deriv(this.oh, tmp, this.k2, h / 3)
    for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * this.k2[i]
    this.deriv(this.oh, tmp, this.k3, h / 3)
    for (let i = 0; i < n; i++) tmp[i] = y[i] + h * this.k3[i]
    this.deriv(this.o1, tmp, this.k4, h / 6)
    for (let i = 0; i < n; i++) y[i] += (h / 6) * (this.k1[i] + 2 * this.k2[i] + 2 * this.k3[i] + this.k4[i])

    for (let b = 0; b < this.bodies; b++) {
      const o = b * STRIDE
      const l = 1 / Math.hypot(y[o], y[o + 1], y[o + 2], y[o + 3])
      y[o] *= l
      y[o + 1] *= l
      y[o + 2] *= l
      y[o + 3] *= l
    }
    this.steps = s + 1
  }

  /** time derivatives of every body at one orbit sample; `weight` scales the impulse tally */
  private deriv(orbit: Float64Array, src: Float64Array, out: Float64Array, weight: number): void {
    const { A, B, C } = this
    const cf = orbit[0]
    const sf = orbit[1]
    const k = this.torque ? orbit[3] : 0
    const imp = this.impulse
    for (let b = 0; b < this.bodies; b++) {
      const o = b * STRIDE
      const qw = src[o]
      const qx = src[o + 1]
      const qy = src[o + 2]
      const qz = src[o + 3]
      const wx = src[o + 4]
      const wy = src[o + 5]
      const wz = src[o + 6]
      // rotation matrix of q, exact for a non-unit q (RK4 stages drift off the unit sphere)
      const s = 2 / (qw * qw + qx * qx + qy * qy + qz * qz)
      const r00 = 1 - s * (qy * qy + qz * qz)
      const r01 = s * (qx * qy - qw * qz)
      const r02 = s * (qx * qz + qw * qy)
      const r10 = s * (qx * qy + qw * qz)
      const r11 = 1 - s * (qx * qx + qz * qz)
      const r12 = s * (qy * qz - qw * qx)
      const r20 = s * (qx * qz - qw * qy)
      const r21 = s * (qy * qz + qw * qx)
      const r22 = 1 - s * (qx * qx + qy * qy)
      // the radial direction (cos f, sin f, 0) in body coordinates: û = Rᵀ r̂
      const ux = r00 * cf + r10 * sf
      const uy = r01 * cf + r11 * sf
      const uz = r02 * cf + r12 * sf
      // gravity gradient: k (û × I û)
      const tx = k * (C - B) * uy * uz
      const ty = k * (A - C) * uz * ux
      const tz = k * (B - A) * ux * uy
      out[o + 4] = (tx + (B - C) * wy * wz) / A
      out[o + 5] = (ty + (C - A) * wz * wx) / B
      out[o + 6] = (tz + (A - B) * wx * wy) / C
      out[o] = -0.5 * (qx * wx + qy * wy + qz * wz)
      out[o + 1] = 0.5 * (qw * wx + qy * wz - qz * wy)
      out[o + 2] = 0.5 * (qw * wy + qz * wx - qx * wz)
      out[o + 3] = 0.5 * (qw * wz + qx * wy - qy * wx)
      if (imp) {
        const j = b * 3
        imp[j] += weight * (r00 * tx + r01 * ty + r02 * tz)
        imp[j + 1] += weight * (r10 * tx + r11 * ty + r12 * tz)
        imp[j + 2] += weight * (r20 * tx + r21 * ty + r22 * tz)
      }
    }
  }

  /** body i's long axis (body +x) in inertial coordinates */
  longAxis(i: number, out: Float64Array | number[]): void {
    const y = this.y
    const o = i * STRIDE
    const qw = y[o]
    const qx = y[o + 1]
    const qy = y[o + 2]
    const qz = y[o + 3]
    out[0] = 1 - 2 * (qy * qy + qz * qz)
    out[1] = 2 * (qx * qy + qw * qz)
    out[2] = 2 * (qx * qz - qw * qy)
  }

  /** angle (radians, 0..π) between the long axes of bodies i and j, accurate at tiny angles */
  longAxisAngle(i: number, j: number): number {
    const y = this.y
    const a = i * STRIDE
    const b = j * STRIDE
    // body +x of each: first column of its rotation matrix
    const ax = 1 - 2 * (y[a + 2] * y[a + 2] + y[a + 3] * y[a + 3])
    const ay = 2 * (y[a + 1] * y[a + 2] + y[a] * y[a + 3])
    const az = 2 * (y[a + 1] * y[a + 3] - y[a] * y[a + 2])
    const bx = 1 - 2 * (y[b + 2] * y[b + 2] + y[b + 3] * y[b + 3])
    const by = 2 * (y[b + 1] * y[b + 2] + y[b] * y[b + 3])
    const bz = 2 * (y[b + 1] * y[b + 3] - y[b] * y[b + 2])
    const cx = ay * bz - az * by
    const cy = az * bx - ax * bz
    const cz = ax * by - ay * bx
    return Math.atan2(Math.hypot(cx, cy, cz), ax * bx + ay * by + az * bz)
  }

  /** body i's angular momentum I ω in inertial coordinates */
  angularMomentum(i: number, out: Float64Array | number[]): void {
    const y = this.y
    const o = i * STRIDE
    const qw = y[o]
    const qx = y[o + 1]
    const qy = y[o + 2]
    const qz = y[o + 3]
    const lx = this.A * y[o + 4]
    const ly = this.B * y[o + 5]
    const lz = this.C * y[o + 6]
    out[0] = (1 - 2 * (qy * qy + qz * qz)) * lx + 2 * (qx * qy - qw * qz) * ly + 2 * (qx * qz + qw * qy) * lz
    out[1] = 2 * (qx * qy + qw * qz) * lx + (1 - 2 * (qx * qx + qz * qz)) * ly + 2 * (qy * qz - qw * qx) * lz
    out[2] = 2 * (qx * qz - qw * qy) * lx + 2 * (qy * qz + qw * qx) * ly + (1 - 2 * (qx * qx + qy * qy)) * lz
  }

  /** attitude of body i as (w, x, y, z) */
  quaternion(i: number, out: Float64Array | number[]): void {
    const o = i * STRIDE
    out[0] = this.y[o]
    out[1] = this.y[o + 1]
    out[2] = this.y[o + 2]
    out[3] = this.y[o + 3]
  }
}

/** the chapter's pair: body 0 is Hyperion, body 1 the twin turned TWIN_OFFSET_RAD about the orbit normal */
export function resetPair(sim: TumbleSim, offset = TWIN_OFFSET_RAD): void {
  sim.rewind()
  sim.setBody(0, initialAttitude())
  if (sim.bodies > 1) sim.setBody(1, initialAttitude({ offset }))
}

export function createPair(opts: Partial<TumbleOptions> = {}, offset = TWIN_OFFSET_RAD): TumbleSim {
  const sim = new TumbleSim({ ...opts, bodies: 2 })
  resetPair(sim, offset)
  return sim
}

/** position on the orbit at time t, in the orbit plane (periapsis on +x), for semi-major axis `a` */
export function orbitPosition(t: number, e: number, a: number, out: Float64Array | number[]): void {
  const E = eccentricAnomaly(t, e)
  out[0] = a * (Math.cos(E) - e)
  out[1] = a * Math.sqrt(1 - e * e) * Math.sin(E)
}

export const orbitsAt = (t: number) => t / TAU
