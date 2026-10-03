/**
 * Checks for the double-pendulum stage. Run: pnpm tsx src/world/pendulum/verify.ts
 *
 *  1. the closed-form accelerations satisfy the Euler–Lagrange equations (random states)
 *  2. one pendulum conserves energy to 1e-6 relative over 60 s (RK4, dt = 1/720)
 *  3. two copies 1e-6 rad apart separate (tip distance > 0.1) within 30 s
 *  4. the spread of 100 copies at nudge 1e-6 rad: when it first passes 0.05 and 0.5, repeated
 *     at half the step to show the timing is the physics, not the integrator
 *  5. the stage's frame loop: the trajectory does not depend on the frame rate, the drawn time
 *     tracks real time, trails chain from the drawn tip, and the store protocol holds
 */
import type { PendulumState } from '../../fractal/types'
import { accelerations, DT, energy, PendulumEnsemble, G, L1, L2, M1, M2, PENDULUM_BOUNDS, THETA0 } from './physics'
import { advance, createRig, createSim, TRAIL_LEN } from './stage'

let failed = false
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed = true
}
const fmt = (x: number, d = 3) => x.toFixed(d)

// ---------------------------------------------------------------- 1. equations of motion
{
  // (m1+m2) L1 θ1'' + m2 L2 cos δ θ2'' + m2 L2 ω2² sin δ + (m1+m2) g sin θ1 = 0
  // L1 cos δ θ1'' + L2 θ2'' − L1 ω1² sin δ + g sin θ2 = 0
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1
  const a = new Float64Array(2)
  const st = new Float64Array(4)
  let worst = 0
  for (let i = 0; i < 10000; i++) {
    const t1 = 4 * rand(), t2 = 4 * rand(), w1 = 12 * rand(), w2 = 12 * rand()
    st[0] = t1
    st[1] = w1
    st[2] = t2
    st[3] = w2
    accelerations(st, a)
    const d = t1 - t2
    const r1 = (M1 + M2) * L1 * a[0] + M2 * L2 * Math.cos(d) * a[1] + M2 * L2 * w2 * w2 * Math.sin(d) + (M1 + M2) * G * Math.sin(t1)
    const r2 = L1 * Math.cos(d) * a[0] + L2 * a[1] - L1 * w1 * w1 * Math.sin(d) + G * Math.sin(t2)
    worst = Math.max(worst, Math.abs(r1), Math.abs(r2))
  }
  check(worst < 1e-10, `Euler–Lagrange residual over 10k random states: max ${worst.toExponential(2)}`)
}

// ---------------------------------------------------------------- 2. energy
{
  const one = new PendulumEnsemble(1, 0)
  const e0 = energy(one.t1[0], one.w1[0], one.t2[0], one.w2[0])
  // the energy above the lowest possible state, a scale that does not depend on where V = 0 is
  const eAboveRest = e0 - -((M1 + M2) * G * L1 + M2 * G * L2)
  let worst = 0
  let maxW = 0
  const steps = Math.round(60 / DT)
  for (let s = 0; s < steps; s++) {
    one.step()
    const e = energy(one.t1[0], one.w1[0], one.t2[0], one.w2[0])
    worst = Math.max(worst, Math.abs(e - e0))
    maxW = Math.max(maxW, Math.abs(one.w1[0]), Math.abs(one.w2[0]))
  }
  console.log(`      E0 = ${fmt(e0, 4)} J (pivot = 0), ${fmt(eAboveRest, 4)} J above hanging at rest; peak |ω| ${fmt(maxW, 1)} rad/s`)
  check(worst / Math.abs(e0) < 1e-6, `energy over 60 s at dt 1/720: max |ΔE|/|E0| = ${(worst / Math.abs(e0)).toExponential(2)} (vs E above rest: ${(worst / eAboveRest).toExponential(2)})`)
}

// ---------------------------------------------------------------- 3. two copies
{
  const pair = new PendulumEnsemble(2, 0.5e-6) // θ1 = THETA0 ∓ 0.5e-6: 1e-6 apart
  const steps = Math.round(30 / DT)
  let hit = -1
  for (let s = 0; s < steps && hit < 0; s++) {
    pair.step()
    const dx = L1 * (Math.sin(pair.t1[0]) - Math.sin(pair.t1[1])) + L2 * (Math.sin(pair.t2[0]) - Math.sin(pair.t2[1]))
    const dy = L1 * (Math.cos(pair.t1[0]) - Math.cos(pair.t1[1])) + L2 * (Math.cos(pair.t2[0]) - Math.cos(pair.t2[1]))
    if (Math.hypot(dx, dy) > 0.1) hit = pair.time
  }
  check(hit > 0 && hit < 30, `two copies 1e-6 rad apart: tip distance > 0.1 at t = ${hit > 0 ? fmt(hit, 2) + ' s' : 'never (30 s)'}`)
}

// ---------------------------------------------------------------- 4. the fan opens
interface Timeline {
  at: Map<number, number>
  swingsAt: Map<number, number>
}

/** first time the spread passes each threshold, and how many swings (inner-arm reversals / 2) had happened */
function fan(count: number, nudge: number, dt: number, thresholds: number[], horizon = 40): Timeline {
  const ens = new PendulumEnsemble(count, nudge, dt)
  const at = new Map<number, number>()
  const swingsAt = new Map<number, number>()
  const mid = Math.floor(count / 2)
  let reversals = 0
  let prevW = 0
  const steps = Math.round(horizon / dt)
  for (let s = 0; s < steps && at.size < thresholds.length; s++) {
    ens.step()
    const w = ens.w1[mid]
    if (prevW !== 0 && Math.sign(w) !== Math.sign(prevW)) reversals++
    prevW = w
    const spread = ens.spread()
    for (const th of thresholds) {
      if (!at.has(th) && spread > th) {
        at.set(th, ens.time)
        swingsAt.set(th, reversals / 2)
      }
    }
  }
  return { at, swingsAt }
}

{
  const thresholds = [1e-4, 1e-3, 5e-3, 1e-2, 0.05, 0.1, 0.25, 0.5, 1.0]
  const neighbour = (2 * 1e-6) / 99
  console.log(`\n      100 copies, nudge 1e-6 rad: θ1 ∈ [${THETA0} − 1e-6, ${THETA0} + 1e-6], neighbours ${neighbour.toExponential(3)} rad = ${((neighbour * 180) / Math.PI).toExponential(3)}°`)
  const runs: [string, Timeline][] = [
    ['N 100, dt 1/720 ', fan(100, 1e-6, DT, thresholds)],
    ['N 100, dt 1/1440', fan(100, 1e-6, DT / 2, thresholds)],
    ['N 200, dt 1/720 ', fan(200, 1e-6, DT, thresholds)],
  ]
  console.log(`      spread >   ${thresholds.map((t) => String(t).padStart(7)).join('')}`)
  for (const [label, tl] of runs) {
    console.log(`      ${label} ${thresholds.map((t) => (tl.at.has(t) ? fmt(tl.at.get(t)!, 2) + 's' : '   —').padStart(7)).join('')}`)
  }
  const main = runs[0][1]
  console.log(`      swings by then ${thresholds.map((t) => (main.swingsAt.has(t) ? fmt(main.swingsAt.get(t)!, 1) : '—').padStart(7)).join('')}`)
  const t05 = main.at.get(0.05)
  const t5 = main.at.get(0.5)
  const fine = runs[1][1]
  check(t05 !== undefined && t5 !== undefined, `spread passes 0.05 at ${t05 !== undefined ? fmt(t05, 2) : '—'} s and 0.5 at ${t5 !== undefined ? fmt(t5, 2) : '—'} s`)
  const agree = (th: number) => Math.abs((main.at.get(th) ?? NaN) - (fine.at.get(th) ?? NaN))
  check(agree(0.05) < 0.05 && agree(0.5) < 0.05, `timing independent of the step: |Δt| ${fmt(agree(0.05), 3)} s (0.05), ${fmt(agree(0.5), 3)} s (0.5) at dt 1/1440`)

  // how the timing scales with the nudge (each factor of 10 should cost about the same time)
  console.log('\n      nudge →  t(spread > 0.05)  t(spread > 0.5)')
  for (const nudge of [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9]) {
    const tl = fan(100, nudge, DT, [0.05, 0.5])
    const a = tl.at.get(0.05), b = tl.at.get(0.5)
    console.log(`      ${nudge.toExponential(0).padStart(6)}   ${(a !== undefined ? fmt(a, 2) + ' s' : '—').padStart(10)}  ${(b !== undefined ? fmt(b, 2) + ' s' : '—').padStart(14)}`)
  }
}

// ---------------------------------------------------------------- 5. the stage
{
  console.log('')
  const SECONDS = 12
  const ref = new PendulumEnsemble(100, 1e-6)
  const refT1 = new Float64Array(Math.round(SECONDS / DT) + 40)
  const refT2 = new Float64Array(refT1.length)
  refT1[0] = ref.t1[37]
  refT2[0] = ref.t2[37]
  for (let i = 1; i < refT1.length; i++) {
    ref.step()
    refT1[i] = ref.t1[37]
    refT2[i] = ref.t2[37]
  }

  let seed = 11
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const cadences: [string, () => number][] = [
    ['60 Hz', () => 1 / 60],
    ['144 Hz', () => 1 / 144],
    ['jittered 4–40 ms', () => 0.004 + 0.036 * rand()],
  ]
  for (const [label, nextDelta] of cadences) {
    const sim = createSim()
    const rig = createRig()
    const p: PendulumState = { count: 100, nudge: 1e-6, running: true, resetSerial: 0 }
    let real = 0
    let worstTime = 0
    let mismatch = 0
    let chainGap = 0
    let headGap = 0
    let bad = 0
    let frames = 0
    while (real < SECONDS) {
      const dt = nextDelta()
      advance(sim, rig, p, dt, 0)
      real += Math.min(dt, 1 / 20)
      frames++
      const ens = sim.ens
      if (ens.t1[37] !== refT1[ens.steps] || ens.t2[37] !== refT2[ens.steps]) mismatch++
      // drawn time: alpha of the way through the last step, so a constant one step behind
      if (ens.steps > 0) worstTime = Math.max(worstTime, Math.abs((ens.steps - 1) * DT + sim.acc - (real - DT)))

      const n = ens.count
      const segs = rig.trails.line.geometry.instanceCount / n
      if (!Number.isInteger(segs) || segs > TRAIL_LEN) bad++
      const tp = rig.trails.pos
      for (let k = 0; k < n; k += 11) {
        // segment 0 starts at the drawn tip (bob 2k + 1)
        const bx = rig.bobPositions[(2 * k + 1) * 3]
        const by = rig.bobPositions[(2 * k + 1) * 3 + 1]
        headGap = Math.max(headGap, Math.hypot(tp[k * 6] - bx, tp[k * 6 + 1] - by))
        for (let a = 0; a + 1 < segs; a++) {
          const o = (a * n + k) * 6
          const q = ((a + 1) * n + k) * 6
          chainGap = Math.max(chainGap, Math.hypot(tp[o + 3] - tp[q], tp[o + 4] - tp[q + 1]))
          if (!Number.isFinite(tp[o]) || !Number.isFinite(tp[o + 3])) bad++
        }
      }
    }
    const ok = mismatch === 0 && worstTime < 1e-9 && chainGap === 0 && headGap === 0 && bad === 0
    check(ok, `frame loop at ${label} (${frames} frames): trajectory bit-identical to a plain RK4 run (${mismatch} mismatches), drawn time = real time − DT to ${worstTime.toExponential(1)} s, trail chain gap ${chainGap}, head gap ${headGap}`)
    rig.dispose()
  }

  // store protocol
  {
    const sim = createSim()
    const rig = createRig()
    const p: PendulumState = { count: 100, nudge: 1e-6, running: false, resetSerial: 3 }
    advance(sim, rig, p, 1 / 60, 0)
    const frozenAtStart = sim.ens.steps === 0 && sim.ens.time === 0
    p.count = 200 // still at the release: picked up at once
    advance(sim, rig, p, 1 / 60, 0)
    const recountAtRest = sim.ens.count === 200 && rig.trails.line.geometry.instanceCount === 0 && rig.bobGeometry.drawRange.count === 400
    p.running = true
    for (let i = 0; i < 300; i++) advance(sim, rig, p, 1 / 60, 0)
    const ran = sim.ens.time > 4.9 && sim.ens.time < 5.1
    // a sample taken on the frame's last step waits a frame, so a full trail shows 149 or 150 segments
    const shown = rig.trails.line.geometry.instanceCount / 200
    const full = shown === TRAIL_LEN || shown === TRAIL_LEN - 1
    p.running = false
    const stepsPaused = sim.ens.steps
    for (let i = 0; i < 60; i++) advance(sim, rig, p, 1 / 60, 0)
    const paused = sim.ens.steps === stepsPaused
    p.count = 100 // mid-run: waits for the next reset
    advance(sim, rig, p, 1 / 60, 0)
    const ignoredMidRun = sim.ens.count === 200
    p.resetSerial++
    advance(sim, rig, p, 1 / 60, 0)
    const reset = sim.ens.steps === 0 && sim.ens.count === 100 && sim.spread < 1e-5 && sim.filled === 1
    // the oldest trail vertex of a full trail is black
    const tailBlack = rig.trails.col[((TRAIL_LEN - 1) * 100 + 5) * 6 + 3] === 0
    check(
      frozenAtStart && recountAtRest && ran && full && paused && ignoredMidRun && reset && tailBlack,
      `store protocol: frozen until running ${frozenAtStart}, count at rest ${recountAtRest}, runs ${ran}, full trail ${full}, pause ${paused}, count mid-run deferred ${ignoredMidRun}, reset ${reset}, trail tail black ${tailBlack}`,
    )
    rig.dispose()
  }
}

console.log(`\n      reach: x ∈ [${fmt(PENDULUM_BOUNDS.left)}, ${fmt(PENDULUM_BOUNDS.right)}], y ∈ [${fmt(PENDULUM_BOUNDS.bottom)}, ${fmt(PENDULUM_BOUNDS.top)}]`)
process.exitCode = failed ? 1 : 0
