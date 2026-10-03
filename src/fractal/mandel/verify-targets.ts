/**
 * Checks MANDEL_TARGETS:  pnpm tsx src/fractal/mandel/verify-targets.ts
 *
 * 1. Each centre is in the set: it survives 5000 iterations, or it is a Misiurewicz point (a
 *    boundary point whose orbit lands exactly on a repelling cycle; no numerical orbit near one
 *    survives long, so it is recognised by solving z_{q+p}(c) = z_q(c) instead).
 * 2. Each view shows structure: rendered on a 4 x 3 plane with a float32 port of the GPU
 *    iteration (shaders.ts: perturbation with rebasing), most pixels escape within the budget,
 *    and a good share of pixels sit on detail (a neighbour more than 2 iterations away, or on
 *    the other side of the boundary). A zoom into empty exterior shows smooth bands instead,
 *    where neighbours differ by a fraction of an iteration.
 * 3. The float32 GPU algorithm agrees with the same algorithm in doubles.
 *
 * Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import { computeReferenceOrbit, escapeTime, maxIterForScale, ORBIT_CAPACITY } from './orbit'
import { MANDEL_TARGETS } from './targets'
import type { MandelView } from '../types'

const PLANE_W = 4
const PLANE_H = 3
const PX_W = 120
const PX_H = 90
/** a pixel is on detail if a neighbour's escape count differs by more than this */
const DETAIL_STEP = 2
/** required share of detail pixels */
const MIN_DETAIL = 0.02

type C = [number, number]
const f32 = Math.fround

/** One sample of mandelIterationFrag, in float32 (`round` = Math.fround) or doubles. Returns mu, or -1. */
function iterate(dcx: number, dcy: number, Z: ArrayLike<number>, M: number, maxIter: number, round: (x: number) => number): number {
  let dx = 0
  let dy = 0
  let Zx = 0
  let Zy = 0
  let m = 0
  for (let n = 1; n <= maxIter; n++) {
    // d = (2Z + d) d + dc
    const ax = round(2 * Zx + dx)
    const ay = round(2 * Zy + dy)
    const nx = round(round(round(ax * dx) - round(ay * dy)) + dcx)
    dy = round(round(round(ax * dy) + round(ay * dx)) + dcy)
    dx = nx
    m++
    Zx = Z[2 * m]
    Zy = Z[2 * m + 1]
    const zx = round(Zx + dx)
    const zy = round(Zy + dy)
    const r2 = round(round(zx * zx) + round(zy * zy))
    if (r2 > 256) return n + 1 - Math.log2(0.5 * Math.log(r2))
    if (r2 < round(round(dx * dx) + round(dy * dy)) || m >= M) {
      dx = zx
      dy = zy
      m = 0
      Zx = 0
      Zy = 0
    }
  }
  return -1
}

function renderView(v: MandelView, float: boolean): Float64Array {
  const maxIter = maxIterForScale(v.scale)
  const Z = float ? new Float32Array(ORBIT_CAPACITY * 2) : new Float64Array(ORBIT_CAPACITY * 2)
  const M = computeReferenceOrbit(v.cx, v.cy, maxIter, Z)
  const round = float ? f32 : (x: number) => x
  const out = new Float64Array(PX_W * PX_H)
  for (let j = 0; j < PX_H; j++) {
    for (let i = 0; i < PX_W; i++) {
      const dcx = round(((i + 0.5) / PX_W - 0.5) * v.scale * PLANE_W)
      const dcy = round(((j + 0.5) / PX_H - 0.5) * v.scale * PLANE_H)
      out[j * PX_W + i] = iterate(dcx, dcy, Z, M, maxIter, round)
    }
  }
  return out
}

const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}

/**
 * If c's orbit passes within `tol` of a cycle of period p <= 8 by step 200, solve
 * z_{q+p}(c) = z_q(c) by Newton from c and check that the solution is a repelling landing.
 */
function misiurewicz(c: C): { q: number; p: number; point: C } | null {
  const orbit: C[] = [[0, 0]]
  let z: C = [0, 0]
  for (let n = 0; n < 220; n++) {
    const zz = mul(z, z)
    z = [zz[0] + c[0], zz[1] + c[1]]
    orbit.push(z)
  }
  for (let q = 2; q <= 200; q++) {
    for (let p = 1; p <= 8; p++) {
      const a = orbit[q]
      const b = orbit[q + p]
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-10) continue
      let x: C = [c[0], c[1]]
      for (let it = 0; it < 60; it++) {
        let w: C = [0, 0]
        let d: C = [0, 0]
        let wq: C = [0, 0]
        let dq: C = [0, 0]
        for (let n = 1; n <= q + p; n++) {
          const wd = mul(w, d)
          d = [2 * wd[0] + 1, 2 * wd[1]]
          const ww = mul(w, w)
          w = [ww[0] + x[0], ww[1] + x[1]]
          if (n === q) {
            wq = w
            dq = d
          }
        }
        const s = div([w[0] - wq[0], w[1] - wq[1]], [d[0] - dq[0], d[1] - dq[1]])
        x = [x[0] - s[0], x[1] - s[1]]
        if (Math.hypot(s[0], s[1]) < 1e-20) break
      }
      // the landing cycle must repel: |prod 2 z_k| over one period > 1
      let lam: C = [1, 0]
      let y: C = [0, 0]
      for (let n = 1; n <= q + p; n++) {
        const yy = mul(y, y)
        y = [yy[0] + x[0], yy[1] + x[1]]
        if (n > q) lam = mul(lam, [2 * y[0], 2 * y[1]])
      }
      if (Math.hypot(lam[0], lam[1]) > 1) return { q, p, point: x }
    }
  }
  return null
}

/** Share of pixels with a 4-neighbour across the boundary or more than DETAIL_STEP iterations away. */
function detailFraction(mu: Float64Array): number {
  let n = 0
  for (let j = 0; j < PX_H; j++) {
    for (let i = 0; i < PX_W; i++) {
      const a = mu[j * PX_W + i]
      const differs = (b: number) => a < 0 !== b < 0 || (a >= 0 && Math.abs(a - b) > DETAIL_STEP)
      if (
        (i > 0 && differs(mu[j * PX_W + i - 1])) ||
        (i < PX_W - 1 && differs(mu[j * PX_W + i + 1])) ||
        (j > 0 && differs(mu[(j - 1) * PX_W + i])) ||
        (j < PX_H - 1 && differs(mu[(j + 1) * PX_W + i]))
      ) {
        n++
      }
    }
  }
  return n / mu.length
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
}

let failed = false
const rows: Record<string, string | number>[] = []
for (const [name, view] of Object.entries(MANDEL_TARGETS) as [string, MandelView][]) {
  const problems: string[] = []

  // 1. membership
  let membership: string
  if (escapeTime(view.cx, view.cy, 5000) < 0) {
    membership = 'inside (5000 it.)'
  } else {
    const m = misiurewicz([view.cx, view.cy])
    const off = m ? Math.hypot(m.point[0] - view.cx, m.point[1] - view.cy) : Infinity
    const pixel = (view.scale * PLANE_W) / 2000
    if (m && off < pixel) {
      membership = `Misiurewicz M(${m.q},${m.p}), ${off.toExponential(1)} away`
    } else {
      membership = `escapes at ${escapeTime(view.cx, view.cy, 5000)}`
      problems.push('centre is not in the set')
    }
  }

  // 2 + 3. structure, and float32 vs double
  const f = renderView(view, true)
  const d = renderView(view, false)
  const escaped: number[] = []
  let mismatch = 0
  for (let k = 0; k < f.length; k++) {
    if (f[k] >= 0) escaped.push(f[k])
    if (f[k] < 0 !== d[k] < 0) mismatch++
  }
  escaped.sort((a, b) => a - b)
  const escapedFrac = escaped.length / f.length
  const detail = detailFraction(f)
  const mismatchFrac = mismatch / f.length
  // the copies are framed whole, so their interior is a large part of the view by design
  if (escapedFrac < 0.5) problems.push('most of the view does not escape')
  if (detail < MIN_DETAIL) problems.push('no detail: smooth bands only')
  if (mismatchFrac > 0.01) problems.push('float32 and double disagree on > 1% of pixels')

  if (problems.length) failed = true
  rows.push({
    target: name,
    centre: membership,
    maxIter: maxIterForScale(view.scale),
    escaped: `${(100 * escapedFrac).toFixed(1)}%`,
    'iterations p5..p95': escaped.length ? `${Math.round(quantile(escaped, 0.05))}..${Math.round(quantile(escaped, 0.95))}` : '-',
    detail: `${(100 * detail).toFixed(1)}%`,
    'f32 vs f64': `${(100 * mismatchFrac).toFixed(2)}%`,
    result: problems.length ? `FAIL: ${problems.join('; ')}` : 'ok',
  })
}
console.table(rows)
if (failed) process.exitCode = 1
