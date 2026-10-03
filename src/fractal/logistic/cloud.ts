import { FEIGENBAUM_POINT, R_MAX, R_MIN, logistic } from './math'

/**
 * Builds the bifurcation diagram as a point cloud, once, on the CPU (normally inside a worker;
 * see cloudLoader.ts).
 *
 * Columns: 2400 evenly spaced columns of r cover the overview. That is about 1 column per pixel
 * for the whole diagram, but only 35 across `cascadeFrame(3)` and 7 across `cascadeFrame(4)`,
 * so near the Feigenbaum point r∞ the columns get denser, with spacing proportional to |r − r∞|
 * (every cascade frame then gets about the same number of columns, ≥ 1 per pixel at 1200 px).
 * Left of r∞ the orbits are periodic and cost only a few points per column (see below), so
 * that side is made 3× denser than the chaotic side.
 *
 * Orbits: each column iterates 400 transient steps, then records 400 points. x is carried over
 * from the previous column instead of restarting at 0.5. The logistic map has at most one
 * attractor, so this is safe, and it starts every column next to its attractor, which removes
 * most of the slow-convergence smear near the doublings at deep zoom.
 *
 * Repeats: a period-p orbit records the same p values 400/p times. Stacking 200 identical points
 * would blow a period-2 branch out to white, so periodic columns are collapsed to one point per
 * distinct value, carrying a weight that grows with log(multiplicity). Columns with more than
 * MAX_RUNS distinct values are treated as chaotic and keep all 400 points. Below r∞ there is no
 * chaos, only orbits still converging (slowly, right at a doubling, where the multiplier is −1),
 * so such columns iterate further, and whatever remains unconverged is still drawn as a line.
 *
 * Packing, three floats per point (the `position` attribute):
 *   u = (r − 2.5) / 1.5 ∈ [0, 1]   (the vertex shader maps it to either layout)
 *   xₙ ∈ [0, 1]
 *   w = brightness weight × (column spacing / base spacing); the sign marks the kind of point:
 *       w > 0 a chaotic point (its density also depends on vertical zoom),
 *       w < 0 a collapsed periodic point (a line, which does not).
 * r is jittered by up to ± half a column so the columns don't form a regular grid that bands
 * against the pixel grid.
 */

export interface BifurcationCloud {
  /** (u, xₙ, w) per point; see above */
  positions: Float32Array<ArrayBuffer>
  count: number
  columns: number
}

/** columns across the whole r range at the base (overview) density */
export const BASE_COLUMNS = 2400
export const BASE_SPACING = (R_MAX - R_MIN) / BASE_COLUMNS
const TRANSIENT = 400
const RECORD = 400

/** spacing = β·|r − r∞| near the cascade, capped at the base spacing */
const BETA_PERIODIC = 0.001
const BETA_CHAOTIC = 0.0033
/** below this distance from r∞ the spacing stops shrinking (enough for cascadeFrame(4)) */
const DETAIL_FLOOR = 0.0012

/** a column with at most this many distinct values is drawn as a periodic orbit */
const MAX_RUNS = 160
/** below r∞, an unconverged column iterates up to this many more rounds of RECORD·5 steps */
const CONVERGE_ROUNDS = 12
/** values closer than this fraction of the column width (in r) count as the same point */
const MERGE = 0.25
/** brightness of a collapsed point = 1 + K·log2(multiplicity): branches read as lines, not blobs */
const MULTIPLICITY_LOG_GAIN = 0.5

function columnSpacing(r: number): number {
  const d = Math.max(Math.abs(r - FEIGENBAUM_POINT), DETAIL_FLOOR)
  return Math.min(BASE_SPACING, (r < FEIGENBAUM_POINT ? BETA_PERIODIC : BETA_CHAOTIC) * d)
}

/** small deterministic PRNG so the diagram (and its jitter) is identical on every load */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildBifurcationCloud(seed = 1): BifurcationCloud {
  const rand = mulberry32(seed)
  const invSpan = 1 / (R_MAX - R_MIN)
  let capacity = 1 << 20
  let out = new Float32Array(capacity * 3)
  let count = 0
  const push = (r: number, x: number, w: number) => {
    if (count === capacity) {
      capacity *= 2
      const grown = new Float32Array(capacity * 3)
      grown.set(out)
      out = grown
    }
    const o = count * 3
    out[o] = (r - R_MIN) * invSpan
    out[o + 1] = x
    out[o + 2] = w
    count++
  }

  const orbit = new Float64Array(RECORD)
  const sorted = new Float64Array(RECORD)
  let x = 0.5
  let r = R_MIN
  let columns = 0

  /** record RECORD iterates into `orbit`, sorted copy into `sorted`; returns the number of distinct values (capped) */
  const recordAndCount = (rc: number, eps: number): number => {
    for (let i = 0; i < RECORD; i++) {
      x = logistic(rc, x)
      if (!(x > 0 && x < 1)) x = 0.5
      orbit[i] = x
    }
    sorted.set(orbit)
    sorted.sort()
    let runs = 0
    for (let i = 0; i < RECORD && runs <= MAX_RUNS; ) {
      let j = i + 1
      while (j < RECORD && sorted[j] - sorted[i] <= eps) j++
      runs++
      i = j
    }
    return runs
  }

  while (r < R_MAX) {
    let d = columnSpacing(r)
    if (r + d > R_MAX) d = R_MAX - r
    if (d < 1e-9) break
    const rc = r + d / 2

    for (let i = 0; i < TRANSIENT; i++) {
      x = logistic(rc, x)
      if (!(x > 0 && x < 1)) x = 0.5 // guards against float collapse onto 0 or 1
    }
    const eps = MERGE * d
    let runs = recordAndCount(rc, eps)
    // below r∞ every attractor is a cycle; give slow columns (near a doubling) more time
    for (let round = 0; round < CONVERGE_ROUNDS && runs > MAX_RUNS && rc < FEIGENBAUM_POINT; round++) {
      for (let i = 0; i < RECORD * 5; i++) {
        x = logistic(rc, x)
        if (!(x > 0 && x < 1)) x = 0.5
      }
      runs = recordAndCount(rc, eps)
    }

    const spacingRatio = d / BASE_SPACING
    if (runs <= MAX_RUNS || rc < FEIGENBAUM_POINT) {
      // periodic (or converging onto a cycle): one point per distinct value, at the run's mean
      for (let i = 0; i < RECORD; ) {
        let j = i + 1
        let sum = sorted[i]
        while (j < RECORD && sorted[j] - sorted[i] <= eps) sum += sorted[j++]
        const weight = 1 + MULTIPLICITY_LOG_GAIN * Math.log2(j - i)
        push(rc + (rand() - 0.5) * d, sum / (j - i), -weight * spacingRatio)
        i = j
      }
    } else {
      for (let i = 0; i < RECORD; i++) push(rc + (rand() - 0.5) * d, orbit[i], spacingRatio)
    }

    columns++
    r += d
  }

  return { positions: out.slice(0, count * 3), count, columns }
}
