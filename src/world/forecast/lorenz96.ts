/**
 * The Lorenz-96 model (Lorenz 1996): N values on a ring of "weather stations",
 *
 *   dx_i/dt = (x_{i+1} − x_{i−2}) x_{i−1} − x_i + F,   indices periodic,
 *
 * advection (the quadratic term), damping (−x_i) and forcing (F). With N = 40 and F = 8 it is
 * chaotic, and Lorenz scaled time so that 1 unit ≈ 5 days (the damping time of real weather).
 * One RK4 step of dt = 0.05 is therefore 6 hours, and a day is 4 steps.
 *
 * Pure numerics, no three.js: the Ensemble component and verify.ts run exactly this code.
 * Nothing here allocates after construction.
 */

export const L96_N = 40
export const L96_F = 8
/** model time units per RK4 step (= 6 hours) */
export const L96_DT = 0.05
export const STEPS_PER_DAY = 4
export const DAYS_PER_STEP = 1 / STEPS_PER_DAY
/** steps the truth runs from x = F + noise before day 0, so it starts on the attractor */
export const SPINUP_STEPS = 1000
/** a reset adds up to this many more spin-up steps (and a fresh seed), so every run is different weather */
export const SPINUP_EXTRA = 500
export const MAX_MEMBERS = 64
/** std of the noise added to x = F before spin-up */
const SPINUP_NOISE = 0.01

/**
 * Climatology of Lorenz-96 at N = 40, F = 8, measured by verify.ts (4 runs × 200 000 steps,
 * ≈ 140 years of model weather each): the long-run mean of x and its standard deviation.
 *
 * CLIMATE_SPREAD is "as wide as the weather itself": once the members are unrelated weather,
 * their RMS deviation from the ensemble mean tends to CLIMATE_SPREAD × √(1 − 1/members)
 * (0.99 × CLIMATE_SPREAD for 50 members).
 */
export const CLIMATE_MEAN = 2.342
export const CLIMATE_SPREAD = 3.640

const N = L96_N
const IP1 = new Int32Array(N)
const IM1 = new Int32Array(N)
const IM2 = new Int32Array(N)
for (let i = 0; i < N; i++) {
  IP1[i] = (i + 1) % N
  IM1[i] = (i + N - 1) % N
  IM2[i] = (i + N - 2) % N
}

/** out[oo + i] = dx_i/dt at the state x[xo .. xo + N). `out` must not alias `x`. */
export function l96Tendency(x: Float64Array, xo: number, out: Float64Array, oo: number, F = L96_F): void {
  for (let i = 0; i < N; i++) {
    out[oo + i] = (x[xo + IP1[i]] - x[xo + IM2[i]]) * x[xo + IM1[i]] - x[xo + i] + F
  }
}

/** Classic RK4 on one N-site state stored at s[o .. o + N), in place. Owns its scratch. */
export class L96Stepper {
  private readonly k1 = new Float64Array(N)
  private readonly k2 = new Float64Array(N)
  private readonly k3 = new Float64Array(N)
  private readonly k4 = new Float64Array(N)
  private readonly tmp = new Float64Array(N)

  constructor(
    readonly dt = L96_DT,
    readonly F = L96_F,
  ) {}

  step(s: Float64Array, o = 0): void {
    const { k1, k2, k3, k4, tmp, dt, F } = this
    const h = 0.5 * dt
    l96Tendency(s, o, k1, 0, F)
    for (let i = 0; i < N; i++) tmp[i] = s[o + i] + h * k1[i]
    l96Tendency(tmp, 0, k2, 0, F)
    for (let i = 0; i < N; i++) tmp[i] = s[o + i] + h * k2[i]
    l96Tendency(tmp, 0, k3, 0, F)
    for (let i = 0; i < N; i++) tmp[i] = s[o + i] + dt * k3[i]
    l96Tendency(tmp, 0, k4, 0, F)
    const w = dt / 6
    for (let i = 0; i < N; i++) s[o + i] += w * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  }

  run(s: Float64Array, steps: number, o = 0): void {
    for (let n = 0; n < steps; n++) this.step(s, o)
  }
}

// ---------------------------------------------------------------- deterministic randomness

/** splitmix32-style integer hash: a well-mixed 32-bit seed from any integer. */
export function hash32(n: number): number {
  let z = (Math.floor(n) + 0x9e3779b9) | 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
  return (z ^ (z >>> 16)) >>> 0
}

/** mulberry32 uniform generator with a Box–Muller normal on top. No allocation per draw. */
export class Rng {
  private s = 0
  private spare = 0
  private hasSpare = false

  constructor(seed = 0) {
    this.seed(seed)
  }

  seed(seed: number): this {
    this.s = seed >>> 0
    this.hasSpare = false
    return this
  }

  /** uniform in (0, 1) */
  uniform(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296
  }

  normal(): number {
    if (this.hasSpare) {
      this.hasSpare = false
      return this.spare
    }
    const r = Math.sqrt(-2 * Math.log(this.uniform()))
    const a = 2 * Math.PI * this.uniform()
    this.spare = r * Math.sin(a)
    this.hasSpare = true
    return r * Math.cos(a)
  }
}

/** Spin-up length for a reset serial: exactly SPINUP_STEPS for run 0, then 1..SPINUP_EXTRA more. */
export function spinupSteps(serial: number): number {
  const n = Math.floor(serial)
  return n === 0 ? SPINUP_STEPS : SPINUP_STEPS + 1 + (hash32(n ^ 0x5bd1e995) % SPINUP_EXTRA)
}

// ---------------------------------------------------------------- the ensemble

export interface EnsembleStart {
  /** which run (the store's resetSerial): picks the truth's seed and spin-up length */
  serial: number
  /** members besides the truth, clamped to 0..MAX_MEMBERS */
  members: number
  /** std of the Gaussian error added to every site of every member at day 0 */
  perturbation: number
}

/**
 * The truth and up to MAX_MEMBERS perturbed copies, stepped in lockstep, with the ensemble
 * mean, spread and error kept current after every start and step.
 *
 * Determinism: the truth depends only on `serial`; member k's day-0 error pattern depends only
 * on `serial` and k (scaled by `perturbation`), so changing the member count adds or removes
 * members without changing the others, and the same serial is the same weather.
 */
export class L96Ensemble {
  readonly truth = new Float64Array(N)
  /** member k occupies [k·N, (k+1)·N) */
  readonly members = new Float64Array(MAX_MEMBERS * N)
  readonly mean = new Float64Array(N)
  /** members in use */
  count = 0
  /** steps since day 0 */
  steps = 0
  /** RMS over sites and members of (member − ensemble mean) */
  spread = 0
  /** RMS over sites of (ensemble mean − truth); 0 without members */
  error = 0

  private readonly stepper = new L96Stepper()
  private readonly rng = new Rng()
  /** the truth at day 0 for the last serial, so a members/perturbation change keeps the weather */
  private readonly start0 = new Float64Array(N)
  private start0Serial = NaN

  get day(): number {
    return this.steps * DAYS_PER_STEP
  }

  /** Begin a run at day 0. Spins the truth up only when `serial` differs from the last start. */
  start({ serial, members, perturbation }: EnsembleStart): void {
    const t = this.truth
    if (serial !== this.start0Serial) {
      this.rng.seed(hash32(serial))
      for (let i = 0; i < N; i++) t[i] = L96_F + SPINUP_NOISE * this.rng.normal()
      this.stepper.run(t, spinupSteps(serial))
      this.start0.set(t)
      this.start0Serial = serial
    } else {
      t.set(this.start0)
    }

    const m = Math.max(0, Math.min(MAX_MEMBERS, Math.round(members) || 0))
    const sd = Math.abs(perturbation) || 0
    this.count = m
    this.rng.seed(hash32(serial) ^ 0x2545f491)
    const xs = this.members
    for (let k = 0; k < m; k++) {
      const o = k * N
      for (let i = 0; i < N; i++) xs[o + i] = t[i] + sd * this.rng.normal()
    }
    this.steps = 0
    this.measure()
  }

  step(): void {
    this.stepper.step(this.truth)
    const xs = this.members
    for (let k = 0; k < this.count; k++) this.stepper.step(xs, k * N)
    this.steps++
    this.measure()
  }

  /** Recompute mean, spread and error from the current states. */
  measure(): void {
    const m = this.count
    const t = this.truth
    const mean = this.mean
    const xs = this.members
    if (m === 0) {
      mean.set(t)
      this.spread = 0
      this.error = 0
      return
    }
    mean.fill(0)
    for (let k = 0; k < m; k++) {
      const o = k * N
      for (let i = 0; i < N; i++) mean[i] += xs[o + i]
    }
    const inv = 1 / m
    let e2 = 0
    for (let i = 0; i < N; i++) {
      mean[i] *= inv
      const d = mean[i] - t[i]
      e2 += d * d
    }
    let s2 = 0
    for (let k = 0; k < m; k++) {
      const o = k * N
      for (let i = 0; i < N; i++) {
        const d = xs[o + i] - mean[i]
        s2 += d * d
      }
    }
    this.spread = Math.sqrt(s2 / (m * N))
    this.error = Math.sqrt(e2 / N)
  }
}

/** RMS over sites of a − b (two N-site states). */
export function rmsDistance(a: Float64Array, ao: number, b: Float64Array, bo: number): number {
  let s = 0
  for (let i = 0; i < N; i++) {
    const d = a[ao + i] - b[bo + i]
    s += d * d
  }
  return Math.sqrt(s / N)
}
