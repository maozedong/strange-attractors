import type { FirefliesState } from '../../fractal/types'
import { resetFirefliesSeries, worldTele } from '../telemetry'

/**
 * The Kuramoto model (1975) for the fireflies stage, without React or three.js, so it runs and
 * is checked in Node (verify.ts). Allocates nothing per frame.
 *
 *   dθ_i/dt = ω_i + (K/N) Σ_j sin(θ_j − θ_i),   ω_i ~ N(OMEGA0, SIGMA)
 *
 * integrated in the mean-field form, exact for all-to-all coupling and O(N): with
 * r·e^{iψ} = (1/N) Σ_j e^{iθ_j},  dθ_i/dt = ω_i + K·r·sin(ψ − θ_i). A firefly flashes when its
 * phase passes 0 (mod 2π).
 */

/** seconds between one firefly's flashes, at the mean frequency */
export const FLASH_PERIOD = 1.1
/** mean natural frequency, rad/s */
export const OMEGA0 = (2 * Math.PI) / FLASH_PERIOD
/** spread of the natural frequencies, rad/s (4.4 % of OMEGA0) */
export const SIGMA = 0.25
export const MAX_FIREFLIES = 4000
/** longest frame integrated in full; slower frames run the tree in slow motion */
export const MAX_FRAME = 1 / 30
/** Euler substeps per frame */
export const SUBSTEPS = 4
/** simulated seconds between telemetry samples */
export const SAMPLE_EVERY = 0.1
/** samples the telemetry series holds; it stops there (the chart reads it from index 0) */
export const SERIES_CAP = worldTele.firefliesT.length

const TAU = 2 * Math.PI

/**
 * Kuramoto's critical coupling for a Gaussian spread of natural frequencies:
 * K_c = 2 / (π g(0)) = 2σ·√(2/π) (≈ 0.399 for the stage's σ = 0.25). Below it the incoherent
 * state is stable; above it a synchronised core forms. (Exact for N → ∞.)
 */
export function criticalCoupling(sigma = SIGMA): number {
  return 2 * sigma * Math.sqrt(2 / Math.PI)
}

/**
 * Brightness of one flash, 0..1, from the phase: smoothstep(0, 1, ((1 + cos θ)/2)^24), a pulse
 * centred on θ = 0 with a full width at half maximum of 0.68 rad (0.12 s at OMEGA0). The shader
 * adds a dim always-on glow on top.
 */
export function flash(theta: number): number {
  return flashFromCos(Math.cos(theta))
}

function flashFromCos(c: number): number {
  const x = Math.max(0, 0.5 + 0.5 * c)
  const x2 = x * x
  const x4 = x2 * x2
  const x8 = x4 * x4
  const p = x8 * x8 * x8 // x^24
  return p * p * (3 - 2 * p)
}

// ---------------------------------------------------------------- deterministic draws

/** Wellons' low-bias 32-bit integer hash. */
function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad)
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97)
  return (x ^ (x >>> 15)) >>> 0
}

/** Uniform in (0, 1), a pure function of (seed, firefly, stream): any prefix of the
 *  population is the same whatever the count, and a count change leaves the others alone. */
function uniform(seed: number, i: number, stream: number): number {
  return (hash32((seed ^ hash32(i * 3 + stream + 1)) >>> 0) + 0.5) / 4294967296
}

/** The population seed for a store `resetSerial`: each reset draws new clocks, reproducibly. */
export function seedFor(resetSerial: number): number {
  return hash32(((Math.trunc(resetSerial) | 0) ^ 0x2545f491) >>> 0)
}

export function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_FIREFLIES, Math.round(count) || 1))
}

// ---------------------------------------------------------------- the oscillators

export class Kuramoto {
  /** phases in [0, 2π) */
  readonly theta = new Float64Array(MAX_FIREFLIES)
  /** natural frequencies, rad/s */
  readonly omega = new Float64Array(MAX_FIREFLIES)
  /** cos θ and sin θ of the current phases */
  readonly cos = new Float64Array(MAX_FIREFLIES)
  readonly sin = new Float64Array(MAX_FIREFLIES)
  count = 0
  seed = 0
  /** simulated seconds since the last reset */
  time = 0
  /** the mean field (1/N) Σ e^{iθ} = re + i·im of the current phases */
  re = 0
  im = 0

  constructor(count = 0, seed = 1) {
    if (count > 0) this.reset(count, seed)
  }

  /** order parameter r = |(1/N) Σ e^{iθ}|, 0 = incoherent, 1 = one clock */
  get r(): number {
    return Math.hypot(this.re, this.im)
  }

  /** phase of the mean field */
  get psi(): number {
    return Math.atan2(this.im, this.re)
  }

  /** A new population: random phases and frequencies drawn from `seed`, time back to 0. */
  reset(count: number, seed: number): void {
    this.seed = seed >>> 0
    this.count = 0
    this.time = 0
    this.resize(count)
  }

  /** Change N in place: fireflies that join are drawn fresh (random phase), the rest keep theirs. */
  resize(count: number): void {
    const n = clampCount(count)
    for (let i = this.count; i < n; i++) {
      const u1 = uniform(this.seed, i, 0)
      const u2 = uniform(this.seed, i, 1)
      this.omega[i] = OMEGA0 + SIGMA * Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2)
      this.theta[i] = TAU * uniform(this.seed, i, 2)
    }
    this.count = n
    this.measure()
  }

  /** Recompute cos θ, sin θ and the mean field from the phases (after writing `theta` directly). */
  measure(): void {
    const n = this.count
    let sc = 0
    let ss = 0
    for (let i = 0; i < n; i++) {
      const c = Math.cos(this.theta[i])
      const s = Math.sin(this.theta[i])
      this.cos[i] = c
      this.sin[i] = s
      sc += c
      ss += s
    }
    this.re = n > 0 ? sc / n : 0
    this.im = n > 0 ? ss / n : 0
  }

  /**
   * One explicit Euler step of `h` seconds at coupling K. Uses K·r·sin(ψ − θ) =
   * K·(im·cos θ − re·sin θ), so the mean field costs no trig; the new phases' cos/sin and mean
   * field are computed in the same pass, ready for the next step.
   */
  step(h: number, K: number): void {
    const n = this.count
    if (n === 0) return
    const th = this.theta
    const w = this.omega
    const c = this.cos
    const s = this.sin
    const a = K * this.im
    const b = K * this.re
    let sc = 0
    let ss = 0
    for (let i = 0; i < n; i++) {
      let t = th[i] + h * (w[i] + a * c[i] - b * s[i])
      t -= TAU * Math.floor(t / TAU)
      th[i] = t
      const ci = Math.cos(t)
      const si = Math.sin(t)
      c[i] = ci
      s[i] = si
      sc += ci
      ss += si
    }
    this.re = sc / n
    this.im = ss / n
    this.time += h
  }
}

// ---------------------------------------------------------------- the stage's frame loop

export function createStage() {
  return {
    sim: new Kuramoto(),
    /** resetSerial the population was drawn for; NaN forces a reset on the first frame */
    serial: NaN,
    /** index of the next telemetry sample, taken at time ≥ index·SAMPLE_EVERY */
    sampleIndex: 0,
    /** per-firefly flash 0..1 of the current phases: the shader's attribute, uploaded as is */
    flashes: new Float32Array(MAX_FIREFLIES),
    /** mean flash over the tree, 0..1 (≈ 0.09 when incoherent, pulsing to ≈ 1 in step) */
    glow: 0,
    /** phases or count changed this frame (re-upload) */
    changed: true,
  }
}

export type FirefliesStage = ReturnType<typeof createStage>

/**
 * One frame: apply the store protocol (a new `resetSerial` draws a new population and clears the
 * telemetry series; a count change adds or drops fireflies in place), integrate `delta` real
 * seconds (capped at MAX_FRAME, SUBSTEPS Euler steps) if running, write the telemetry and
 * refresh the per-firefly flashes when anything moved.
 */
export function advanceStage(st: FirefliesStage, p: FirefliesState, delta: number): void {
  const sim = st.sim
  const count = clampCount(p.count)
  let changed = false

  if (p.resetSerial !== st.serial) {
    sim.reset(count, seedFor(p.resetSerial))
    st.serial = p.resetSerial
    st.sampleIndex = 0
    resetFirefliesSeries()
    changed = true
  } else if (count !== sim.count) {
    sim.resize(count)
    changed = true
  }

  if (p.running) {
    const K = Number.isFinite(p.coupling) ? p.coupling : 0
    const h = Math.min(Math.max(delta, 0), MAX_FRAME) / SUBSTEPS
    if (h > 0) {
      for (let k = 0; k < SUBSTEPS; k++) sim.step(h, K)
      changed = true
    }
  }

  const r = sim.r
  worldTele.firefliesOrder = r
  if (sim.time >= st.sampleIndex * SAMPLE_EVERY - 1e-9) {
    const i = worldTele.firefliesCount
    if (i < SERIES_CAP) {
      worldTele.firefliesT[i] = sim.time
      worldTele.firefliesR[i] = r
      worldTele.firefliesCount = i + 1
    }
    st.sampleIndex = Math.floor(sim.time / SAMPLE_EVERY + 1e-9) + 1
  }

  if (changed) {
    const n = sim.count
    const c = sim.cos
    const f = st.flashes
    let sum = 0
    for (let i = 0; i < n; i++) {
      const v = flashFromCos(c[i])
      f[i] = v
      sum += v
    }
    st.glow = sum / n
  }
  st.changed = changed
}
