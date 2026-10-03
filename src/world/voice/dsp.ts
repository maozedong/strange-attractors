/**
 * Signal maths for the voice stage: pitch, roughness, stitching overlapping analyser reads
 * into one continuous signal, and the delay embedding with its fixed rotation.
 *
 * No DOM, no three.js, and no allocation after construction, so the same code runs in the
 * frame loop and under `pnpm tsx src/world/voice/verify.ts`.
 */

/** samples per analyser read (AnalyserNode.fftSize) */
export const WINDOW = 4096

export const PITCH_MIN_HZ = 60
export const PITCH_MAX_HZ = 500
/** below this RMS the pitch reads 0 */
export const PITCH_MIN_RMS = 0.004
/**
 * A window whose best normalised autocorrelation (at a lag in the pitch range) is below this
 * has no pitch: breath, consonants, room noise. Voiced speech sits around 0.7 to 0.98.
 */
export const PITCH_MIN_CLARITY = 0.5

/** the pitch tracker looks at the signal low-passed here, decimated to about this rate */
const PITCH_LOWPASS_HZ = 1000
const PITCH_DECIMATED_HZ = 8000
/** a later autocorrelation peak wins only if it is this much higher than an earlier one (McLeod's k) */
const PITCH_PEAK_RATIO = 0.9
const MAX_KEY_MAXIMA = 64

/** "high frequency" for the roughness measure: above most of a vowel's energy, below a hiss */
export const ROUGHNESS_CUTOFF_HZ = 2000

/** samples at the start of a window ignored while a filter settles */
const SETTLE = 32

const INV_SQRT2 = 1 / Math.SQRT2
const INV_SQRT3 = 1 / Math.sqrt(3)
const INV_SQRT6 = 1 / Math.sqrt(6)

/**
 * Row-major rotation applied to the embedding (x(t), x(t−τ), x(t−2τ)). Its rows are an
 * orthonormal basis chosen so the picture reads like a phase portrait:
 *
 *   world Y = (x0 + x1 + x2) / √3        the signal's local mean: the diagonal (1,1,1)/√3 → +Y
 *   world X = (x2 − x0) / √2             minus its slope (a central difference across 2τ)
 *   world Z = (2·x1 − x0 − x2) / √6      minus its curvature (a second difference)
 *
 * Mapping the diagonal to +Y fixes all but a spin about Y; that spin is chosen so the loop of
 * every pure tone faces the +Z camera (its plane always contains world X), tipped back from
 * vertical by atan(√2(1 − cos φ) / (1 + 2 cos φ)), φ = 2π f τ. det = +1.
 */
export const EMBED_ROTATION: readonly number[] = [
  -INV_SQRT2, 0, INV_SQRT2,
  INV_SQRT3, INV_SQRT3, INV_SQRT3,
  -INV_SQRT6, 2 * INV_SQRT6, -INV_SQRT6,
]

/**
 * Embed `count` consecutive samples ending at ring index `newest` (oldest first) into `out`
 * as xyz triples: gain · EMBED_ROTATION · (x[t], x[t − lag], x[t − 2·lag]). `ring.length`
 * must be a power of two, and the `count + 2·lag` samples read must all be valid.
 */
export function embedRing(
  ring: ArrayLike<number>,
  newest: number,
  count: number,
  lag: number,
  gain: number,
  out: Float32Array | Float64Array,
): void {
  const mask = ring.length - 1
  const R = EMBED_ROTATION
  const r00 = R[0] * gain, r01 = R[1] * gain, r02 = R[2] * gain
  const r10 = R[3] * gain, r11 = R[4] * gain, r12 = R[5] * gain
  const r20 = R[6] * gain, r21 = R[7] * gain, r22 = R[8] * gain
  const lag2 = 2 * lag
  let idx = (newest - (count - 1)) & mask
  for (let i = 0, o = 0; i < count; i++, o += 3) {
    const x0 = ring[idx]
    const x1 = ring[(idx - lag) & mask]
    const x2 = ring[(idx - lag2) & mask]
    out[o] = r00 * x0 + r01 * x1 + r02 * x2
    out[o + 1] = r10 * x0 + r11 * x1 + r12 * x2
    out[o + 2] = r20 * x0 + r21 * x1 + r22 * x2
    idx = (idx + 1) & mask
  }
}

// ---------------------------------------------------------------- filters

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** RBJ cookbook low-pass (normalised by a0) */
export function lowpass(fs: number, fc: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * Math.min(fc, fs * 0.45)) / fs
  const c = Math.cos(w)
  const a = Math.sin(w) / (2 * q)
  const a0 = 1 + a
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 }
}

/** RBJ cookbook high-pass (normalised by a0) */
export function highpass(fs: number, fc: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * Math.min(fc, fs * 0.45)) / fs
  const c = Math.cos(w)
  const a = Math.sin(w) / (2 * q)
  const a0 = 1 + a
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 }
}

/** The band-pass Web Audio's BiquadFilterNode uses (RBJ, 0 dB peak), normalised by a0. */
export function bandpass(fs: number, fc: number, q: number): Biquad {
  const w = (2 * Math.PI * fc) / fs
  const a = Math.sin(w) / (2 * q)
  const a0 = 1 + a
  return { b0: a / a0, b1: 0, b2: -a / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - a) / a0 }
}

// ---------------------------------------------------------------- level and roughness

/** Mean of the first `n` samples. */
export function mean(x: ArrayLike<number>, n: number): number {
  let s = 0
  for (let i = 0; i < n; i++) s += x[i]
  return n > 0 ? s / n : 0
}

/** RMS of the first `n` samples about `m` (their mean), i.e. the AC level. */
export function rmsAbout(x: ArrayLike<number>, n: number, m: number): number {
  let s = 0
  for (let i = 0; i < n; i++) {
    const v = x[i] - m
    s += v * v
  }
  return n > 0 ? Math.sqrt(s / n) : 0
}

/**
 * Share of a window's (AC) energy above ROUGHNESS_CUTOFF_HZ, 0..1: about 0 for a vowel's low
 * harmonics, about 0.9 for white noise (everything between the cutoff and Nyquist).
 */
export class RoughnessMeter {
  private readonly hp: Biquad

  constructor(sampleRate: number, cutoff = ROUGHNESS_CUTOFF_HZ) {
    this.hp = highpass(sampleRate, cutoff)
  }

  ratio(x: ArrayLike<number>, n: number, m: number): number {
    const { b0, b1, b2, a1, a2 } = this.hp
    // start in the steady state for the first sample (a high-pass of a constant is 0)
    const u0 = x[0] - m
    let s2 = b2 * u0
    let s1 = (b1 + b2) * u0
    let hi = 0
    let all = 0
    for (let i = 0; i < n; i++) {
      const u = x[i] - m
      const y = b0 * u + s1
      s1 = b1 * u - a1 * y + s2
      s2 = b2 * u - a2 * y
      if (i >= SETTLE) {
        hi += y * y
        all += u * u
      }
    }
    return all > 1e-20 ? Math.min(1, hi / all) : 0
  }
}

// ---------------------------------------------------------------- pitch

/**
 * Normalised-autocorrelation pitch tracker (McLeod & Wyvill's NSDF with their peak picking).
 *
 * The window is low-passed at 1 kHz and decimated to about 8 kHz for the coarse search over
 * 60 to 500 Hz, then the chosen peak is refined at full rate and interpolated with a parabola,
 * so the answer is accurate to a small fraction of a sample. About 0.1 ms per 4096 samples.
 */
export class PitchEstimator {
  readonly sampleRate: number
  readonly decimation: number
  /** normalised autocorrelation at the chosen period, 0..1 (how periodic the window was) */
  clarity = 0

  private readonly lp: Biquad
  private readonly z: Float32Array
  private readonly sq: Float64Array
  private readonly d: Float32Array
  private readonly nsdf: Float32Array
  private readonly keyLag: Int32Array
  private readonly keyVal: Float32Array
  private readonly minLagD: number
  private readonly maxLagD: number

  constructor(sampleRate: number, capacity = WINDOW) {
    this.sampleRate = sampleRate
    this.decimation = Math.max(1, Math.floor(sampleRate / PITCH_DECIMATED_HZ))
    this.lp = lowpass(sampleRate, PITCH_LOWPASS_HZ)
    this.z = new Float32Array(capacity)
    this.sq = new Float64Array(capacity + 1)
    this.d = new Float32Array(Math.ceil(capacity / this.decimation))
    const fsD = sampleRate / this.decimation
    this.minLagD = Math.max(2, Math.floor(fsD / PITCH_MAX_HZ))
    this.maxLagD = Math.ceil(fsD / PITCH_MIN_HZ)
    this.nsdf = new Float32Array(this.maxLagD + 2)
    this.keyLag = new Int32Array(MAX_KEY_MAXIMA)
    this.keyVal = new Float32Array(MAX_KEY_MAXIMA)
  }

  /** Pitch of the first `n` samples in Hz, or 0 when they are not periodic within 60 to 500 Hz. */
  estimate(x: ArrayLike<number>, n = x.length): number {
    this.clarity = 0
    n = Math.min(n, this.z.length)
    const D = this.decimation
    const M = Math.floor((n - 1) / D) + 1
    if (M < 2 * this.maxLagD + 2) return 0

    // mean-removed, low-passed copy (filter started in its steady state for the first sample)
    const m = mean(x, n)
    const { b0, b1, b2, a1, a2 } = this.lp
    const u0 = x[0] - m
    let s2 = (b2 - a2) * u0
    let s1 = (b1 - a1) * u0 + s2
    const z = this.z
    const sq = this.sq
    const d = this.d
    sq[0] = 0
    for (let i = 0; i < n; i++) {
      const u = x[i] - m
      const y = b0 * u + s1
      s1 = b1 * u - a1 * y + s2
      s2 = b2 * u - a2 * y
      z[i] = y
      sq[i + 1] = sq[i] + y * y
    }
    for (let k = 0; k < M; k++) d[k] = z[k * D]

    // coarse NSDF on the decimated signal: 2·Σ d[i]d[i+τ] / Σ (d[i]² + d[i+τ]²)
    const T = this.maxLagD + 1
    const nsdf = this.nsdf
    let energy = 0
    for (let i = 0; i < M; i++) energy += d[i] * d[i]
    if (energy < 1e-20) return 0
    let msum = 2 * energy
    for (let tau = 0; tau <= T; tau++) {
      let acf = 0
      for (let i = 0, j = tau; j < M; i++, j++) acf += d[i] * d[j]
      nsdf[tau] = msum > 1e-20 ? (2 * acf) / msum : 0
      msum -= d[tau] * d[tau] + d[M - 1 - tau] * d[M - 1 - tau]
    }

    // key maxima: the highest point of each positive lobe after the zero-lag lobe
    let keys = 0
    let globalMax = 0
    let tau = 1
    while (tau <= T && nsdf[tau] > 0) tau++
    while (tau <= T && keys < MAX_KEY_MAXIMA) {
      while (tau <= T && nsdf[tau] <= 0) tau++
      if (tau > T) break
      let peakLag = tau
      let peakVal = nsdf[tau]
      while (tau <= T && nsdf[tau] > 0) {
        if (nsdf[tau] > peakVal) {
          peakVal = nsdf[tau]
          peakLag = tau
        }
        tau++
      }
      // a lobe still rising at the edge of the range has its peak outside it
      if (peakLag >= this.minLagD && peakLag < T) {
        this.keyLag[keys] = peakLag
        this.keyVal[keys] = peakVal
        keys++
        if (peakVal > globalMax) globalMax = peakVal
      }
    }
    if (keys === 0) return 0
    let pick = 0
    while (pick < keys - 1 && this.keyVal[pick] < PITCH_PEAK_RATIO * globalMax) pick++
    const coarse = this.keyLag[pick]
    if (this.keyVal[pick] < PITCH_MIN_CLARITY) {
      this.clarity = this.keyVal[pick]
      return 0
    }
    const coarseLag = (coarse + parabola(nsdf[coarse - 1], nsdf[coarse], nsdf[coarse + 1])) * D

    // refine at full rate around the coarse estimate
    const lo = Math.max(1, Math.floor(coarseLag) - D - 1)
    const hi = Math.min(n - 2, Math.ceil(coarseLag) + D + 1)
    let bestLag = lo
    let bestVal = -Infinity
    for (let L = lo; L <= hi; L++) {
      const v = this.fullNsdf(L, n)
      if (v > bestVal) {
        bestVal = v
        bestLag = L
      }
    }
    let lag = bestLag
    if (bestLag > lo && bestLag < hi) {
      lag += parabola(this.fullNsdf(bestLag - 1, n), bestVal, this.fullNsdf(bestLag + 1, n))
    }
    this.clarity = Math.max(0, Math.min(1, bestVal))
    if (!(lag > 0)) return 0
    const hz = this.sampleRate / lag
    return hz >= PITCH_MIN_HZ * 0.97 && hz <= PITCH_MAX_HZ * 1.03 ? hz : 0
  }

  private fullNsdf(L: number, n: number): number {
    const z = this.z
    let acf = 0
    for (let i = 0, j = L; j < n; i++, j++) acf += z[i] * z[j]
    const msum = this.sq[n - L] + (this.sq[n] - this.sq[L])
    return msum > 1e-20 ? (2 * acf) / msum : 0
  }
}

/** Offset of a parabola's vertex through (−1, a), (0, b), (1, c), clamped to ±0.5. */
function parabola(a: number, b: number, c: number): number {
  const den = a - 2 * b + c
  if (!(Math.abs(den) > 1e-12)) return 0
  return Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den))
}

// ---------------------------------------------------------------- stitching analyser reads

/** probes compared when testing an alignment; both ends of the overlap are always included */
const ALIGN_PROBES = 32
/** an alignment must share at least this many samples to count */
const ALIGN_MIN_OVERLAP = 256

/**
 * An AnalyserNode returns the latest `n` samples each time it is read, so consecutive reads
 * overlap. Returns how many samples at the end of `cur` are new since `prev`, by finding the
 * shift s with cur[i] === prev[i + s] across the overlap (the analyser hands back the same
 * floats, so the comparison is exact). The search starts at `estimate` (elapsed context time
 * × sample rate) and widens, so on silence, where every shift matches, the clock decides.
 * Returns `n` when no shift fits: a gap longer than the window, or a different signal.
 */
export function freshSamples(prev: ArrayLike<number>, cur: ArrayLike<number>, n: number, estimate: number): number {
  const maxShift = n - ALIGN_MIN_OVERLAP
  const est = Math.max(0, Math.min(maxShift, Math.round(estimate) || 0))
  for (let dist = 0; dist <= maxShift; dist++) {
    const up = est + dist
    if (up <= maxShift && overlapMatches(prev, cur, n, up)) return up
    const down = est - dist
    if (dist > 0 && down >= 0 && overlapMatches(prev, cur, n, down)) return down
    if (up > maxShift && down < 0) break
  }
  return n
}

function overlapMatches(prev: ArrayLike<number>, cur: ArrayLike<number>, n: number, s: number): boolean {
  const L = n - s
  // the newest shared sample first: it rejects almost every wrong shift
  if (cur[L - 1] !== prev[n - 1] || cur[0] !== prev[s]) return false
  for (let k = 1; k < ALIGN_PROBES - 1; k++) {
    const i = Math.floor((k * (L - 1)) / (ALIGN_PROBES - 1))
    if (cur[i] !== prev[i + s]) return false
  }
  return true
}

// ---------------------------------------------------------------- the fallback vowel

/**
 * The synthesized vowel: six phase-locked harmonics of 118 Hz with a ±3 % vibrato at 5.5 Hz
 * and a little band-passed breath. Harmonic amplitudes lean on the 5th and 6th (590 and
 * 708 Hz), where an open "ah" has its first formant.
 */
export const TONE = {
  f0: 118,
  vibratoHz: 5.5,
  /** fractional depth of the vibrato (±) */
  vibratoDepth: 0.03,
  /** relative amplitudes of harmonics 1..6; the mix is normalised to their sum */
  harmonics: [1, 0.5, 0.3, 0.24, 0.28, 0.22] as readonly number[],
  /** breath noise: white noise through a band-pass, then this gain relative to the harmonic mix */
  breath: 0.06,
  breathHz: 1800,
  breathQ: 0.8,
  /** output level of the whole tone, dB (the mix peaks near 0 dBFS before this) */
  levelDb: -22,
} as const

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * The same vowel computed offline, for verification and previews: what the Web Audio graph
 * in sources.ts plays, minus that graph's 0.1 s fade-in. `random` supplies the breath noise.
 */
export function synthesizeTone(sampleRate: number, out: Float32Array | Float64Array, random: () => number): void {
  const h = TONE.harmonics
  let sum = 0
  for (const a of h) sum += a
  const level = dbToGain(TONE.levelDb)
  const bp = bandpass(sampleRate, TONE.breathHz, TONE.breathQ)
  let s1 = 0
  let s2 = 0
  let phase = 0
  const cents = 1200 * Math.log2(1 + TONE.vibratoDepth)
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate
    let v = 0
    for (let k = 0; k < h.length; k++) v += (h[k] / sum) * Math.sin((k + 1) * phase)
    const u = 2 * random() - 1
    const y = bp.b0 * u + s1
    s1 = bp.b1 * u - bp.a1 * y + s2
    s2 = bp.b2 * u - bp.a2 * y
    out[i] = level * (v + TONE.breath * y)
    const f = TONE.f0 * Math.pow(2, (cents * Math.sin(2 * Math.PI * TONE.vibratoHz * t)) / 1200)
    phase += (2 * Math.PI * f) / sampleRate
  }
}

// ---------------------------------------------------------------- colour

/**
 * The house speedColor ramp (src/scene/palette.ts) on the CPU, written into `out` as the same
 * raw values the shaders use (pass them to Color.setRGB, which treats them as linear).
 */
export function speedColorInto<T extends { r: number; g: number; b: number }>(t: number, out: T): T {
  t = Math.max(0, Math.min(1, t))
  const w1 = smoothstep(0, 0.35, t)
  const w2 = smoothstep(0.35, 0.68, t)
  const w3 = smoothstep(0.68, 1, t)
  let r = 0.043 + (0.302 - 0.043) * w1
  let g = 0.114 + (0.247 - 0.114) * w1
  let b = 0.42 + (0.839 - 0.42) * w1
  r += (0.914 - r) * w2
  g += (0.416 - g) * w2
  b += (0.627 - b) * w2
  r += (1.0 - r) * w3
  g += (0.941 - g) * w3
  b += (0.784 - b) * w3
  out.r = r
  out.g = g
  out.b = b
  return out
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
