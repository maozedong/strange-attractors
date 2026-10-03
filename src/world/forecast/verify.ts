/**
 * Checks the ensemble-forecast stage and measures the numbers the chapter quotes:
 *   pnpm tsx src/world/forecast/verify.ts
 *
 * 1. RK4 at dt = 0.05 (6 hours): 4th-order convergence against dt/20, and its error over 5 days.
 * 2. Chaos: two truths 1e-3 apart (RMS) diverge to unrelated weather; the leading Lyapunov
 *    exponent (Benettin) and the error-doubling time in days.
 * 3. Climatology: mean and std of x over long runs; CLIMATE_SPREAD must match it.
 * 4. The app's ensemble (50 members, perturbation 1e-3, the runs the visitor sees first):
 *    RMS spread by day, averaged over 5 runs, and the day it first exceeds half the climate.
 * 5. The same for other perturbations, for tuning the narration's day marks.
 * 6. Determinism of runs, and the crown geometry (passes through every station, closes).
 * 7. Framing: a camera pose at fov 40 where the crown fills ~70% of the view height.
 * 8. The frame loop (sim.ts) at 60 fps: telemetry, continuity and accuracy of the drawn blend,
 *    pause / restart / NaN / hitch handling, and no allocation per frame.
 *
 * Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import { PerformanceObserver } from 'node:perf_hooks'
import { getHeapSpaceStatistics } from 'node:v8'
import { PerspectiveCamera, Vector3 } from 'three'
import type { ForecastState } from '../../fractal/types'
import { FORECAST_CAP, worldTele } from '../telemetry'
import { MAX_STEPS_PER_FRAME, advanceForecast, createForecastSim, writeForecastCrowns } from './sim'
import {
  CLIMATE_MEAN,
  CLIMATE_SPREAD,
  L96Ensemble,
  L96Stepper,
  L96_DT,
  L96_F,
  L96_N,
  Rng,
  SPINUP_STEPS,
  STEPS_PER_DAY,
  rmsDistance,
  spinupSteps,
} from './lorenz96'
import { CROWN_FLOATS, CROWN_RADIAL, CROWN_RISE, CROWN_VERTICES, CrownRing, crownValue, writeCrown } from './crown'

const N = L96_N
let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const fmt = (x: number, d = 3) => (Math.abs(x) < 1e-2 && x !== 0 ? x.toExponential(2) : x.toFixed(d))
const pad = (s: string, n: number) => s.padStart(n)

/** A truth on the attractor: x = F + noise, spun up. */
function attractorState(seed: number, extra = 0): Float64Array {
  const rng = new Rng(seed)
  const x = new Float64Array(N)
  for (let i = 0; i < N; i++) x[i] = L96_F + 0.01 * rng.normal()
  new L96Stepper().run(x, SPINUP_STEPS + extra)
  return x
}

// ---------------------------------------------------------------- 1. integrator accuracy
console.log('\n1. RK4 accuracy')
{
  // Truth and members share this integrator (a perfect-model experiment), so its truncation
  // error is part of "the model", never forecast error. What matters: it is 4th order and small.
  const x0 = attractorState(7)
  const ref = x0.slice()
  new L96Stepper(L96_DT / 20).run(ref, 400) // 1 time unit
  const err = (div: number) => {
    const a = x0.slice()
    new L96Stepper(L96_DT / div).run(a, 20 * div)
    return rmsDistance(a, 0, ref, 0)
  }
  const e1 = err(1)
  const e2 = err(2)
  check(e1 / e2 > 12 && e1 / e2 < 20, 'RK4 converges at 4th order', `halving dt cuts the 1-time-unit error ${(e1 / e2).toFixed(1)}× (16 expected)`)
  check(e1 < 0.01 * CLIMATE_SPREAD, 'dt = 0.05 (6 h) truncation over 5 days is < 1% of the climate spread', `RMS ${fmt(e1)} = ${((100 * e1) / CLIMATE_SPREAD).toFixed(2)}%`)
}

// ---------------------------------------------------------------- 2. chaos
console.log('\n2. Chaos: two runs 1e-3 apart')
{
  const a = attractorState(11)
  const b = a.slice()
  const rng = new Rng(99)
  const dx = new Float64Array(N)
  let s2 = 0
  for (let i = 0; i < N; i++) {
    dx[i] = rng.normal()
    s2 += dx[i] * dx[i]
  }
  const k = 1e-3 / Math.sqrt(s2 / N)
  for (let i = 0; i < N; i++) b[i] += k * dx[i]
  const st = new L96Stepper()
  const marks = [0, 1, 2, 3, 5, 7, 10, 14, 20, 30, 40]
  let day = 0
  const row: string[] = []
  let at30 = 0
  let at40 = 0
  for (const m of marks) {
    while (day < m * STEPS_PER_DAY) {
      st.step(a)
      st.step(b)
      day++
    }
    const d = rmsDistance(a, 0, b, 0)
    if (m === 30) at30 = d
    if (m === 40) at40 = d
    row.push(`day ${m}: ${fmt(d)}`)
  }
  console.log('      ' + row.join('   '))
  const unrelated = Math.SQRT2 * CLIMATE_SPREAD
  check(at30 > 1, 'they diverge: by day 30 the separation has grown > 1000×', `RMS ${fmt(at30)}`)
  check(at40 > 0.5 * unrelated, 'by day 40 they are unrelated weather', `RMS ${fmt(at40)}; two unrelated states sit √2 × CLIMATE_SPREAD = ${unrelated.toFixed(2)} apart`)

  // Benettin: renormalise a 1e-8 separation every step for 10 000 time units
  const p = attractorState(23)
  const q = p.slice()
  const d0 = 1e-8
  for (let i = 0; i < N; i++) q[i] += d0 * dx[i] / Math.sqrt(s2 / N)
  let logSum = 0
  const STEPS = 200_000
  for (let n = 0; n < STEPS; n++) {
    st.step(p)
    st.step(q)
    const d = rmsDistance(p, 0, q, 0)
    logSum += Math.log(d / d0)
    const r = d0 / d
    for (let i = 0; i < N; i++) q[i] = p[i] + (q[i] - p[i]) * r
  }
  const lambda = logSum / (STEPS * L96_DT)
  const doublingDays = (Math.LN2 / lambda) * 5
  check(
    lambda > 1.4 && lambda < 2.0,
    'leading Lyapunov exponent near the published ≈ 1.7 per time unit',
    `λ = ${lambda.toFixed(3)} / time unit = ${(lambda / 5).toFixed(3)} / day; errors double every ${doublingDays.toFixed(2)} days, ×e every ${(5 / lambda).toFixed(2)} days`,
  )
}

// ---------------------------------------------------------------- 3. climatology
console.log('\n3. Climatology')
let xLo = -6
let xHi = 12
{
  const RUNS = 4
  const STEPS = 200_000
  const BIN = 0.01
  const MIN = -20
  const hist = new Float64Array(Math.round(50 / BIN))
  const st = new L96Stepper()
  const runStd: number[] = []
  let sum = 0
  let sum2 = 0
  let count = 0
  let lo = Infinity
  let hi = -Infinity
  for (let r = 0; r < RUNS; r++) {
    const x = attractorState(1000 + r)
    let rs = 0
    let rs2 = 0
    for (let n = 0; n < STEPS; n++) {
      st.step(x)
      for (let i = 0; i < N; i++) {
        const v = x[i]
        rs += v
        rs2 += v * v
        if (v < lo) lo = v
        if (v > hi) hi = v
        hist[Math.max(0, Math.min(hist.length - 1, Math.floor((v - MIN) / BIN)))]++
      }
    }
    const c = STEPS * N
    runStd.push(Math.sqrt(rs2 / c - (rs / c) ** 2))
    sum += rs
    sum2 += rs2
    count += c
  }
  const mean = sum / count
  const std = Math.sqrt(sum2 / count - mean * mean)
  const quantile = (q: number) => {
    let acc = 0
    for (let b = 0; b < hist.length; b++) {
      acc += hist[b]
      if (acc >= q * count) return MIN + (b + 0.5) * BIN
    }
    return NaN
  }
  xLo = quantile(0.005)
  xHi = quantile(0.995)
  const spreadOfRuns = Math.max(...runStd) - Math.min(...runStd)
  console.log(
    `      mean x = ${mean.toFixed(4)}, std x = ${std.toFixed(4)} (per-run std ${runStd.map((s) => s.toFixed(4)).join(', ')})`,
  )
  console.log(
    `      x quantiles: 0.5% ${quantile(0.005).toFixed(2)}, 5% ${quantile(0.05).toFixed(2)}, 50% ${quantile(0.5).toFixed(2)}, 95% ${quantile(0.95).toFixed(2)}, 99.5% ${quantile(0.995).toFixed(2)}; min..max seen ${lo.toFixed(2)}..${hi.toFixed(2)}`,
  )
  check(Math.abs(CLIMATE_SPREAD - std) < 0.005, 'CLIMATE_SPREAD matches the measured std of x', `constant ${CLIMATE_SPREAD}, measured ${std.toFixed(4)}, run-to-run range ${spreadOfRuns.toFixed(4)}`)
  check(Math.abs(CLIMATE_MEAN - mean) < 0.005, 'CLIMATE_MEAN matches the measured mean of x', `constant ${CLIMATE_MEAN}, measured ${mean.toFixed(4)}`)
}

// ---------------------------------------------------------------- 4/5. ensembles
interface EnsembleStats {
  /** mean over runs of the spread at each day mark */
  spread: number[]
  spreadMin: number[]
  spreadMax: number[]
  error: number[]
  /** per run: first day the spread exceeds the threshold (linear interpolation between steps) */
  cross: number[]
  /** per run: first day the spread exceeds `visible` */
  visibleDay: number[]
}

function runEnsembles(serials: number[], perturbation: number, marks: number[], threshold: number, visible: number): EnsembleStats {
  const ens = new L96Ensemble()
  const last = marks[marks.length - 1] * STEPS_PER_DAY
  const out: EnsembleStats = {
    spread: marks.map(() => 0),
    spreadMin: marks.map(() => Infinity),
    spreadMax: marks.map(() => -Infinity),
    error: marks.map(() => 0),
    cross: [],
    visibleDay: [],
  }
  for (const serial of serials) {
    ens.start({ serial, members: 50, perturbation })
    let prev = ens.spread
    let cross = prev >= threshold ? 0 : NaN
    let vis = prev >= visible ? 0 : NaN
    let mi = 0
    for (let n = 0; n <= last || Number.isNaN(cross); n++) {
      if (n > 0) ens.step()
      const s = ens.spread
      if (Number.isNaN(cross) && s > threshold && n > 0) cross = (n - 1 + (threshold - prev) / (s - prev)) / STEPS_PER_DAY
      if (Number.isNaN(vis) && s > visible && n > 0) vis = (n - 1 + (visible - prev) / (s - prev)) / STEPS_PER_DAY
      if (mi < marks.length && n === marks[mi] * STEPS_PER_DAY) {
        out.spread[mi] += s / serials.length
        out.error[mi] += ens.error / serials.length
        out.spreadMin[mi] = Math.min(out.spreadMin[mi], s)
        out.spreadMax[mi] = Math.max(out.spreadMax[mi], s)
        mi++
      }
      prev = s
      if (n > 400 * STEPS_PER_DAY) break
    }
    out.cross.push(cross)
    out.visibleDay.push(vis)
  }
  return out
}

const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length

/** spread above which the fan is visibly wider than one line at the recommended pose (see section 7) */
const VISIBLE_SPREAD = 0.1

console.log('\n4. The app\'s ensemble: 50 members, perturbation 1e-3, the first runs a visitor sees (resetSerial 1..5)')
{
  const marks = [0, 1, 2, 3, 5, 7, 10, 14, 20, 25, 30]
  const half = 0.5 * CLIMATE_SPREAD
  const five = runEnsembles([1, 2, 3, 4, 5], 1e-3, marks, half, VISIBLE_SPREAD)
  const many = runEnsembles(Array.from({ length: 40 }, (_, i) => 1000 + i), 1e-3, marks, half, VISIBLE_SPREAD)
  console.log('      day   spread (5-run mean)   5-run min..max      40-run mean   error of mean (5-run)   spread / CLIMATE_SPREAD')
  marks.forEach((m, i) => {
    console.log(
      `      ${pad(String(m), 3)}   ${pad(fmt(five.spread[i]), 19)}   ${pad(`${fmt(five.spreadMin[i])}..${fmt(five.spreadMax[i])}`, 18)}   ${pad(fmt(many.spread[i]), 11)}   ${pad(fmt(five.error[i]), 21)}   ${pad((100 * five.spread[i] / CLIMATE_SPREAD).toFixed(1) + '%', 8)}`,
    )
  })
  console.log(
    `      spread first exceeds half the climate (${half.toFixed(3)}): day ${avg(five.cross).toFixed(1)} on average over 5 runs (runs: ${five.cross.map((d) => d.toFixed(1)).join(', ')}); 40-run mean day ${avg(many.cross).toFixed(1)}, range ${Math.min(...many.cross).toFixed(1)}..${Math.max(...many.cross).toFixed(1)}`,
  )
  console.log(
    `      spread first exceeds ${VISIBLE_SPREAD} (the fan visibly frays at the recommended pose): day ${avg(five.visibleDay).toFixed(1)} (5 runs), ${avg(many.visibleDay).toFixed(1)} (40 runs)`,
  )
  for (const serial of [1, 2, 3, 4, 5]) {
    const one = runEnsembles([serial], 1e-3, [1, 3, 10, 14, 20], half, VISIBLE_SPREAD)
    console.log(
      `      run ${serial}: spread day 1 ${fmt(one.spread[0])}, day 3 ${fmt(one.spread[1])}, day 10 ${fmt(one.spread[2])}, day 14 ${fmt(one.spread[3])}, day 20 ${fmt(one.spread[4])}; frays visibly day ${one.visibleDay[0].toFixed(1)}, half climate day ${one.cross[0].toFixed(1)}`,
    )
  }
  check(five.spread[0] > 0.9e-3 && five.spread[0] < 1.05e-3, 'day-0 spread is the requested perturbation', fmt(five.spread[0]))
  check(five.spread[marks.indexOf(30)] > five.spread[marks.indexOf(1)] * 100, 'the ensemble spreads by orders of magnitude')
}

console.log('\n5. Other perturbations (50 members, 40 runs each): when the narration\'s day marks land')
{
  const marks = [0, 1, 3, 5, 7, 10, 14, 20]
  const half = 0.5 * CLIMATE_SPREAD
  console.log('      perturbation   spread at day:  1        3        5        7        10       14       20     visible frays   half climate')
  for (const p of [1e-3, 3e-3, 1e-2, 3e-2, 0.05, 0.1, 0.2, 0.3]) {
    const r = runEnsembles(Array.from({ length: 40 }, (_, i) => 2000 + i), p, marks, half, VISIBLE_SPREAD)
    const cells = marks.slice(1).map((_, j) => pad(fmt(r.spread[j + 1], 2), 8)).join(' ')
    console.log(
      `      ${pad(String(p), 12)}                 ${cells}   day ${pad(avg(r.visibleDay).toFixed(1), 5)}      day ${avg(r.cross).toFixed(1)} (${Math.min(...r.cross).toFixed(1)}..${Math.max(...r.cross).toFixed(1)})`,
    )
    if (p === 0.1) {
      const first = runEnsembles([1, 2, 3, 4, 5], p, [1, 3, 10, 14], half, VISIBLE_SPREAD)
      console.log(
        `      ${pad('', 12)}   runs 1..5 mean:  day 1 ${fmt(first.spread[0], 2)}, day 3 ${fmt(first.spread[1], 2)}, day 10 ${fmt(first.spread[2], 2)} (${((100 * first.spread[2]) / CLIMATE_SPREAD).toFixed(0)}%), day 14 ${fmt(first.spread[3], 2)} (${((100 * first.spread[3]) / CLIMATE_SPREAD).toFixed(0)}%); half climate day ${avg(first.cross).toFixed(1)} (runs ${first.cross.map((d) => d.toFixed(1)).join(', ')})`,
      )
    }
  }
}

// ---------------------------------------------------------------- 6. determinism and geometry
console.log('\n6. Runs and geometry')
{
  const a = new L96Ensemble()
  const b = new L96Ensemble()
  a.start({ serial: 3, members: 50, perturbation: 1e-3 })
  b.start({ serial: 3, members: 50, perturbation: 1e-3 })
  const sameMembers = (x: Float64Array, y: Float64Array, count: number) => {
    for (let i = 0; i < count * N; i++) if (x[i] !== y[i]) return false
    return true
  }
  check(rmsDistance(a.truth, 0, b.truth, 0) === 0 && sameMembers(a.members, b.members, 50), 'same serial, same weather and same ensemble (all 50 members)')
  b.start({ serial: 4, members: 50, perturbation: 1e-3 })
  const dTruth = rmsDistance(a.truth, 0, b.truth, 0)
  check(dTruth > 0.5 * CLIMATE_SPREAD, 'a new serial is unrelated weather', `RMS between day-0 truths ${dTruth.toFixed(2)}`)
  const spins = new Set(Array.from({ length: 200 }, (_, i) => spinupSteps(i)))
  check(spinupSteps(0) === SPINUP_STEPS && spins.size > 150, 'run 0 spins up 1000 steps; resets spin up different lengths', `${spins.size} distinct lengths in 200 resets`)
  const m0 = a.members.slice(0, 10 * N)
  a.start({ serial: 3, members: 10, perturbation: 1e-3 })
  check(sameMembers(a.members, m0, 10), 'fewer members keeps the remaining members identical (all 10)')
  a.start({ serial: 3, members: 0, perturbation: 1e-3 })
  a.step()
  check(a.spread === 0 && a.error === 0 && Number.isFinite(a.day), 'zero members: spread and error are 0, not NaN')

  // crown geometry
  const x = attractorState(5)
  const out = new Float32Array(CROWN_FLOATS)
  const R = 1.1
  writeCrown(x, 0, new CrownRing(R), out, 0)
  let worst = 0
  for (let i = 0; i < N; i++) {
    const k = i * 4
    const th = (2 * Math.PI * i) / N
    const r = R + CROWN_RADIAL * x[i]
    const ex = r * Math.cos(th)
    const ey = CROWN_RISE * x[i]
    const ez = -r * Math.sin(th)
    worst = Math.max(worst, Math.abs(out[k * 6] - ex), Math.abs(out[k * 6 + 1] - ey), Math.abs(out[k * 6 + 2] - ez))
    worst = Math.max(worst, Math.abs(crownValue(x, 0, k) - x[i]))
  }
  check(worst < 1e-5, 'the smoothed crown passes through every station', `max deviation ${fmt(worst)}`)
  let gap = 0
  for (let s = 0; s < CROWN_VERTICES; s++) {
    const n = (s + 1) % CROWN_VERTICES
    for (let c = 0; c < 3; c++) gap = Math.max(gap, Math.abs(out[s * 6 + 3 + c] - out[n * 6 + c]))
  }
  check(gap < 1e-6, 'segments join end to start, and the ring closes', `max gap ${fmt(gap)}`)
  let maxSeg = 0
  for (let s = 0; s < CROWN_VERTICES; s++) {
    const o = s * 6
    maxSeg = Math.max(maxSeg, Math.hypot(out[o + 3] - out[o], out[o + 4] - out[o + 1], out[o + 5] - out[o + 2]))
  }
  console.log(`      longest crown segment ${maxSeg.toFixed(4)} (site spacing ${((2 * Math.PI * R) / N).toFixed(4)})`)
}

// ---------------------------------------------------------------- 7. framing
console.log('\n7. Framing at fov 40')
{
  const R = 1.1
  // the crown's envelope: 99% of station values lie in [xLo, xHi]; the dial at x = 0
  const pts: Vector3[] = []
  for (let a = 0; a < 360; a += 2) {
    const th = (a * Math.PI) / 180
    for (const v of [xLo, 0, xHi]) {
      const r = R + CROWN_RADIAL * v
      pts.push(new Vector3(r * Math.cos(th), CROWN_RISE * v, -r * Math.sin(th)))
    }
  }
  const cam = new PerspectiveCamera(40, 16 / 9, 0.02, 60)
  const tmp = new Vector3()
  const extent = (pos: Vector3, target: Vector3, aspect: number) => {
    cam.aspect = aspect
    cam.position.copy(pos)
    cam.lookAt(target)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
    let y0 = Infinity
    let y1 = -Infinity
    let x0 = Infinity
    let x1 = -Infinity
    for (const p of pts) {
      tmp.copy(p).project(cam)
      y0 = Math.min(y0, tmp.y)
      y1 = Math.max(y1, tmp.y)
      x0 = Math.min(x0, tmp.x)
      x1 = Math.max(x1, tmp.x)
    }
    return { y0, y1, x0, x1, h: (y1 - y0) / 2, w: (x1 - x0) / 2 }
  }
  const poseFor = (elevationDeg: number, fill: number) => {
    const e = (elevationDeg * Math.PI) / 180
    let ty = 0.25
    let d = 4
    for (let it = 0; it < 40; it++) {
      // distance for the fill at this target height, then re-centre the target
      let lo = 1.5
      let hi = 20
      for (let b = 0; b < 50; b++) {
        d = 0.5 * (lo + hi)
        const f = extent(new Vector3(0, ty + d * Math.sin(e), d * Math.cos(e)), new Vector3(0, ty, 0), 16 / 9).h
        if (f > fill) lo = d
        else hi = d
      }
      const ex = extent(new Vector3(0, ty + d * Math.sin(e), d * Math.cos(e)), new Vector3(0, ty, 0), 16 / 9)
      ty += 0.5 * ((ex.y1 + ex.y0) / 2) * d * Math.tan((20 * Math.PI) / 180)
    }
    const pos = new Vector3(0, ty + d * Math.sin(e), d * Math.cos(e))
    const tgt = new Vector3(0, ty, 0)
    return { pos, tgt, d, wide: extent(pos, tgt, 16 / 9), tall: extent(pos, tgt, 9 / 16) }
  }
  console.log(`      envelope: 99% of station values in [${xLo.toFixed(2)}, ${xHi.toFixed(2)}] → radius ${(R + CROWN_RADIAL * xLo).toFixed(2)}..${(R + CROWN_RADIAL * xHi).toFixed(2)}, height ${(CROWN_RISE * xLo).toFixed(2)}..${(CROWN_RISE * xHi).toFixed(2)}`)
  for (const el of [20, 25, 30]) {
    const p = poseFor(el, 0.7)
    const f = (v: Vector3) => `[${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}]`
    console.log(
      `      elevation ${el}°: position ${f(p.pos)} target ${f(p.tgt)} distance ${p.d.toFixed(2)}; height fill ${(100 * p.wide.h).toFixed(0)}%, width fill 16:9 ${(100 * p.wide.w).toFixed(0)}%, 9:16 ${(100 * p.tall.w).toFixed(0)}%`,
    )
  }
  const cur = extent(new Vector3(0, 2.3, 3.6), new Vector3(0, 0.2, 0), 16 / 9)
  console.log(
    `      current WORLD_LAYOUT.forecastPose [0, 2.3, 3.6] → [0, 0.2, 0]: height fill ${(100 * cur.h).toFixed(0)}% (NDC y ${cur.y0.toFixed(2)}..${cur.y1.toFixed(2)}), width fill 16:9 ${(100 * cur.w).toFixed(0)}%`,
  )
  const top = extent(new Vector3(0, 4.2, 0.6), new Vector3(0, 0, 0), 16 / 9)
  console.log(`      current forecastTopPose [0, 4.2, 0.6] → [0, 0, 0]: height fill ${(100 * top.h).toFixed(0)}%, width fill 16:9 ${(100 * top.w).toFixed(0)}%`)
  for (const el of [75, 80]) {
    const p = poseFor(el, 0.85)
    const f = (v: Vector3) => `[${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}]`
    console.log(`      top view, elevation ${el}°: position ${f(p.pos)} target ${f(p.tgt)} distance ${p.d.toFixed(2)}; height fill ${(100 * p.wide.h).toFixed(0)}%, width fill 16:9 ${(100 * p.wide.w).toFixed(0)}%`)
  }
  // pixels per unit of spread (vertical, at the ring's centre distance) for the visibility threshold
  const p25 = poseFor(25, 0.7)
  const pxPerUnit = 900 / (2 * p25.d * Math.tan((20 * Math.PI) / 180))
  console.log(
    `      at elevation 25° on a 900 px tall view, a spread of ${VISIBLE_SPREAD} is a fan ≈ ${(2 * VISIBLE_SPREAD * CROWN_RISE * pxPerUnit * Math.cos((25 * Math.PI) / 180)).toFixed(1)} px tall (±1σ of height), so fraying shows from about there`,
  )
}

// ---------------------------------------------------------------- 8. the frame loop
console.log('\n8. Frame loop at 60 fps (sim.ts)')
{
  const FPS = 60
  const f: ForecastState = { running: true, resetSerial: 1, members: 50, perturbation: 1e-3, speed: 1 }
  const sim = createForecastSim()

  // 20 s at 1 day per second
  const prevView = new Float64Array(N)
  const exact = new Float64Array(N)
  const straight = new Float64Array(N)
  const stepper = new L96Stepper()
  let maxFrameMove = 0
  let maxBlendError = 0
  let maxLerpError = 0
  for (let frame = 0; frame < 20 * FPS; frame++) {
    advanceForecast(sim, f, 1 / FPS)
    const v = sim.view
    if (frame > 0) for (let i = 0; i < N; i++) maxFrameMove = Math.max(maxFrameMove, Math.abs(v[i] - prevView[i]))
    prevView.set(v.subarray(0, N))
    if (sim.hasPrev && sim.acc > 0) {
      // the truth a fraction acc of the way across the last step, integrated exactly from its start
      exact.set(sim.x0.subarray(0, N))
      new L96Stepper(L96_DT * sim.acc).step(exact)
      maxBlendError = Math.max(maxBlendError, rmsDistance(exact, 0, v, 0))
      for (let i = 0; i < N; i++) straight[i] = sim.x0[i] + (sim.ens.truth[i] - sim.x0[i]) * sim.acc
      maxLerpError = Math.max(maxLerpError, rmsDistance(exact, 0, straight, 0))
    }
  }
  const steps = sim.ens.steps
  check(Math.abs(steps + sim.acc - 80) < 1e-9, '20 s at 1 day/s is 80 six-hour steps', `${steps} steps + ${sim.acc.toFixed(6)} owed (float sum of 1200 frames), day ${worldTele.forecastDay}`)
  let seriesOk = worldTele.forecastCount === steps + 1
  for (let i = 0; i < worldTele.forecastCount; i++) if (Math.abs(worldTele.forecastT[i] - i / 4) > 1e-6) seriesOk = false
  check(seriesOk, 'one telemetry sample per step, starting at day 0', `${worldTele.forecastCount} samples`)
  const direct = new L96Ensemble()
  direct.start({ serial: 1, members: 50, perturbation: 1e-3 })
  for (let i = 0; i < steps; i++) direct.step()
  check(
    direct.spread === worldTele.forecastSpread && direct.error === worldTele.forecastError,
    'the frame loop runs the same model as L96Ensemble',
    `spread ${fmt(worldTele.forecastSpread)} at day ${worldTele.forecastDay}`,
  )
  // per-step change of the truth, for scale
  const a = attractorState(5)
  const b = a.slice()
  let maxStepMove = 0
  for (let n = 0; n < 400; n++) {
    stepper.step(b)
    for (let i = 0; i < N; i++) maxStepMove = Math.max(maxStepMove, Math.abs(b[i] - a[i]))
    a.set(b)
  }
  check(maxFrameMove < 0.15 * maxStepMove, 'the drawing moves in small increments, not 6-hour jumps', `largest per-frame move ${fmt(maxFrameMove)} vs largest per-step move ${fmt(maxStepMove)}`)
  check(
    maxBlendError < 0.01 * maxStepMove && maxBlendError * 5 < maxLerpError,
    'the Hermite blend follows the true trajectory between steps',
    `worst RMS error ${fmt(maxBlendError)}; a straight-line blend would be ${fmt(maxLerpError)} (${(maxLerpError / maxBlendError).toFixed(0)}× worse)`,
  )

  // pause
  f.running = false
  const count = worldTele.forecastCount
  const moved = advanceForecast(sim, f, 1 / FPS)
  check(!moved && worldTele.forecastCount === count, 'paused: no steps, no redraw')
  // NaN speed and a hitch
  f.running = true
  f.speed = NaN
  const s0 = sim.ens.steps
  const acc0 = sim.acc
  advanceForecast(sim, f, 1 / FPS)
  check(sim.ens.steps === s0 && sim.acc === acc0, 'NaN speed: no steps, clock not poisoned')
  f.speed = 1
  advanceForecast(sim, f, 5)
  check(Math.abs(sim.ens.steps + sim.acc - (s0 + acc0 + 0.4)) < 1e-9, 'a 5 s hitch advances only 0.1 s (0.4 steps)')
  advanceForecast(sim, f, NaN)
  check(Number.isFinite(sim.acc), 'NaN delta is ignored')
  f.speed = 1e6
  const before = sim.ens.steps
  advanceForecast(sim, f, 1 / FPS)
  check(sim.ens.steps - before === MAX_STEPS_PER_FRAME, `huge speed is capped at ${MAX_STEPS_PER_FRAME} steps per frame`)
  f.speed = 1
  // restart
  f.resetSerial = 2
  advanceForecast(sim, f, 1 / FPS)
  check(worldTele.forecastCount <= 2 && sim.ens.steps <= 1 && sim.serial === 2, 'a new resetSerial restarts at day 0 and clears the series', `count ${worldTele.forecastCount}`)
  // series cap
  f.speed = 1e6
  for (let i = 0; i < 100; i++) advanceForecast(sim, f, 1 / FPS)
  check(worldTele.forecastCount === FORECAST_CAP, 'the series stops at FORECAST_CAP while the model runs on', `${sim.ens.steps} steps, ${worldTele.forecastCount} samples`)
  f.speed = 1

  // allocation: the per-frame path (advance + writing every crown) must not feed the GC
  // the component's per-frame path, minus three.js flag writes (integers and booleans)
  const membersOut = new Float32Array(CROWN_FLOATS * 64)
  const meanOut = new Float32Array(CROWN_FLOATS)
  const truthOut = new Float32Array(CROWN_FLOATS)
  const live = { current: { radius: 1.1 } }
  const seen = { radius: NaN }
  const ring = new CrownRing(1.1)
  // one boxed number for the whole run (R3F hands useFrame its own delta every frame)
  const DELTA = 1 / FPS
  const frame = () => {
    let dirty = advanceForecast(sim, f, DELTA)
    if (live.current.radius !== seen.radius) {
      seen.radius = live.current.radius
      ring.setRadius(seen.radius)
      dirty = true
    }
    if (dirty) writeForecastCrowns(sim, ring, membersOut, meanOut, truthOut)
  }
  // Every allocation lands in V8's new space until a scavenge empties it, so new-space growth
  // over a window with no GC is exactly what the frames allocated.
  const newSpace = () => getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? NaN
  f.resetSerial = 3
  for (let i = 0; i < 30_000; i++) frame() // warm up the JIT
  let gcs = 0
  const obs = new PerformanceObserver((list) => {
    gcs += list.getEntries().length
  })
  obs.observe({ entryTypes: ['gc'] })
  await new Promise((r) => setTimeout(r, 20))
  gcs = 0
  const FRAMES = 60_000
  const used0 = newSpace()
  for (let i = 0; i < FRAMES; i++) frame()
  const used1 = newSpace()
  await new Promise((r) => setTimeout(r, 20))
  obs.disconnect()
  const bytes = used1 - used0
  check(
    gcs === 0 && bytes >= 0 && bytes < 0.1 * FRAMES,
    'no allocation per frame',
    `${FRAMES} frames (${(FRAMES / FPS / 60).toFixed(0)} min at 60 fps, running: clock + model + blend + all crowns): new space grew ${bytes} bytes, ${gcs} GC events`,
  )
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
