/**
 * Checks the Mandelbulb before the GPU sees it:  pnpm tsx src/fractal/bulb/verify.ts
 *
 * 1. The distance estimator (de.ts) at known points: the origin is inside, (0, 0, 1.3) is
 *    outside, and next to the surface the estimate tracks the offset (sign and scale).
 * 2. It is a lower bound in practice: along the gradient, the marched distance to the surface
 *    is never shorter than the estimate by more than the march's step factor allows.
 * 3. The GLSL text (bulbDEGlsl) has the CPU function's statements, in the same order.
 * 4. bulbBound() contains the whole set at every power the narration can pass through.
 * 5. Float32 near the surface: the shaders' precision floors sit where the error is still small.
 * 6. The resolution governor, against a simulated vsync-locked GPU: it settles within a second,
 *    stays on time, reacts to a zoom at once, recovers from a hitch, and rarely re-probes.
 * 7. The power tween: 2 → 8 in about 3.5 s, monotone, lands exactly.
 *
 * Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import {
  BAILOUT,
  bulbBound,
  bulbDE,
  bulbDEGlsl,
  bulbDistance,
  MAX_BOUND,
  MAX_ITER,
  toFractal,
} from './de'
import { ResolutionGovernor } from './governor'
import { EPS_FLOOR, NORMAL_FLOOR, STEP_SCALE } from './shaders'
import { approachPower, POWER_RATE, type PowerTween } from './tween'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const fmt = (x: number, d = 3) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(d))

type V3 = [number, number, number]
const de = (p: V3, n: number) => bulbDE(p[0], p[1], p[2], n)
const add = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}
/** deterministic LCG in [0, 1) */
let seed = 20091108
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const randomDir = (): V3 => {
  const u = rnd() * 2 - 1
  const a = rnd() * Math.PI * 2
  const s = Math.sqrt(1 - u * u)
  return [Math.cos(a) * s, Math.sin(a) * s, u]
}
const fibonacci = (count: number): V3[] => {
  const g = Math.PI * (3 - Math.sqrt(5))
  const out: V3[] = []
  for (let k = 0; k < count; k++) {
    const z = 1 - (2 * (k + 0.5)) / count
    const r = Math.sqrt(1 - z * z)
    out.push([Math.cos(g * k) * r, Math.sin(g * k) * r, z])
  }
  return out
}
/** distance along d from o to the surface, by small safe steps (Infinity if it never gets there) */
function march(o: V3, d: V3, n: number, tmax = 6, hit = 1e-7): number {
  let t = 0
  for (let i = 0; i < 200000 && t < tmax; i++) {
    const h = de(add(o, d, t), n)
    if (h < hit) return t
    t += Math.max(h * 0.25, hit * 0.5)
  }
  return Infinity
}
/** radius at which the ray from radius 2.6 toward the origin along -d first meets the set */
function surfaceRadius(d: V3, n: number): number {
  const t = march([d[0] * 2.6, d[1] * 2.6, d[2] * 2.6], [-d[0], -d[1], -d[2]], n, 2.6, 1e-5)
  return t === Infinity ? 0 : 2.6 - t
}
/** tetrahedral gradient, as bulbNormal in the shader */
function normal(p: V3, h: number, n: number, round?: (v: number) => number): V3 {
  const r = round ?? ((v: number) => v)
  const taps: V3[] = [
    [1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, 1],
  ]
  const g: V3 = [0, 0, 0]
  for (const e of taps) {
    const v = bulbDE(r(p[0] + e[0] * h), r(p[1] + e[1] * h), r(p[2] + e[2] * h), n, undefined, r)
    g[0] += e[0] * v
    g[1] += e[1] * v
    g[2] += e[2] * v
  }
  return unit(g)
}
const angleDeg = (a: V3, b: V3) => (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) / Math.PI
const quantile = (xs: number[], q: number) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

// ─── 1. known points ──────────────────────────────────────────────────────────────────────────
console.log('\n1. distance estimate at known points (power 8)')
check(de([0, 0, 0], 8) <= 0, 'origin is inside', `DE = ${de([0, 0, 0], 8)}`)
for (const p of [
  [0, 0, 0.5],
  [0, 0, -0.5],
  [0.5, 0, 0],
  [0, -0.5, 0],
  [0.3, 0.3, 0.3],
] as V3[]) {
  const v = de(p, 8)
  check(v <= 1e-4, `(${p.join(', ')}) is inside or on the surface`, `DE = ${fmt(v)}`)
}
{
  const p: V3 = [0, 0, 1.3]
  const v = de(p, 8)
  const toSurface = march(p, [0, 0, -1], 8)
  check(v > 0, '(0, 0, 1.3) is outside', `DE = ${fmt(v)}, marched distance down the pole ${fmt(toSurface)}`)
  check(v <= toSurface * 1.0001 && v >= 0.25 * toSurface, 'and the estimate is a tight lower bound there')
}
{
  // offsets from surface points back along the incoming ray: the true distance is at most the
  // offset, and the estimate should be most of it
  const ratios: number[] = []
  for (let k = 0; k < 200; k++) {
    const d = randomDir()
    const o: V3 = [d[0] * 1.5, d[1] * 1.5, d[2] * 1.5]
    const back: V3 = [-d[0], -d[1], -d[2]]
    const t = march(o, back, 8)
    if (t === Infinity) continue
    const s = add(o, back, t)
    for (const delta of [1e-2, 1e-3, 1e-4]) ratios.push(de(add(s, d, delta), 8) / delta)
  }
  // The Mandelbulb estimator is a heuristic, not a proven bound: it typically under-reports the
  // distance (safe, slower) and near spikes and creases it can over-report by a few times. The
  // march's 0.8 step and check 2 (never jumping the surface along the gradient) are what make it
  // safe in practice, so here only the bulk of the distribution is held to a tolerance.
  const lo = quantile(ratios, 0.02)
  const p90 = quantile(ratios, 0.9)
  const hi = Math.max(...ratios)
  check(p90 <= 1.05 && lo >= 0.02, 'next to the surface the estimate tracks the offset for most points', `DE / offset: p02 ${fmt(lo)}, median ${fmt(quantile(ratios, 0.5))}, p90 ${fmt(p90)}, max ${fmt(hi)}`)
}
{
  const v = bulbDistance(0, 0, 10)
  check(v > 0 && v <= 10 - 1.0, 'bulbDistance far away is a lower bound (escape-radius guard)', `${fmt(v)} at r = 10`)
  const w = bulbDistance(0, 1.3, 0)
  const q = toFractal(0, 1.3, 0, [0, 0, 0])
  check(Math.abs(w - de(q, 8)) < 1e-12 && Math.abs(w - de([0, 0, 1.3], 8)) < 1e-12, 'world +y is the fractal pole (+z)')
}

// ─── 2. lower bound along the gradient ────────────────────────────────────────────────────────
console.log('\n2. the estimate against marched distances, along the gradient')
for (const n of [2, 3, 5, 8]) {
  let worst = 0
  let count = 0
  for (let k = 0; count < 300 && k < 3000; k++) {
    const d = randomDir()
    const p: V3 = [d[0] * (0.7 + rnd() * 1.2), d[1] * (0.7 + rnd() * 1.2), d[2] * (0.7 + rnd() * 1.2)]
    const v = de(p, n)
    if (!(v > 1e-3)) continue
    const g = normal(p, 1e-6, n)
    const t = march(p, [-g[0], -g[1], -g[2]], n, 4)
    if (t === Infinity) continue
    worst = Math.max(worst, v / t)
    count++
  }
  check(worst < 1 / STEP_SCALE, `power ${n}: a step of ${STEP_SCALE} x DE never jumps the surface`, `max DE / marched distance ${fmt(worst)} over ${count} points`)
}

// ─── 3. GLSL text against the CPU function ───────────────────────────────────────────────────
console.log('\n3. GLSL estimator matches the CPU one statement by statement')
{
  const lines = [
    `#define MAX_ITER ${MAX_ITER}`,
    `#define BAILOUT ${BAILOUT.toFixed(1)}`,
    'vec3 z = c;',
    'float dr = 1.0;',
    'for (int i = 0; i < MAX_ITER; i++) {',
    'r = length(z);',
    'trap = min(trap, r);',
    'if (r > BAILOUT) break;',
    'float theta = atan(length(z.xy), z.z);',
    'float phi = atan(z.y, z.x);',
    'float rp = pow(r, uPower - 1.0);',
    'dr = rp * uPower * dr + 1.0;',
    'float zr = rp * r;',
    'float st = sin(theta * uPower);',
    'z = vec3(zr * st * cos(phi * uPower), zr * st * sin(phi * uPower), zr * cos(theta * uPower)) + c;',
    'return vec2(r > 0.0 ? 0.5 * log(r) * r / dr : -1.0, trap);',
  ]
  let at = 0
  let missing = ''
  for (const l of lines) {
    const i = bulbDEGlsl.indexOf(l, at)
    if (i < 0) {
      missing = l
      break
    }
    at = i + l.length
  }
  check(missing === '', 'all statements present, in order', missing && `missing or out of order: ${missing}`)
  // tsx prints the transpiled function without whitespace, so compare with spaces removed
  const src = bulbDE.toString().replace(/\s+/g, '')
  const cpu = ['Math.atan2(f(Math.sqrt(f(f(zx * zx) + f(zy * zy)))), zz)', 'Math.atan2(zy, zx)', 'Math.pow(r, f(power - 1))', 'f(rp * power) * dr) + 1', 'Math.log(r)']
  const absent = cpu.filter((s) => !src.includes(s.replace(/\s+/g, '')))
  check(absent.length === 0, 'CPU twin uses the same forms (atan2 for theta, one pow per iteration)', absent.join(' | '))
}

// ─── 4. bounds ────────────────────────────────────────────────────────────────────────────────
console.log('\n4. bulbBound() contains the set (12-iteration surface, 3000 directions + refinement)')
{
  const dirs = fibonacci(3000)
  const powers: number[] = []
  for (let n = 1.5; n < 4 - 1e-9; n += 0.1) powers.push(+n.toFixed(2))
  for (let n = 4; n <= 16 + 1e-9; n += 0.5) powers.push(n)
  let tightest = Infinity
  let tightestAt = 0
  let ok = true
  for (const n of powers) {
    // coarse pass, then jitter around the five farthest directions
    const hits = dirs.map((d) => ({ d, r: surfaceRadius(d, n) })).sort((a, b) => b.r - a.r)
    let max = hits[0].r
    for (const { d } of hits.slice(0, 5)) {
      let best = d
      for (const s of [0.04, 0.012]) {
        for (let j = 0; j < 80; j++) {
          const c = unit([best[0] + (rnd() - 0.5) * s, best[1] + (rnd() - 0.5) * s, best[2] + (rnd() - 0.5) * s])
          const r = surfaceRadius(c, n)
          if (r > max) {
            max = r
            best = c
          }
        }
      }
    }
    const b = bulbBound(n)
    if (b - max < tightest) {
      tightest = b - max
      tightestAt = n
    }
    if (max >= b) {
      ok = false
      console.log(`      power ${n}: surface reaches ${fmt(max, 4)} >= bound ${fmt(b, 4)}`)
    }
  }
  check(ok, `bound holds at ${powers.length} powers in 1.5 .. 16`, `tightest margin ${fmt(tightest, 4)} at power ${tightestAt}`)
  check(bulbBound(8) < 1.25 && MAX_BOUND >= bulbBound(2), 'classic bulb fits the 1.25 sphere; the mesh covers the n = 2 bound', `bound(8) = ${fmt(bulbBound(8), 4)}, bound(2) = ${fmt(bulbBound(2), 4)}`)
}

// ─── 5. float32 near the surface ─────────────────────────────────────────────────────────────
console.log('\n5. float32 error near the surface (power 8; every operation rounded, plus 1 ulp of noise)')
{
  const f32 = Math.fround
  const noisy = (v: number) => f32(v * (1 + (rnd() - 0.5) * 2 ** -22))
  const surface: V3[] = []
  while (surface.length < 150) {
    const d = randomDir()
    const o: V3 = [d[0] * 1.3, d[1] * 1.3, d[2] * 1.3]
    const t = march(o, [-d[0], -d[1], -d[2]], 8, 2, 1e-9)
    if (t !== Infinity) surface.push(add(o, [-d[0], -d[1], -d[2]], t))
  }
  const report = (delta: number) => {
    const deErr: number[] = []
    const nErr: number[] = []
    for (const s of surface) {
      const g = normal(s, 1e-7, 8)
      const p = add(s, g, delta)
      const exact = de(p, 8)
      const p32: V3 = [f32(p[0]), f32(p[1]), f32(p[2])]
      deErr.push(Math.abs(bulbDE(p32[0], p32[1], p32[2], 8, undefined, noisy) - exact) / delta)
      nErr.push(angleDeg(normal(p, delta, 8), normal(p32, delta, 8, noisy)))
    }
    return { de: quantile(deErr, 0.9), n: quantile(nErr, 0.9) }
  }
  for (const delta of [1e-3, 1e-4, NORMAL_FLOOR, EPS_FLOOR, 3e-6]) {
    const r = report(delta)
    console.log(`      ${fmt(delta).padStart(8)} from the surface: DE error p90 ${(100 * r.de).toFixed(2)}% of the distance, normal error p90 ${r.n.toFixed(2)} deg`)
  }
  const atHit = report(EPS_FLOOR)
  const atNormal = report(NORMAL_FLOOR)
  check(atHit.de < 0.05, `hit floor ${EPS_FLOOR}: estimate within 5%`, `${(100 * atHit.de).toFixed(2)}%`)
  check(atNormal.n < 3, `normal floor ${NORMAL_FLOOR}: normals within 3 deg`, `${atNormal.n.toFixed(2)} deg`)
}

// ─── 6. the governor ─────────────────────────────────────────────────────────────────────────
console.log('\n6. resolution governor against a simulated GPU (vsync-locked, cost ~ marched pixels)')
interface Sim {
  /** marched pixels per ms of GPU time, and fixed per-frame cost (ms) */
  rate: number
  base: number
  /** footprint of the bound (framebuffer px) at time t (s) */
  area: (t: number) => number
  /** display refresh, Hz */
  hz?: number
  /** extra frame time (ms) at time t, e.g. a hitch */
  extra?: (t: number) => number
  seconds: number
  startBudget?: number
}
function simulate(s: Sim) {
  const g = new ResolutionGovernor(s.startBudget ?? 6e5)
  if (s.startBudget) g.budget = s.startBudget
  const frame = 1000 / (s.hz ?? 60)
  const out: { t: number; interval: number; scale: number; pixels: number }[] = []
  let t = 0
  while (t < s.seconds * 1000) {
    const area = s.area(t / 1000)
    const scale = g.scaleFor(area)
    const pixels = scale * scale * area
    const cost = s.base + pixels / s.rate + (s.extra?.(t / 1000) ?? 0) + rnd() * 0.6
    const interval = Math.ceil(cost / frame - 1e-9) * frame
    g.sample(interval, pixels, area)
    out.push({ t: t / 1000, interval, scale, pixels })
    t += interval
  }
  return out
}
const slow = (iv: number) => iv > 1000 / 60 + 1
/** first time after which the next second holds at most one late frame */
function settleTime(run: ReturnType<typeof simulate>): number {
  for (let i = 0; i < run.length; i++) {
    let late = 0
    let j = i
    for (; j < run.length && run[j].t < run[i].t + 1; j++) if (slow(run[j].interval)) late++
    if (j < run.length && late <= 1) return run[i].t
  }
  return Infinity
}
{
  // a GPU that marches 0.4 M pixels in 13.7 ms (+3 ms of other work): 0.4 M fit a 60 Hz frame
  const gpu = { rate: 0.4e6 / 13.2, base: 3 }
  const a = simulate({ ...gpu, area: () => 0.8e6, seconds: 60 })
  const settleA = settleTime(a)
  const tail = a.filter((f) => f.t > 2)
  const lateTail = tail.filter((f) => slow(f.interval)).length / tail.length
  const meanPx = tail.reduce((s, f) => s + f.pixels, 0) / tail.length
  check(settleA < 1, 'starting too high: on time within a second', `settled at ${fmt(settleA, 2)} s`)
  check(lateTail < 0.01, 'and stays on time (probes are rare)', `${(100 * lateTail).toFixed(2)}% late frames over the next 58 s`)
  check(meanPx > 0.7 * 0.4e6, 'without giving away much resolution', `mean ${fmt(meanPx / 1e6)} M of the 0.4 M px that fit`)

  const b = simulate({ ...gpu, area: () => 0.3e6, seconds: 3, startBudget: 2e4 })
  const reachedMax = b.find((f) => f.scale >= 0.999)
  check(reachedMax !== undefined && reachedMax.t < 1, 'starting low with room to spare: full resolution within a second', `at ${fmt(reachedMax?.t ?? Infinity, 2)} s`)

  // a dive: the footprint grows 5x at t = 5 s; the budget holds, so the scale drops on the same frame
  const c = simulate({ ...gpu, area: (t) => (t < 5 ? 0.3e6 : 1.6e6), seconds: 10 })
  const lateAfterZoom = c.filter((f) => f.t >= 5 && f.t < 6 && slow(f.interval)).length
  check(lateAfterZoom <= 6, 'a dive that fills the screen costs at most a few late frames', `${lateAfterZoom} late in the second after`)

  // a hitch: three 70 ms frames at t = 6 s (GC, a React commit)
  const d = simulate({ ...gpu, area: () => 0.8e6, extra: (t) => (t > 6 && t < 6.2 ? 55 : 0), seconds: 14 })
  const before = d.filter((f) => f.t > 4 && f.t < 6).reduce((s, f) => s + f.pixels, 0) / d.filter((f) => f.t > 4 && f.t < 6).length
  const back = d.find((f) => f.t > 6.3 && f.pixels >= 0.85 * before)
  check(back !== undefined && back.t < 10, 'recovers from a hitch', `85% of the resolution back ${fmt((back?.t ?? Infinity) - 6.2, 2)} s after it`)

  // a 120 Hz display: it still targets 60 fps, not 120
  const e = simulate({ ...gpu, area: () => 0.8e6, hz: 120, seconds: 10 })
  const eTail = e.filter((f) => f.t > 2)
  const eSlow = eTail.filter((f) => f.interval > 1000 / 60 + 1).length / eTail.length
  check(eSlow < 0.02, '120 Hz display: holds 60 fps', `${(100 * eSlow).toFixed(2)}% of frames slower than 60 fps`)
}

// ─── 7. power tween ──────────────────────────────────────────────────────────────────────────
console.log('\n7. power tween')
{
  const s: PowerTween = { x: 2, v: 0 }
  let t = 0
  let monotone = true
  let prev = s.x
  while (s.x !== 8 && t < 10) {
    approachPower(s, 8, 1 / 60)
    t += 1 / 60
    if (s.x < prev) monotone = false
    prev = s.x
  }
  check(s.x === 8 && s.v === 0, '2 -> 8 lands exactly on 8', `x = ${s.x}`)
  check(monotone && t > 6 / POWER_RATE && t < 6 / POWER_RATE + 1, 'monotone, about 3.5 s at 60 fps', `${fmt(t, 2)} s`)
  const j: PowerTween = { x: 2, v: 0 }
  approachPower(j, 8, 5)
  check(j.x === 8, 'a 5 s frame (tab switch) just arrives')
  const r: PowerTween = { x: 5, v: 1.5 }
  for (let i = 0; i < 600; i++) approachPower(r, 3, 1 / 60)
  check(r.x === 3, 'a reversal mid-flight brakes, turns and lands')
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
