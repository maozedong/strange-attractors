/**
 * CPU reference Gray–Scott, for verify.ts only (never bundled into the app):
 *  - FlatGS: an N × N periodic grid with the standard 5-point Laplacian (the classic setting the
 *    presets are judged in);
 *  - SphereGS: the sphere scheme of grid.ts, one value per reduced-grid cell, with the same
 *    taps and arithmetic as the GPU step shader (shaders.ts), in double precision.
 * Both use dt = DT, Du = DU, Dv = DV and clamp to [0, 1] after every step, like the GPU.
 */
import { DT, DU, DV, type RowTable, seedFlat, seedSphere, type SeedOptions } from './grid'

export class FlatGS {
  readonly N: number
  u: Float64Array
  v: Float64Array
  private u2: Float64Array
  private v2: Float64Array

  constructor(N: number, seed: SeedOptions = {}) {
    this.N = N
    this.u = new Float64Array(N * N)
    this.v = new Float64Array(N * N)
    this.u2 = new Float64Array(N * N)
    this.v2 = new Float64Array(N * N)
    seedFlat(this.u, this.v, N, seed)
  }

  step(f: number, k: number, steps = 1): void {
    const N = this.N
    for (let s = 0; s < steps; s++) {
      const { u, v, u2, v2 } = this
      for (let y = 0; y < N; y++) {
        const yn = ((y + N - 1) % N) * N
        const ys = ((y + 1) % N) * N
        const yc = y * N
        for (let x = 0; x < N; x++) {
          const xw = (x + N - 1) % N
          const xe = (x + 1) % N
          const p = yc + x
          const uc = u[p]
          const vc = v[p]
          const lu = u[yc + xw] + u[yc + xe] + u[yn + x] + u[ys + x] - 4 * uc
          const lv = v[yc + xw] + v[yc + xe] + v[yn + x] + v[ys + x] - 4 * vc
          const uvv = uc * vc * vc
          u2[p] = clamp01(uc + DT * (DU * lu - uvv + f * (1 - uc)))
          v2[p] = clamp01(vc + DT * (DV * lv + uvv - (f + k) * vc))
        }
      }
      this.u = u2
      this.v = v2
      this.u2 = u
      this.v2 = v
    }
  }
}

export class SphereGS {
  readonly rows: RowTable
  /** cells in row j, and where row j starts in the cell arrays */
  readonly count: Int32Array
  readonly offset: Int32Array
  readonly cells: number
  u: Float64Array
  v: Float64Array
  private u2: Float64Array
  private v2: Float64Array
  /** the reaction can be switched off to test diffusion alone */
  reaction = true

  constructor(rows: RowTable, seed: SeedOptions | null = {}) {
    this.rows = rows
    const { W, H, m } = rows
    this.count = new Int32Array(H)
    this.offset = new Int32Array(H)
    let n = 0
    for (let j = 0; j < H; j++) {
      this.offset[j] = n
      this.count[j] = W / m[j]
      n += this.count[j]
    }
    this.cells = n
    this.u = new Float64Array(n)
    this.v = new Float64Array(n)
    this.u2 = new Float64Array(n)
    this.v2 = new Float64Array(n)
    if (seed) {
      const fu = new Float32Array(W * H)
      const fv = new Float32Array(W * H)
      seedSphere(fu, fv, rows, seed)
      this.fromTexels(fu, fv)
    }
  }

  /** Load from full W × H texel arrays (takes each cell's first texel, as the shader does). */
  fromTexels(fu: ArrayLike<number>, fv: ArrayLike<number>): void {
    const { W, H, m } = this.rows
    for (let j = 0; j < H; j++) {
      for (let g = 0; g < this.count[j]; g++) {
        this.u[this.offset[j] + g] = fu[j * W + g * m[j]]
        this.v[this.offset[j] + g] = fv[j * W + g * m[j]]
      }
    }
  }

  /** Expand to full W × H texel arrays (what the GPU texture holds). */
  toTexels(fu: Float32Array, fv: Float32Array): void {
    const { W, H, m } = this.rows
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = this.offset[j] + Math.floor(i / m[j])
        fu[j * W + i] = this.u[c]
        fv[j * W + i] = this.v[c]
      }
    }
  }

  step(f: number, k: number, steps = 1): void {
    const { H, m, cN, cS, cPhi } = this.rows
    const { count, offset } = this
    const react = this.reaction ? 1 : 0
    for (let s = 0; s < steps; s++) {
      const { u, v, u2, v2 } = this
      for (let j = 0; j < H; j++) {
        const mj = m[j]
        const n = count[j]
        const base = offset[j]
        const jn = j > 0 ? j - 1 : 0
        const js = j < H - 1 ? j + 1 : H - 1
        const a = cPhi[j]
        const b = cN[j]
        const c = cS[j]
        // a polar cap reads the mean of the whole ring next to it
        let ringU = 0
        let ringV = 0
        if (n === 1) {
          const jr = j === 0 ? 1 : H - 2
          for (let q = 0; q < count[jr]; q++) {
            ringU += u[offset[jr] + q]
            ringV += v[offset[jr] + q]
          }
          ringU /= count[jr]
          ringV /= count[jr]
        }
        for (let g = 0; g < n; g++) {
          const p = base + g
          const pe = base + (g + 1 === n ? 0 : g + 1)
          const pw = base + (g === 0 ? n - 1 : g - 1)
          const uc = u[p]
          const vc = v[p]
          const uN = n === 1 ? ringU : this.across(u, g, mj, jn)
          const vN = n === 1 ? ringV : this.across(v, g, mj, jn)
          const uS = n === 1 ? ringU : this.across(u, g, mj, js)
          const vS = n === 1 ? ringV : this.across(v, g, mj, js)
          const lu = a * (u[pe] + u[pw] - 2 * uc) + b * (uN - uc) + c * (uS - uc)
          const lv = a * (v[pe] + v[pw] - 2 * vc) + b * (vN - vc) + c * (vS - vc)
          const uvv = react * uc * vc * vc
          u2[p] = clamp01(uc + DT * (DU * lu - uvv + react * f * (1 - uc)))
          v2[p] = clamp01(vc + DT * (DV * lv + uvv - react * (f + k) * vc))
        }
      }
      this.u = u2
      this.v = v2
      this.u2 = u
      this.v2 = v
    }
  }

  /** h²∇²x with the step's taps (cells as in `u`), for the accuracy and consistency checks */
  laplacian(x: Float64Array, out: Float64Array): void {
    const { H, m, cN, cS, cPhi } = this.rows
    const { count, offset } = this
    for (let j = 0; j < H; j++) {
      const n = count[j]
      const base = offset[j]
      const jn = j > 0 ? j - 1 : 0
      const js = j < H - 1 ? j + 1 : H - 1
      let ring = 0
      if (n === 1) {
        const jr = j === 0 ? 1 : H - 2
        for (let q = 0; q < count[jr]; q++) ring += x[offset[jr] + q]
        ring /= count[jr]
      }
      for (let g = 0; g < n; g++) {
        const c = x[base + g]
        const e = x[base + (g + 1 === n ? 0 : g + 1)]
        const w = x[base + (g === 0 ? n - 1 : g - 1)]
        const north = n === 1 ? ring : this.across(x, g, m[j], jn)
        const south = n === 1 ? ring : this.across(x, g, m[j], js)
        out[base + g] = cPhi[j] * (e + w - 2 * c) + cN[j] * (north - c) + cS[j] * (south - c)
      }
    }
  }

  /** unit direction of each cell's centre, (x, y, z) per cell, y the pole axis */
  cellCentres(): Float64Array {
    const { W, H, m } = this.rows
    const out = new Float64Array(this.cells * 3)
    for (let j = 0; j < H; j++) {
      const th = (Math.PI * (j + 0.5)) / H
      const cap = this.count[j] === 1
      for (let g = 0; g < this.count[j]; g++) {
        // a cap's centre is the pole itself
        const st = cap ? 0 : Math.sin(th)
        const ph = (2 * Math.PI * (g + 0.5) * m[j]) / W
        const c = (this.offset[j] + g) * 3
        out[c] = st * Math.cos(ph)
        out[c + 1] = cap ? Math.sign(Math.cos(th)) : Math.cos(th)
        out[c + 2] = st * Math.sin(ph)
      }
    }
    return out
  }

  /** Σ area · x over the sphere, area in equator texels² (4π / h² in total) */
  integral(x: Float64Array): number {
    const { H, m, sin } = this.rows
    let total = 0
    for (let j = 0; j < H; j++) {
      let row = 0
      for (let g = 0; g < this.count[j]; g++) row += x[this.offset[j] + g]
      total += row * sin[j] * m[j]
    }
    return total
  }

  /**
   * Row r seen from cell g (m texels) of a neighbouring row, at the cell's φ: the mean of two finer
   * cells, the one cell of the same size, or a coarser cell linearly reconstructed at our centre
   * from its φ neighbours. The same arithmetic as `across` in the GPU step shader (shaders.ts).
   */
  private across(x: Float64Array, g: number, m: number, r: number): number {
    const mr = this.rows.m[r]
    const base = this.offset[r]
    const n = this.count[r]
    const first = g * m
    if (mr < m) return 0.5 * (x[base + Math.floor(first / mr)] + x[base + Math.floor((first + (m >> 1)) / mr)])
    const c = Math.floor(first / mr)
    const here = x[base + c]
    if (mr === m) return here
    const offset = first + 0.5 * m - (c * mr + 0.5 * mr)
    return here + (x[base + ((c + 1) % n)] - x[base + ((c - 1 + n) % n)]) * (offset / (2 * mr))
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

// ---------------------------------------------------------------- pattern measures

export interface PhaseStats {
  /** connected components */
  count: number
  /** components that wrap around the torus (cannot be unrolled flat) */
  spanning: number
  /** share of the phase's area in its largest component */
  largest: number
  /** median component area, texels */
  medianArea: number
  /** median elongation √(λmax / λmin) of the non-spanning components (1 = round; 0 = none) */
  elongation: number
}

export interface PatternStats {
  /** mean of V over the grid */
  meanV: number
  /** fraction of the grid with V > threshold */
  cover: number
  /** {V > threshold}, 8-connected, periodic */
  on: PhaseStats
  /** {V ≤ threshold}, 4-connected, periodic; its non-spanning components are holes in the pattern */
  off: PhaseStats
}

/** Topology and shape of {V > threshold} and of its complement on an N × N periodic grid. */
export function patternStats(v: ArrayLike<number>, N: number, threshold = 0.2): PatternStats {
  const n = N * N
  const label = new Int8Array(n) // 0 unvisited, 1 visited
  const stack = new Int32Array(n)
  const ox = new Int32Array(n) // unrolled coordinates of each visited texel
  const oy = new Int32Array(n)
  let meanV = 0
  let onArea = 0
  for (let p = 0; p < n; p++) {
    meanV += v[p]
    if (v[p] > threshold) onArea++
  }
  meanV /= n

  const acc = [
    { areas: [] as number[], elong: [] as number[], spanning: 0 },
    { areas: [] as number[], elong: [] as number[], spanning: 0 },
  ]
  for (let p0 = 0; p0 < n; p0++) {
    if (label[p0]) continue
    const fg = v[p0] > threshold
    const a = acc[fg ? 0 : 1]
    label[p0] = 1
    let top = 0
    stack[top++] = p0
    ox[p0] = p0 % N
    oy[p0] = Math.floor(p0 / N)
    let area = 0
    let sx = 0
    let sy = 0
    let sxx = 0
    let syy = 0
    let sxy = 0
    let wraps = false
    while (top > 0) {
      const p = stack[--top]
      const x = ox[p]
      const y = oy[p]
      area++
      sx += x
      sy += y
      sxx += x * x
      syy += y * y
      sxy += x * y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (!fg && dx !== 0 && dy !== 0) continue // the complement is 4-connected
          const qx = x + dx
          const qy = y + dy
          const q = (((qy % N) + N) % N) * N + (((qx % N) + N) % N)
          if (fg !== v[q] > threshold) continue
          if (label[q]) {
            // already in this component: at another unrolled position means it wraps
            if (ox[q] !== qx || oy[q] !== qy) wraps = true
            continue
          }
          label[q] = 1
          ox[q] = qx
          oy[q] = qy
          stack[top++] = q
        }
      }
    }
    a.areas.push(area)
    if (wraps) {
      a.spanning++
      continue
    }
    const mx = sx / area
    const my = sy / area
    const cxx = sxx / area - mx * mx + 1 / 12
    const cyy = syy / area - my * my + 1 / 12
    const cxy = sxy / area - mx * my
    const tr = cxx + cyy
    const disc = Math.sqrt(Math.max(0, ((cxx - cyy) / 2) ** 2 + cxy * cxy))
    a.elong.push(Math.sqrt((tr / 2 + disc) / Math.max(tr / 2 - disc, 1e-9)))
  }
  const phase = (i: number, total: number): PhaseStats => {
    const a = acc[i]
    return {
      count: a.areas.length,
      spanning: a.spanning,
      largest: a.areas.length ? Math.max(...a.areas) / Math.max(total, 1) : 0,
      medianArea: median(a.areas),
      elongation: median(a.elong),
    }
  }
  return { meanV, cover: onArea / n, on: phase(0, onArea), off: phase(1, n - onArea) }
}

/** RMS of a − b */
export function rmsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s / a.length)
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = xs.slice().sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : 0.5 * (s[h - 1] + s[h])
}
