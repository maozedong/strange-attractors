/**
 * Checks Hyperion's attitude dynamics:  pnpm tsx src/world/hyperion/verify.ts
 *
 * 1. Kepler's equation is solved to machine precision.
 * 2. (a) Synchronous lock: with e = 0 and a sphere (A = B = C) the long axis keeps pointing at
 *    Saturn for 20 orbits (< 0.1°). Also with the real shape at e = 0, which is only true if the
 *    gravity-gradient torque has the right sign (the wrong sign makes the lock unstable).
 * 3. The torque's size: small planar librations at e = 0 have the period 2π / (n √(3(B − A)/C)).
 * 4. (c) Angular momentum: with the torque off |L| is conserved to 1e-9 over 20 orbits of free
 *    tumbling; with it on, L(T) − L(0) equals the torque impulse ∫ τ dt.
 * 5. (b) The twins: the real shape at e = 0.1, two copies 1e-6 rad apart. Reports the orbit (and
 *    day) at which the angle between their long axes first exceeds 10° and 90°, and how that
 *    moves with the offset's size and axis and with the step.
 * 6. The mesh: closed and outward, its lumps about 12 %, and how far its own moments of inertia
 *    are from the ellipsoid's ones the dynamics use.
 *
 * Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import {
  HYPERION_DT,
  HYPERION_ECCENTRICITY,
  HYPERION_MOMENTS,
  HYPERION_PERIOD_DAYS,
  HYPERION_SEMI_AXES,
  INITIAL_TILT_RAD,
  TWIN_OFFSET_RAD,
  TumbleSim,
  createPair,
  eccentricAnomaly,
  initialAttitude,
  orbitAt,
  type Moments,
} from './dynamics'
import { buildMoonShape, meshInertia } from './shape'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const TAU = 2 * Math.PI
const DEG = 180 / Math.PI
const fmt = (x: number, d = 3) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(d))
const stepsPerOrbit = (dt: number) => Math.round(TAU / dt)

const { A, B, C } = HYPERION_MOMENTS
console.log('Hyperion attitude dynamics')
console.log(
  `  semi-axes ${HYPERION_SEMI_AXES.join(' × ')}   moments (m = 1)  A = ${A.toFixed(5)}  B = ${B.toFixed(5)}  C = ${C.toFixed(5)}`,
)
console.log(
  `  (B − A)/C = ${((B - A) / C).toFixed(4)}   ω0 = √(3(B − A)/C) = ${Math.sqrt((3 * (B - A)) / C).toFixed(4)} n   e = ${HYPERION_ECCENTRICITY}   dt = ${HYPERION_DT} (${stepsPerOrbit(HYPERION_DT)} steps per orbit)`,
)
console.log()

// ---------------------------------------------------------------- 1. Kepler
{
  let worst = 0
  for (const e of [0, 0.1, 0.5, 0.9]) {
    for (let i = 0; i <= 2000; i++) {
      const M = -10 + (20 * i) / 2000
      const E = eccentricAnomaly(M, e)
      const m = M - TAU * Math.round(M / TAU)
      worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - m))
    }
  }
  check(worst < 1e-14, 'Kepler: |E − e sin E − M| over e ∈ {0, 0.1, 0.5, 0.9}', `worst ${worst.toExponential(1)}`)
  const o = new Float64Array(4)
  orbitAt(0, 0.1, o)
  const peri = o[2]
  orbitAt(Math.PI, 0.1, o)
  check(Math.abs(peri - 0.9) < 1e-15 && Math.abs(o[2] - 1.1) < 1e-15, 'orbit: r/a = 1 − e at periapsis, 1 + e at apoapsis')
}

// ---------------------------------------------------------------- 2. (a) synchronous lock
/** largest angle between body 0's long axis and the direction to Saturn over `orbits` */
function maxSaturnAngle(sim: TumbleSim, orbits: number): number {
  const n = stepsPerOrbit(sim.dt) * orbits
  const o = new Float64Array(4)
  const ax = [0, 0, 0]
  let worst = 0
  for (let i = 0; i < n; i++) {
    sim.step()
    if (i % 10 !== 9 && i !== n - 1) continue
    orbitAt(sim.t, sim.e, o)
    sim.longAxis(0, ax)
    // toward Saturn is −r̂ = (−cos f, −sin f, 0)
    const dot = -(ax[0] * o[0] + ax[1] * o[1])
    const cross = Math.hypot(ax[2] * o[1], -ax[2] * o[0], ax[0] * -o[1] + ax[1] * o[0])
    worst = Math.max(worst, Math.atan2(cross, dot))
  }
  return worst
}
{
  const sphere: Moments = { A: 1, B: 1, C: 1 }
  const s = new TumbleSim({ bodies: 1, e: 0, moments: sphere })
  s.setBody(0, initialAttitude({ tilt: 0 }))
  const w = maxSaturnAngle(s, 20) * DEG
  check(w < 0.1, '(a) sphere, e = 0, ω = n: long axis stays on Saturn for 20 orbits', `max ${w.toExponential(2)}°`)

  const r = new TumbleSim({ bodies: 1, e: 0 })
  r.setBody(0, initialAttitude({ tilt: 0 }))
  const wr = maxSaturnAngle(r, 20) * DEG
  check(wr < 0.1, '(a) real shape, e = 0: the lock is an equilibrium and stays (torque sign)', `max ${wr.toExponential(2)}°`)
}

// ---------------------------------------------------------------- 3. libration period
{
  const amp = 0.5 / DEG
  const s = new TumbleSim({ bodies: 1, e: 0 })
  s.setBody(0, initialAttitude({ tilt: 0, offset: amp }))
  const o = new Float64Array(4)
  const ax = [0, 0, 0]
  const signedAngle = () => {
    orbitAt(s.t, 0, o)
    s.longAxis(0, ax)
    // angle from −r̂ to the long axis about +z
    return Math.atan2(-o[0] * ax[1] + o[1] * ax[0], -(o[0] * ax[0] + o[1] * ax[1]))
  }
  let prev = signedAngle()
  const crossings: number[] = []
  const limit = stepsPerOrbit(s.dt) * 12
  for (let i = 0; i < limit && crossings.length < 9; i++) {
    const tPrev = s.t
    s.step()
    const cur = signedAngle()
    if (prev > 0 && cur <= 0) crossings.push(tPrev + (s.t - tPrev) * (prev / (prev - cur)))
    prev = cur
  }
  const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1)
  const expected = TAU / Math.sqrt((3 * (B - A)) / C)
  const err = Math.abs(period / expected - 1)
  check(
    err < 2e-3,
    '(torque size) small librations at e = 0 have period 2π / √(3(B − A)/C)',
    `${period.toFixed(4)} vs ${expected.toFixed(4)} time units, ${(err * 100).toFixed(3)} %`,
  )
}

// ---------------------------------------------------------------- 3b. planar cross-check at e = 0.1
{
  // With no lean the motion stays in the orbit plane and must obey Wisdom, Peale & Mignard's
  // spin-orbit equation  θ'' = −(ω0² / 2) (a/r)³ sin 2(θ − f),  integrated here independently.
  const w02 = (3 * (B - A)) / C
  const s = new TumbleSim({ bodies: 1 })
  s.setBody(0, initialAttitude({ tilt: 0 }))
  const o = new Float64Array(4)
  const acc = (t: number, th: number) => {
    orbitAt(t, HYPERION_ECCENTRICITY, o)
    const f = Math.atan2(o[1], o[0])
    return -(w02 / 2) * (1 / (o[2] * o[2] * o[2])) * Math.sin(2 * (th - f))
  }
  let th = Math.PI
  let om = 1
  const h = HYPERION_DT
  const ax = [0, 0, 0]
  let worst = 0
  let planar = 0
  let prevAngle = Math.PI
  let turns = 0
  const n = stepsPerOrbit(h) * 3
  for (let i = 0; i < n; i++) {
    const t = i * h
    const k1t = om
    const k1o = acc(t, th)
    const k2t = om + (h / 2) * k1o
    const k2o = acc(t + h / 2, th + (h / 2) * k1t)
    const k3t = om + (h / 2) * k2o
    const k3o = acc(t + h / 2, th + (h / 2) * k2t)
    const k4t = om + h * k3o
    const k4o = acc(t + h, th + h * k3t)
    th += (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t)
    om += (h / 6) * (k1o + 2 * k2o + 2 * k3o + k4o)
    s.step()
    s.longAxis(0, ax)
    planar = Math.max(planar, Math.abs(ax[2]))
    const a = Math.atan2(ax[1], ax[0])
    if (a - prevAngle < -Math.PI) turns++
    if (a - prevAngle > Math.PI) turns--
    prevAngle = a
    worst = Math.max(worst, Math.abs(a + TAU * turns - th))
  }
  check(
    worst < 1e-8 && planar < 1e-12,
    "(planar) with no lean, e = 0.1: matches Wisdom's spin-orbit equation for 3 orbits",
    `max |Δθ| ${worst.toExponential(2)} rad, out of plane ${planar.toExponential(1)}`,
  )
}

// ---------------------------------------------------------------- 4. (c) angular momentum
{
  const s = new TumbleSim({ bodies: 1, torque: false })
  s.setBody(0, { q: initialAttitude().q, w: [0.31, 0.52, 1.0] })
  const L0 = [0, 0, 0]
  const L = [0, 0, 0]
  s.angularMomentum(0, L0)
  const m0 = Math.hypot(L0[0], L0[1], L0[2])
  let worstMag = 0
  let worstVec = 0
  const n = stepsPerOrbit(s.dt) * 20
  for (let i = 0; i < n; i++) {
    s.step()
    if (i % 50 !== 49) continue
    s.angularMomentum(0, L)
    worstMag = Math.max(worstMag, Math.abs(Math.hypot(L[0], L[1], L[2]) / m0 - 1))
    worstVec = Math.max(worstVec, Math.hypot(L[0] - L0[0], L[1] - L0[1], L[2] - L0[2]) / m0)
  }
  check(worstMag < 1e-9, '(c) torque off, free tumbling: |L| conserved over 20 orbits', `max |Δ|L||/|L| ${worstMag.toExponential(2)}`)
  check(worstVec < 1e-9, '(c) torque off: the inertial L vector itself is conserved', `max |ΔL|/|L| ${worstVec.toExponential(2)}`)

  const p = createPair()
  p.impulse = new Float64Array(6)
  const a0 = [0, 0, 0]
  const a1 = [0, 0, 0]
  p.angularMomentum(0, a0)
  const mag0 = Math.hypot(a0[0], a0[1], a0[2])
  p.advance(stepsPerOrbit(p.dt) * 20)
  p.angularMomentum(0, a1)
  const imp = p.impulse
  const resid = Math.hypot(a1[0] - a0[0] - imp[0], a1[1] - a0[1] - imp[1], a1[2] - a0[2] - imp[2]) / mag0
  const change = Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]) / mag0
  check(
    resid < 1e-8 && change > 1e-2,
    '(c) torque on, e = 0.1: L(T) − L(0) = ∫ τ dt over 20 orbits',
    `|ΔL|/|L0| ${fmt(change)}, residual ${resid.toExponential(2)}`,
  )
}

// ---------------------------------------------------------------- 5. (b) the twins
interface Divergence {
  at1: number
  at10: number
  at90: number
}
/** time units at which the long axes of two copies first part by 1°, 10° and 90° */
function divergence(offset: number, axis: [number, number, number], dt = HYPERION_DT, maxOrbits = 400): Divergence {
  const s = new TumbleSim({ bodies: 2, dt })
  s.setBody(0, initialAttitude())
  s.setBody(1, initialAttitude({ offset, offsetAxis: axis }))
  const n = stepsPerOrbit(dt) * maxOrbits
  let at1 = NaN
  let at10 = NaN
  for (let i = 0; i < n; i++) {
    s.step()
    const a = s.longAxisAngle(0, 1) * DEG
    if (Number.isNaN(at1) && a > 1) at1 = s.t
    if (Number.isNaN(at10) && a > 10) at10 = s.t
    if (a > 90) return { at1, at10, at90: s.t }
  }
  return { at1, at10, at90: NaN }
}
const orbitsOf = (t: number) => t / TAU
const daysOf = (t: number) => orbitsOf(t) * HYPERION_PERIOD_DAYS
const show = (t: number) => (Number.isNaN(t) ? '   never' : `${orbitsOf(t).toFixed(2).padStart(6)} orbits = ${daysOf(t).toFixed(0).padStart(4)} days`)
{
  console.log()
  console.log('(b) twins, real shape, e = 0.1, start at periapsis, long axis on Saturn, ω = n, 2° lean')
  const main = divergence(TWIN_OFFSET_RAD, [0, 0, 1])
  console.log(`  1e-6 rad about the orbit normal (the stage's twin):`)
  console.log(`    >  1°  ${show(main.at1)}   (first visible side by side)`)
  console.log(`    > 10°  ${show(main.at10)}`)
  console.log(`    > 90°  ${show(main.at90)}`)
  check(Number.isFinite(main.at10) && Number.isFinite(main.at90), '(b) the twins part by 10° and by 90°')

  const fine = divergence(TWIN_OFFSET_RAD, [0, 0, 1], HYPERION_DT / 2)
  const drift10 = Math.abs(orbitsOf(fine.at10) - orbitsOf(main.at10))
  const drift90 = Math.abs(orbitsOf(fine.at90) - orbitsOf(main.at90))
  check(
    drift10 < 0.05 && drift90 < 0.05,
    '(b) the crossing times are converged in dt (dt / 2 moves them < 0.05 orbit)',
    `10°: ${orbitsOf(fine.at10).toFixed(3)} vs ${orbitsOf(main.at10).toFixed(3)}, 90°: ${orbitsOf(fine.at90).toFixed(3)} vs ${orbitsOf(main.at90).toFixed(3)} orbits`,
  )

  console.log('  sensitivity (the narration says "a millionth of a degree" = 1.75e-8 rad):')
  console.log('    offset           axis           > 10°                        > 90°')
  const axes: [string, [number, number, number]][] = [
    ['orbit normal', [0, 0, 1]],
    ['radial (x)', [1, 0, 0]],
    ['along-track (y)', [0, 1, 0]],
  ]
  for (const [label, offset] of [
    ['1e-6 rad', 1e-6],
    ['1e-6 deg', 1e-6 / DEG],
    ['1e-3 rad', 1e-3],
  ] as const) {
    for (const [axisLabel, axis] of axes) {
      const d = divergence(offset, axis)
      console.log(`    ${label.padEnd(16)} ${axisLabel.padEnd(14)} ${show(d.at10)}   ${show(d.at90)}`)
    }
  }

  // how the attitude itself behaves: the lean of the spin axis and the spin rate over 30 orbits
  const s = createPair()
  const per = stepsPerOrbit(s.dt)
  const row: string[] = []
  for (let k = 1; k <= 30; k++) {
    s.advance(per)
    const y = s.y
    // short axis (body z) against the orbit normal
    const zz = 1 - 2 * (y[1] * y[1] + y[2] * y[2])
    if (k % 3 === 0) row.push(`${k}:${(Math.acos(Math.max(-1, Math.min(1, zz))) * DEG).toFixed(0)}°/${Math.hypot(y[4], y[5], y[6]).toFixed(2)}n`)
  }
  console.log(`  Hyperion's short-axis tilt off the orbit normal / spin rate, by orbit: ${row.join('  ')}`)
  console.log(`  (initial lean ${(INITIAL_TILT_RAD * DEG).toFixed(1)}°; days = orbits × ${HYPERION_PERIOD_DAYS})`)
}

// ---------------------------------------------------------------- 6. the mesh
{
  console.log()
  const shape = buildMoonShape()
  const nv = shape.positions.length / 3
  const nt = shape.index.length / 3
  check(nv === 10242 && nt === 20480, 'mesh: icosphere level 5 (10242 vertices, 20480 triangles)', `${nv} / ${nt}`)
  // closed: every edge is shared by exactly two triangles, in opposite directions
  const edges = new Map<number, number>()
  const ix = shape.index
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = ix[t * 3 + k]
      const b = ix[t * 3 + ((k + 1) % 3)]
      edges.set(a * nv + b, (edges.get(a * nv + b) ?? 0) + 1)
    }
  }
  let open = 0
  for (const [key, count] of edges) {
    const a = Math.floor(key / nv)
    const b = key % nv
    if (count !== 1 || edges.get(b * nv + a) !== 1) open++
  }
  check(open === 0, 'mesh: closed and consistently wound', `${open} bad edges`)
  const inertia = meshInertia(shape.positions, shape.index)
  check(inertia.volume > 0, 'mesh: wound outward (positive volume)', `volume ${inertia.volume.toFixed(5)}`)
  check(
    shape.lumpRange > 0.11 && shape.lumpRange < 0.13,
    'mesh: lumps (3 value-noise octaves) peak at ~12 % of the radius',
    `peak ${(shape.lumpRange * 100).toFixed(1)} %`,
  )
  const [Ia, Ib, Ic] = inertia.diagonal
  console.log(
    `  the lumpy mesh's own moments (m = 1, body axes): ${Ia.toFixed(5)} ${Ib.toFixed(5)} ${Ic.toFixed(5)}` +
      `  vs ellipsoid ${A.toFixed(5)} ${B.toFixed(5)} ${C.toFixed(5)}` +
      `  → (B − A)/C ${((Ib - Ia) / Ic).toFixed(3)} vs ${((B - A) / C).toFixed(3)}; largest product of inertia ${(inertia.offDiagonal / Ic * 100).toFixed(1)} % of C;` +
      ` centre of mass ${inertia.centroidOffset.toFixed(4)} units off the origin (${(inertia.centroidOffset / HYPERION_SEMI_AXES[0] * 100).toFixed(1)} % of a)`,
  )
}

console.log()
if (failures) {
  console.log(`${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('all checks passed')
