/**
 * Catalog audit. For every system in SYSTEMS (default params) it integrates a long RK4
 * trajectory from `seed`, measures the attractor, and checks the constants the renderer
 * relies on: frame, seed, bound, speedNorm, fixedPoints, plus GLSL/JS parity and slider
 * ranges. It also prints suggested constants derived from the measurement.
 *
 *   pnpm measure                 all systems
 *   pnpm measure chua thomas     only these ids
 *
 * Exits with code 1 if any check FAILs. WARN lines are informational.
 */
import { SYSTEMS, defaultParams } from '../src/systems'
import { rk4Step } from '../src/sim/cpu'
import type { AttractorSystem, Vec3 } from '../src/types'

const proc = (globalThis as unknown as { process: { argv: string[]; exitCode?: number } }).process

const EXPECTED_ORDER = [
  'lorenz', 'rossler', 'thomas', 'aizawa', 'halvorsen', 'chen', 'dadras',
  'fourwing', 'sprottB', 'burkeShaw', 'arneodo', 'chua', 'lorenz84',
]

const TRANSIENT_TIME = 200 // time units discarded before recording (spec: at least 100)
const RECORD_STEPS = 400_000
const VIEW_RADIUS = 1.25 // (b) every framed sample within this radius
const MIN_HALF_EXTENT = 0.55 // (b) largest framed half-extent at least this
const SUGGEST_RADIUS = 1.2 // suggested scale keeps every sample within this framed radius (margin under VIEW_RADIUS)
const ENSEMBLE_RUNS = 4 // extra RECORD_STEPS runs whose union is checked for (b), (c) and used for suggestions
const BOUND_FACTOR = 2.5 // (c) bound >= factor * max distance from frame centre
const SPEED_TOL = 0.3 // (d) speedNorm within this fraction of p95
const SEED_HORIZON = 1 // (e) time units the seed is followed
const SEED_BBOX_TOL = 0.01 // (e) bbox slack, as a fraction of the largest extent (seed is rounded to 4 dp)
const OCC_GRID = 40 // (e) occupancy grid cells per axis for the "near the attractor" test
const FIXED_TOL = 1e-6 // (f)
const PARITY_POINTS = 200
const PARITY_TOL = 1e-9
const STEPS_PER_SEC = [100, 400] // aim for rate/dt in this band
const SWEEP_STEPS = 60_000
const SWEEP_VIEW_WARN = 1.6 // framed radius beyond which a slider setting is flagged as leaving the view
const CHAOS_LAMBDA = 0.01 // largest Lyapunov exponent above this counts as chaotic
const BASIN_STARTS = 100
const BASIN_TIME = 50

// ---------------------------------------------------------------------------------------------
// small utilities

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

function fmt(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return String(x)
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(2)
  return x.toFixed(digits)
}
const fv = (v: ArrayLike<number>, d = 3) => `(${fmt(v[0], d)}, ${fmt(v[1], d)}, ${fmt(v[2], d)})`
const round = (x: number, d: number) => Number(x.toFixed(d))
/** round up to 2 significant figures */
const ceil2 = (x: number) => {
  const e = Math.pow(10, Math.floor(Math.log10(x)) - 1)
  return Number((Math.ceil(x / e) * e).toPrecision(2))
}
/** round to 2 significant figures */
const sig2 = (x: number) => Number(x.toPrecision(2))

function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[i]
}

let failCount = 0
let warnCount = 0
const failedIds = new Set<string>()
const warnedIds = new Set<string>()

function report(id: string, ok: boolean, label: string, detail: string, warnOnly = false): void {
  const tag = ok ? 'PASS' : warnOnly ? 'WARN' : 'FAIL'
  if (!ok) {
    if (warnOnly) {
      warnCount++
      warnedIds.add(id)
    } else {
      failCount++
      failedIds.add(id)
    }
  }
  console.log(`  ${tag}  ${label.padEnd(26)} ${detail}`)
}
const info = (label: string, detail: string) => console.log(`        ${label.padEnd(26)} ${detail}`)

// ---------------------------------------------------------------------------------------------
// integration

interface Trace {
  ok: boolean
  why: string
  n: number
  pos: Float64Array | null
  speeds: Float64Array
  min: Vec3
  max: Vec3
  sum: Vec3
  maxDist: number
  lyap: number
}

/**
 * Integrate from seed(P): discard `transientTime`, then record `steps` samples while
 * tracking a shadow trajectory for the largest Lyapunov exponent. Escape = non-finite or
 * farther than bound(P) from frame(P).center (what the app treats as an escape).
 */
function run(
  sys: AttractorSystem,
  P: number[],
  steps: number,
  keepPos: boolean,
  transientTime = TRANSIENT_TIME,
  start: ArrayLike<number> = sys.seed(P),
): Trace {
  const dt = sys.dt
  const { center: c, scale } = sys.frame(P)
  const b2 = sys.bound(P) ** 2
  const p = new Float64Array(start)
  const d = new Float64Array(3)
  const tr: Trace = {
    ok: true, why: '', n: 0, pos: keepPos ? new Float64Array(steps * 3) : null,
    speeds: new Float64Array(steps), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
    sum: [0, 0, 0], maxDist: 0, lyap: NaN,
  }
  const dist2 = () => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
  const escaped = (r2: number, t: number) => {
    if (Number.isFinite(r2) && r2 <= b2) return false
    tr.ok = false
    tr.why = `${Number.isFinite(r2) ? 'left bound' : 'non-finite'} at t=${fmt(t, 2)}`
    return true
  }
  const transient = Math.ceil(transientTime / dt)
  for (let i = 0; i < transient; i++) {
    rk4Step(sys, p, P, dt)
    if (escaped(dist2(), (i + 1) * dt)) return tr
  }
  const d0 = 1e-8 / scale
  const q = new Float64Array([p[0] + d0 / Math.SQRT2, p[1] + d0 / Math.SQRT2, p[2]])
  let lsum = 0
  for (let i = 0; i < steps; i++) {
    rk4Step(sys, p, P, dt)
    rk4Step(sys, q, P, dt)
    const r2 = dist2()
    if (escaped(r2, transientTime + (i + 1) * dt)) break
    if (tr.pos) {
      tr.pos[i * 3] = p[0]
      tr.pos[i * 3 + 1] = p[1]
      tr.pos[i * 3 + 2] = p[2]
    }
    sys.f(d, p[0], p[1], p[2], P)
    tr.speeds[i] = Math.hypot(d[0], d[1], d[2])
    for (let k = 0; k < 3; k++) {
      if (p[k] < tr.min[k]) tr.min[k] = p[k]
      if (p[k] > tr.max[k]) tr.max[k] = p[k]
      tr.sum[k] += p[k]
    }
    if (r2 > tr.maxDist) tr.maxDist = r2
    tr.n = i + 1
    if ((i + 1) % 10 === 0) {
      let sep = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
      if (!Number.isFinite(sep)) sep = 1e300
      sep = Math.max(sep, 1e-300)
      lsum += Math.log(sep / d0)
      for (let k = 0; k < 3; k++) q[k] = p[k] + (q[k] - p[k]) * (d0 / sep)
    }
  }
  tr.maxDist = Math.sqrt(tr.maxDist)
  tr.speeds = tr.speeds.slice(0, tr.n).sort()
  tr.lyap = lsum / (Math.floor(tr.n / 10) * 10 * dt)
  return tr
}

// ---------------------------------------------------------------------------------------------
// GLSL: lint for GLSL ES 1.0 pitfalls, and a tiny GLSL -> JS translator for the parity check

const GLSL_FORM = /^\s*d\s*=\s*vec3\(([\s\S]*)\)\s*;\s*$/
const GLSL_FUNCS = ['sin', 'cos', 'abs']

function lintGlsl(src: string, nParams: number): string[] {
  const issues: string[] = []
  if (!GLSL_FORM.test(src)) issues.push('not a single `d = vec3(...);` statement')
  if (/[^\w\s.+\-*/(),;=[\]]/.test(src)) issues.push('unexpected character')
  for (const m of src.matchAll(/P\[(\d+)\]/g)) if (+m[1] >= nParams) issues.push(`P[${m[1]}] but only ${nParams} params`)
  let s = src.replace(/P\[\d+\]/g, ' P ').replace(/\bv\.[xyz]\b/g, ' v ')
  if (/\bv\s*\./.test(s)) issues.push('swizzle other than v.x/v.y/v.z')
  const num = /(?<![\w.])(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/g
  for (const m of s.matchAll(num)) if (!/[.eE]/.test(m[0])) issues.push(`int literal ${m[0]} (no implicit int->float in GLSL ES 1.0)`)
  s = s.replace(num, ' 0 ')
  for (const m of s.matchAll(/[A-Za-z_]\w*/g)) {
    if (m[0] === 'pow') issues.push('pow() is undefined for negative bases')
    else if (!['d', 'vec3', 'P', 'v', ...GLSL_FUNCS].includes(m[0])) issues.push(`identifier '${m[0]}'`)
  }
  return issues
}

type Deriv = (x: number, y: number, z: number, P: number[]) => number[]

function glslToJs(src: string): Deriv {
  const m = GLSL_FORM.exec(src)
  if (!m) throw new Error('glsl is not of the form d = vec3(...);')
  const body = m[1]
    .replace(/\bv\.([xyz])\b/g, '$1')
    .replace(new RegExp(`\\b(${GLSL_FUNCS.join('|')})\\s*\\(`, 'g'), 'Math.$1(')
  return new Function('x', 'y', 'z', 'P', `"use strict"; return [${body}];`) as Deriv
}

// ---------------------------------------------------------------------------------------------
// equilibria: multi-start Newton with a numerical Jacobian

function solve3(J: number[][], b: number[]): number[] | null {
  const A = J.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-14) return null
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r = c + 1; r < 3; r++) {
      const k = A[r][c] / A[c][c]
      for (let j = c; j < 4; j++) A[r][j] -= k * A[c][j]
    }
  }
  const x = [0, 0, 0]
  for (let r = 2; r >= 0; r--) {
    let s = A[r][3]
    for (let j = r + 1; j < 3; j++) s -= A[r][j] * x[j]
    x[r] = s / A[r][r]
  }
  return x
}

function findEquilibria(sys: AttractorSystem, P: number[], lo: Vec3, hi: Vec3, size: number, rng: () => number): Vec3[] {
  const f0 = new Float64Array(3)
  const fp = new Float64Array(3)
  const fm = new Float64Array(3)
  const h = 1e-7 * size
  const roots: Vec3[] = []
  const inRegion = (x: number[]) => x.every((v, k) => v >= lo[k] && v <= hi[k])
  for (let s = 0; s < 400; s++) {
    const x = [0, 1, 2].map((k) => lo[k] + rng() * (hi[k] - lo[k]))
    let converged = false
    for (let it = 0; it < 100; it++) {
      sys.f(f0, x[0], x[1], x[2], P)
      if (Math.hypot(f0[0], f0[1], f0[2]) < 1e-11) {
        converged = true
        break
      }
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
      for (let k = 0; k < 3; k++) {
        const a = [...x]
        const b = [...x]
        a[k] += h
        b[k] -= h
        sys.f(fp, a[0], a[1], a[2], P)
        sys.f(fm, b[0], b[1], b[2], P)
        for (let r = 0; r < 3; r++) J[r][k] = (fp[r] - fm[r]) / (2 * h)
      }
      const dx = solve3(J, [-f0[0], -f0[1], -f0[2]])
      if (!dx) break
      const n = Math.hypot(dx[0], dx[1], dx[2])
      const lim = 0.25 * size
      const k = n > lim ? lim / n : 1
      for (let j = 0; j < 3; j++) x[j] += k * dx[j]
      if (!x.every(Number.isFinite) || Math.hypot(x[0], x[1], x[2]) > 1e3 * size) break
    }
    if (!converged || !inRegion(x)) continue
    if (!roots.some((r) => Math.hypot(r[0] - x[0], r[1] - x[1], r[2] - x[2]) < 1e-5 * size)) roots.push([x[0], x[1], x[2]])
  }
  return roots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
}

// ---------------------------------------------------------------------------------------------
// per-system audit

interface Row {
  id: string
  dt: number
  rate: number
  ext: Vec3
  scale: number
  p95: number
  norm: number
  lyap: number
}
const rows: Row[] = []

function audit(sys: AttractorSystem, index: number): void {
  const P = defaultParams(sys)
  const id = sys.id
  const rng = mulberry32(0x5eed + index)
  console.log(`\n[${index}] ${id}: ${sys.name} (${sys.year}, ${sys.credit})  P = [${P.map((v) => fmt(v, 4)).join(', ')}]`)

  // metadata
  const meta: string[] = []
  if (EXPECTED_ORDER[index] !== id) meta.push(`expected '${EXPECTED_ORDER[index]}' at index ${index}`)
  if (sys.params.length > 8) meta.push('more than 8 params')
  if (new Set(sys.params.map((p) => p.key)).size !== sys.params.length) meta.push('duplicate param keys')
  for (const p of sys.params) {
    if (!(p.min < p.max && p.min <= p.default && p.default <= p.max)) meta.push(`param ${p.key}: bad min/default/max`)
    if (p.step !== undefined && !(p.step > 0 && p.step <= (p.max - p.min) / 20)) meta.push(`param ${p.key}: step ${p.step} too coarse`)
  }
  if (sys.tagline.length >= 60) meta.push(`tagline is ${sys.tagline.length} chars`)
  if (!(sys.dt > 0 && sys.rate > 0)) meta.push('dt/rate must be positive')
  report(id, meta.length === 0, 'metadata', meta.join('; ') || `${sys.params.length} params, tagline ${sys.tagline.length} chars`)
  const sps = sys.rate / sys.dt
  report(id, sps >= STEPS_PER_SEC[0] && sps <= STEPS_PER_SEC[1], 'steps per real second', `rate/dt = ${fmt(sys.rate, 3)}/${sys.dt} = ${fmt(sps, 0)} (aim ${STEPS_PER_SEC.join('-')})`, true)

  // GLSL lint
  const lint = lintGlsl(sys.glsl, sys.params.length)
  report(id, lint.length === 0, 'GLSL ES 1.0 lint', lint.join('; ') || 'single vec3 assignment, float literals, no pow')

  // main measurement
  const t0 = performance.now()
  const tr = run(sys, P, RECORD_STEPS, true)
  const ms = performance.now() - t0
  const { center: c, scale } = sys.frame(P)
  const bound = sys.bound(P)
  const ext: Vec3 = [tr.max[0] - tr.min[0], tr.max[1] - tr.min[1], tr.max[2] - tr.min[2]]
  const maxExt = Math.max(...ext)
  const mid: Vec3 = [(tr.max[0] + tr.min[0]) / 2, (tr.max[1] + tr.min[1]) / 2, (tr.max[2] + tr.min[2]) / 2]
  const cen: Vec3 = [tr.sum[0] / tr.n, tr.sum[1] / tr.n, tr.sum[2] / tr.n]
  const p50 = percentile(tr.speeds, 0.5)
  const p95 = percentile(tr.speeds, 0.95)
  const p99 = percentile(tr.speeds, 0.99)
  info('run', `${tr.n} steps (${fmt(tr.n * sys.dt, 0)} t) after ${TRANSIENT_TIME} t transient, ${fmt(ms, 0)} ms`)
  info('bbox', `x [${fmt(tr.min[0])}, ${fmt(tr.max[0])}]  y [${fmt(tr.min[1])}, ${fmt(tr.max[1])}]  z [${fmt(tr.min[2])}, ${fmt(tr.max[2])}]  extent ${fv(ext)}`)
  info('centroid / bbox centre', `${fv(cen)} / ${fv(mid)}`)
  info('max dist from frame ctr', `${fmt(tr.maxDist)} (frame centre ${fv(c)}, scale ${fmt(scale, 5)})`)
  info('speed', `p50 ${fmt(p50)}  p95 ${fmt(p95)}  p99 ${fmt(p99)}  max ${fmt(tr.speeds[tr.n - 1])}`)
  report(id, tr.lyap > CHAOS_LAMBDA, 'chaotic at defaults', `largest Lyapunov exponent ${fmt(tr.lyap, 4)} per time unit`)

  // (a)
  report(id, tr.ok && tr.n === RECORD_STEPS, '(a) finite, no escape', tr.ok ? `all ${tr.n} samples finite and inside bound ${fmt(bound)}` : tr.why)
  if (tr.n < 1000) {
    console.log('  (too few samples to continue)')
    return
  }
  const pos = tr.pos!

  // Ensemble: ENSEMBLE_RUNS more trajectories started from points spread along the main run. Some
  // attractors (Sprott B, Dadras, ...) reach their extremes only rarely; the GPU swarm visits those
  // extremes constantly, so (b) and (c) must also hold for the union, and suggestions come from it.
  const uMin: Vec3 = [...tr.min]
  const uMax: Vec3 = [...tr.max]
  let uMaxDist = tr.maxDist
  const p95s = [p95]
  let ensWhy = ''
  for (let k = 1; k <= ENSEMBLE_RUNS; k++) {
    const i = Math.floor((k * tr.n) / (ENSEMBLE_RUNS + 1))
    const start = [pos[i * 3] + 1e-6 / scale, pos[i * 3 + 1], pos[i * 3 + 2]]
    const e = run(sys, P, RECORD_STEPS, false, 0, start)
    if (!e.ok) ensWhy ||= `run ${k}: ${e.why}`
    for (let j = 0; j < 3; j++) {
      uMin[j] = Math.min(uMin[j], e.min[j])
      uMax[j] = Math.max(uMax[j], e.max[j])
    }
    uMaxDist = Math.max(uMaxDist, e.maxDist)
    p95s.push(percentile(e.speeds, 0.95))
  }
  const uExt: Vec3 = [uMax[0] - uMin[0], uMax[1] - uMin[1], uMax[2] - uMin[2]]
  const uMid: Vec3 = [(uMax[0] + uMin[0]) / 2, (uMax[1] + uMin[1]) / 2, (uMax[2] + uMin[2]) / 2]
  p95s.sort((x, y) => x - y)
  info('ensemble', `${ENSEMBLE_RUNS + 1} x ${RECORD_STEPS} steps: bbox x [${fmt(uMin[0])}, ${fmt(uMax[0])}]  y [${fmt(uMin[1])}, ${fmt(uMax[1])}]  z [${fmt(uMin[2])}, ${fmt(uMax[2])}], p95 ${fmt(p95s[0])}..${fmt(p95s[p95s.length - 1])}`)
  report(id, !ensWhy, '(a) ensemble no escape', ensWhy || `${ENSEMBLE_RUNS} more runs finite and inside bound`)

  // (b)
  let maxR = 0
  for (let i = 0; i < tr.n; i++) {
    const r = Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]) * scale
    if (r > maxR) maxR = r
  }
  const halfExt = (maxExt / 2) * scale
  const uR = uMaxDist * scale
  report(id, maxR <= VIEW_RADIUS && uR <= VIEW_RADIUS && halfExt >= MIN_HALF_EXTENT, '(b) framing', `max framed radius ${fmt(maxR)} (ensemble ${fmt(uR)}) <= ${VIEW_RADIUS}, largest framed half-extent ${fmt(halfExt)} >= ${MIN_HALF_EXTENT}`)

  // (c)
  report(id, bound >= BOUND_FACTOR * uMaxDist, '(c) bound', `bound ${fmt(bound)} = ${fmt(bound / tr.maxDist, 2)}x max dist ${fmt(tr.maxDist)} (ensemble ${fmt(bound / uMaxDist, 2)}x), >= ${BOUND_FACTOR}x`)

  // (d)
  const norm = sys.speedNorm(P)
  report(id, Math.abs(norm / p95 - 1) <= SPEED_TOL, '(d) speedNorm', `${fmt(norm)} vs p95 ${fmt(p95)} (${norm >= p95 ? '+' : ''}${fmt((norm / p95 - 1) * 100, 1)}%, limit ±${SPEED_TOL * 100}%)`)

  // (e) seed: bbox containment (spec) and occupancy-grid proximity (stricter: catches seeds in holes)
  const occ = new Uint8Array(OCC_GRID ** 3)
  const cell = (x: number, k: number) => Math.min(OCC_GRID - 1, Math.max(0, Math.floor(((x - tr.min[k]) / (ext[k] || 1)) * OCC_GRID)))
  for (let i = 0; i < tr.n; i++) occ[(cell(pos[i * 3], 0) * OCC_GRID + cell(pos[i * 3 + 1], 1)) * OCC_GRID + cell(pos[i * 3 + 2], 2)] = 1
  const near = (x: number, y: number, z: number) => {
    const cx = cell(x, 0), cy = cell(y, 1), cz = cell(z, 2)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let e = -1; e <= 1; e++) {
          const i = cx + a, j = cy + b, k = cz + e
          if (i < 0 || j < 0 || k < 0 || i >= OCC_GRID || j >= OCC_GRID || k >= OCC_GRID) continue
          if (occ[(i * OCC_GRID + j) * OCC_GRID + k]) return true
        }
    return false
  }
  const seed = sys.seed(P)
  const sp = new Float64Array(seed)
  const tol = SEED_BBOX_TOL * maxExt
  let inBox = true
  let nearAll = true
  for (let i = 0; i <= Math.round(SEED_HORIZON / sys.dt); i++) {
    if (i > 0) rk4Step(sys, sp, P, sys.dt)
    for (let k = 0; k < 3; k++) if (!(sp[k] >= tr.min[k] - tol && sp[k] <= tr.max[k] + tol)) inBox = false
    if (!near(sp[0], sp[1], sp[2])) nearAll = false
  }
  report(id, inBox && nearAll, '(e) seed on attractor', `seed ${fv(seed, 4)}: ${SEED_HORIZON} t path ${inBox ? 'inside' : 'LEAVES'} bbox (±${SEED_BBOX_TOL * 100}% slack), ${nearAll ? 'stays within' : 'STRAYS from'} occupied ${OCC_GRID}^3 cells`)

  // (f) fixed points, and completeness vs a Newton search in the bbox expanded by 50%
  const lo: Vec3 = [tr.min[0] - ext[0] / 2, tr.min[1] - ext[1] / 2, tr.min[2] - ext[2] / 2]
  const hi: Vec3 = [tr.max[0] + ext[0] / 2, tr.max[1] + ext[1] / 2, tr.max[2] + ext[2] / 2]
  const found = findEquilibria(sys, P, lo, hi, maxExt, rng)
  if (sys.fixedPoints) {
    const fps = sys.fixedPoints(P)
    const d = new Float64Array(3)
    let worst = 0
    for (const q of fps) {
      sys.f(d, q[0], q[1], q[2], P)
      worst = Math.max(worst, Math.hypot(d[0], d[1], d[2]))
    }
    report(id, worst < FIXED_TOL, '(f) fixed points', `${fps.length} listed, max |f| = ${worst.toExponential(1)} (< ${FIXED_TOL})`)
    const missing = found.filter((r) => !fps.some((q) => Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) < 1e-5 * maxExt))
    report(id, missing.length === 0, '(f) fixed points complete', missing.length ? `Newton found unlisted: ${missing.map((m) => fv(m)).join(' ')}` : `Newton search found ${found.length} in view region, all listed`, true)
  } else {
    info('(f) fixed points', `none listed; Newton search found ${found.length} in view region${found.length && found.length <= 6 ? ': ' + found.map((m) => fv(m)).join(' ') : ''}`)
  }

  // GLSL vs JS parity, at default params and at random params inside the slider ranges
  let parityWorst = 0
  let parityErr = ''
  try {
    const g = glslToJs(sys.glsl)
    const out = new Float64Array(3)
    for (let i = 0; i < 2 * PARITY_POINTS; i++) {
      const Pi = i < PARITY_POINTS ? P : sys.params.map((p) => p.min + rng() * (p.max - p.min))
      const x = tr.min[0] + rng() * ext[0], y = tr.min[1] + rng() * ext[1], z = tr.min[2] + rng() * ext[2]
      out.fill(NaN)
      sys.f(out, x, y, z, Pi)
      const gv = g(x, y, z, Pi)
      if (gv.length !== 3) throw new Error(`glsl produced ${gv.length} components`)
      const n = Math.hypot(out[0], out[1], out[2])
      for (let k = 0; k < 3; k++) {
        const rel = Math.abs(gv[k] - out[k]) / Math.max(Math.abs(out[k]), n, 1e-300)
        if (!(rel <= parityWorst)) parityWorst = Number.isFinite(rel) ? rel : Infinity
      }
    }
  } catch (e) {
    parityErr = (e as Error).message
  }
  report(id, !parityErr && parityWorst <= PARITY_TOL, 'GLSL == JS', parityErr || `${2 * PARITY_POINTS} points (half at random params), worst relative diff ${parityWorst.toExponential(1)}`)

  // RK4 accuracy at this dt: one step vs two half steps, at points along the attractor
  const a = new Float64Array(3), b = new Float64Array(3)
  const errs: number[] = []
  for (let i = 0; i < tr.n; i += Math.floor(tr.n / 4000)) {
    a.set(pos.subarray(i * 3, i * 3 + 3))
    b.set(a)
    rk4Step(sys, a, P, sys.dt)
    rk4Step(sys, b, P, sys.dt / 2)
    rk4Step(sys, b, P, sys.dt / 2)
    errs.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / sys.dt / (maxExt / 2))
  }
  errs.sort((x, y) => x - y)
  info('rk4 accuracy', `local error per time unit / half-extent: p99 ${errs[Math.floor(errs.length * 0.99)].toExponential(1)}, max ${errs[errs.length - 1].toExponential(1)}; p99 step = ${fmt((100 * p99 * sys.dt) / (maxExt / 2), 2)}% of half-extent`)

  // basin: random starts in the bbox; how many leave bound within BASIN_TIME
  let esc = 0
  const bp = new Float64Array(3)
  for (let s = 0; s < BASIN_STARTS; s++) {
    for (let k = 0; k < 3; k++) bp[k] = tr.min[k] + rng() * ext[k]
    for (let i = 0; i < Math.ceil(BASIN_TIME / sys.dt); i++) {
      rk4Step(sys, bp, P, sys.dt)
      const r2 = (bp[0] - c[0]) ** 2 + (bp[1] - c[1]) ** 2 + (bp[2] - c[2]) ** 2
      if (!(r2 <= bound * bound)) {
        esc++
        break
      }
    }
  }
  info('basin', `${esc}/${BASIN_STARTS} uniform random starts in the bbox leave bound within ${BASIN_TIME} t`)

  // Suggested constants, from the ensemble. Spec framing is centre = bbox centre, scale = 1/(0.5 ×
  // largest extent × 1.05). When the attractor reaches into the bbox corners that would put samples
  // beyond VIEW_RADIUS, so the scale is capped to keep every sample within SUGGEST_RADIUS. Distance
  // from the new centre is bounded by distance from the current frame centre plus the shift (exact
  // once the frame centre is already the bbox centre).
  const maxFromMid = uMaxDist + Math.hypot(uMid[0] - c[0], uMid[1] - c[1], uMid[2] - c[2])
  const specScale = 1 / (0.5 * Math.max(...uExt) * 1.05)
  const sScale = Math.min(specScale, SUGGEST_RADIUS / maxFromMid)
  const sBound = ceil2(3 * maxFromMid)
  let si = Math.floor(tr.n / 2)
  // first sample past the midpoint moving at a typical (median) speed: an unremarkable spot on the attractor
  while (si < tr.n - 1 && Math.abs(speedAtIndex(sys, pos, si, P) / p50 - 1) > 0.05) si++
  const sSeed = [0, 1, 2].map((k) => round(pos[si * 3 + k], 4))
  const capped = sScale < specScale ? ` (capped from ${specScale.toPrecision(4)})` : ''
  const sNorm = sig2(p95s[Math.floor(p95s.length / 2)])
  info('suggest', `center [${uMid.map((v) => round(v, 3)).join(', ')}] scale ${sScale.toPrecision(4)}${capped} bound ${sBound} speedNorm ${sNorm} seed [${sSeed.join(', ')}]`)

  // slider sweep: each param at 5 points across its range, others at default
  for (let k = 0; k < sys.params.length; k++) {
    const def = sys.params[k]
    const cells: string[] = []
    for (let j = 0; j <= 4; j++) {
      const Pk = [...P]
      Pk[k] = def.min + (j / 4) * (def.max - def.min)
      const s = run(sys, Pk, SWEEP_STEPS, false)
      const fr = sys.frame(Pk)
      const r = s.maxDist * fr.scale
      let label: string
      if (!s.ok) label = `ESCAPE ${s.why}`
      else if (percentile(s.speeds, 0.95) < 1e-4 * sys.speedNorm(Pk)) label = 'rest'
      else label = `${s.lyap > CHAOS_LAMBDA ? 'chaos' : 'cycle'} r${fmt(r, 2)}`
      cells.push(`${fmt(Pk[k], 3)} ${label}`)
      if (!s.ok) report(id, false, `sweep ${def.key}=${fmt(Pk[k], 4)}`, s.why)
      else if (r > SWEEP_VIEW_WARN) report(id, false, `sweep ${def.key}=${fmt(Pk[k], 4)}`, `framed radius ${fmt(r, 2)} > ${SWEEP_VIEW_WARN} (leaves view)`, true)
    }
    info(`sweep ${def.key} [${def.min}, ${def.max}]`, cells.join(' | '))
  }

  rows.push({ id, dt: sys.dt, rate: sys.rate, ext, scale, p95, norm, lyap: tr.lyap })
}

function speedAtIndex(sys: AttractorSystem, pos: Float64Array, i: number, P: number[]): number {
  const d = new Float64Array(3)
  sys.f(d, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], P)
  return Math.hypot(d[0], d[1], d[2])
}

// ---------------------------------------------------------------------------------------------

const only = proc.argv.slice(2)
const ids = SYSTEMS.map((s) => s.id)
if (only.length === 0) {
  const orderOk = ids.length === EXPECTED_ORDER.length && ids.every((s, i) => s === EXPECTED_ORDER[i])
  report('catalog', orderOk, 'catalog order', orderOk ? `${ids.length} systems in the expected order` : `got [${ids.join(', ')}]`)
}
SYSTEMS.forEach((s, i) => {
  if (only.length === 0 || only.includes(s.id)) audit(s, i)
})

console.log('\nsummary')
console.log(`  ${'id'.padEnd(10)} ${'dt'.padStart(6)} ${'rate'.padStart(5)} ${'st/s'.padStart(5)}  ${'extent x, y, z'.padEnd(24)} ${'scale'.padStart(8)} ${'p95'.padStart(8)} ${'norm'.padStart(7)} ${'λ1'.padStart(7)}  result`)
for (const r of rows) {
  const res = failedIds.has(r.id) ? 'FAIL' : warnedIds.has(r.id) ? 'pass (warn)' : 'PASS'
  console.log(
    `  ${r.id.padEnd(10)} ${String(r.dt).padStart(6)} ${String(r.rate).padStart(5)} ${fmt(r.rate / r.dt, 0).padStart(5)}  ${r.ext.map((v) => fmt(v, 2)).join(', ').padEnd(24)} ${r.scale.toPrecision(4).padStart(8)} ${fmt(r.p95, 2).padStart(8)} ${fmt(r.norm, 2).padStart(7)} ${fmt(r.lyap, 3).padStart(7)}  ${res}`,
  )
}
const passed = rows.filter((r) => !failedIds.has(r.id)).length
console.log(`\n${passed}/${rows.length} systems pass, ${failCount} failed checks, ${warnCount} warnings`)
console.log(failCount === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${[...failedIds].join(', ')})`)
if (failCount > 0) proc.exitCode = 1
