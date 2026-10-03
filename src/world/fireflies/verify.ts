/**
 * Checks and narration timings for the fireflies stage. Run: pnpm tsx src/world/fireflies/verify.ts
 *
 *  1. the mean-field step equals the direct pairwise sum (K/N) Σ_j sin(θ_j − θ_i)
 *  2. the brief: N = 1500, σ = 0.25: K = 0 stays below r = 0.15 and K = 0.3 below 0.3 after
 *     transients; K = 1.2 passes r = 0.8 within 20 s
 *  3. r at 5, 10, 20, 40 s for a range of K, the late-time r against Kuramoto's self-consistency
 *     (N → ∞), and the share of fireflies frequency-locked to the crowd
 *  4. the timing does not depend on the frame rate; how much it varies between populations
 *  5. the chapter as scripted (cue phrases resolved from the narration's alignment file, the way
 *     the director does): r at each phrase, how long the tree takes to fall out of step, variants
 *  6. the stage's frame loop: store protocol and telemetry series
 *
 * Simulation only (no three.js). Exits non-zero if a check fails.
 */
import { readFileSync } from 'node:fs'
import type { FirefliesState } from '../../fractal/types'
import { NARRATION } from '../../audio/script'
import { worldTele } from '../telemetry'
import {
  advanceStage,
  createStage,
  criticalCoupling,
  flash,
  Kuramoto,
  MAX_FRAME,
  OMEGA0,
  SAMPLE_EVERY,
  SERIES_CAP,
  SIGMA,
  seedFor,
  SUBSTEPS,
  type FirefliesStage,
} from './sim'

let failed = false
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '  —  ')
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '  —  ')
const pad = (s: string, n: number) => s.padStart(n)
const TAU = 2 * Math.PI
const wrapPi = (x: number) => x - TAU * Math.round(x / TAU)

const N = 1500
/** the chapter's first visit: DEFAULT_FIREFLIES.resetSerial (0) + 1 */
const SERIAL = 1
const FRAME = 1 / 60
const KC = criticalCoupling()

// ---------------------------------------------------------------- a run through the stage's own frame loop

interface Run {
  st: FirefliesStage
  p: FirefliesState
  /** frames advanced */
  frames: number
  /** unwrapped phases and mean-field phase, for frequency locking */
  unwrapped: Float64Array
  prevTheta: Float64Array
  psiUnwrapped: number
  prevPsi: number
}

function startRun(K: number, serial = SERIAL, count = N): Run {
  const st = createStage()
  const p: FirefliesState = { coupling: K, count, running: true, resetSerial: serial }
  advanceStage(st, p, 0)
  const run: Run = {
    st,
    p,
    frames: 0,
    unwrapped: new Float64Array(count),
    prevTheta: new Float64Array(count),
    psiUnwrapped: st.sim.psi,
    prevPsi: st.sim.psi,
  }
  for (let i = 0; i < count; i++) run.unwrapped[i] = run.prevTheta[i] = st.sim.theta[i]
  return run
}

function frame(run: Run, dt = FRAME, track = false) {
  advanceStage(run.st, run.p, dt)
  run.frames++
  if (!track) return
  const th = run.st.sim.theta
  for (let i = 0; i < run.p.count; i++) {
    run.unwrapped[i] += wrapPi(th[i] - run.prevTheta[i])
    run.prevTheta[i] = th[i]
  }
  const psi = run.st.sim.psi
  run.psiUnwrapped += wrapPi(psi - run.prevPsi)
  run.prevPsi = psi
}

/** advance to simulated time t (frames of `dt`) */
function runTo(run: Run, t: number, dt = FRAME, track = false, each?: () => void) {
  while (run.st.sim.time < t - 1e-9) {
    frame(run, dt, track)
    each?.()
  }
}

// ---------------------------------------------------------------- theory (N → ∞)

const g = (w: number) => Math.exp((-w * w) / (2 * SIGMA * SIGMA)) / (SIGMA * Math.sqrt(TAU))

/** the partially locked state's r: 1 = K ∫ cos²φ g(K r sin φ) dφ over |φ| ≤ π/2 (0 below K_c) */
function rInfinity(K: number): number {
  if (K <= KC) return 0
  const F = (r: number) => {
    const M = 2000
    let s = 0
    for (let k = 0; k <= M; k++) {
      const phi = -Math.PI / 2 + (Math.PI * k) / M
      const wgt = k === 0 || k === M ? 1 : k % 2 ? 4 : 2
      s += wgt * Math.cos(phi) ** 2 * g(K * r * Math.sin(phi))
    }
    return (K * s * Math.PI) / (3 * M) - 1
  }
  let lo = 1e-9
  let hi = 1
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi)
    if (F(mid) > 0) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** Abramowitz & Stegun 7.1.26 */
function erf(x: number): number {
  const s = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}

// ---------------------------------------------------------------- 1. mean field = pairwise sum
{
  const n = 300
  const K = 1.3
  const h = 1e-3
  const k = new Kuramoto(n, 99)
  let seed = 5
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  // a clumped state, so the mean field is far from zero
  for (let i = 0; i < n; i++) k.theta[i] = (rnd() < 0.6 ? 1 + 0.4 * rnd() : TAU * rnd()) % TAU
  k.measure()
  const before = Float64Array.from(k.theta.subarray(0, n))
  k.step(h, K)
  let worst = 0
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += Math.sin(before[j] - before[i])
    const direct = k.omega[i] + (K / n) * sum
    const got = wrapPi(k.theta[i] - before[i]) / h
    worst = Math.max(worst, Math.abs(got - direct))
  }
  check(worst < 1e-9, 'mean-field step equals the direct O(N²) Kuramoto sum', `max |Δ dθ/dt| = ${worst.toExponential(2)} rad/s, r = ${f3(Math.hypot(...meanField(before)))}`)
}

function meanField(th: Float64Array): [number, number] {
  let c = 0
  let s = 0
  for (const t of th) {
    c += Math.cos(t)
    s += Math.sin(t)
  }
  return [c / th.length, s / th.length]
}

// ---------------------------------------------------------------- the flash
{
  // full width at half maximum of the pulse, in seconds at OMEGA0
  let a = 0
  let b = Math.PI
  for (let i = 0; i < 60; i++) {
    const m = 0.5 * (a + b)
    if (flash(m) > 0.5) a = m
    else b = m
  }
  let mean = 0
  const M = 100000
  for (let i = 0; i < M; i++) mean += flash((TAU * (i + 0.5)) / M)
  mean /= M
  console.log(`      flash: FWHM ${f3((2 * a) / OMEGA0)} s (${f2((2 * a * 60) / OMEGA0)} frames at 60 Hz), every ${f2(TAU / OMEGA0)} s; mean flash of an incoherent tree ${f3(mean)}`)
}

console.log(`      σ = ${SIGMA} rad/s (${f2((100 * SIGMA) / OMEGA0)} % of ω0 = ${f3(OMEGA0)} rad/s), K_c = 2σ√(2/π) = ${f3(KC)}`)
console.log(`      integration: Euler, ${SUBSTEPS} substeps per frame, frame capped at ${f3(MAX_FRAME)} s; tables at ${Math.round(1 / FRAME)} fps, N = ${N}, resetSerial ${SERIAL}`)

// ---------------------------------------------------------------- 2 + 3. the brief, and the table
const KS = [0, 0.3, 0.6, 0.9, 1.2, 2.0]
const TIMES = [5, 10, 20, 40]
const LOCK_WINDOW = 4
const LOCK_TOL = 0.05
const rows: string[] = []
const results = new Map<number, { maxLate: number; t08: number }>()
for (const K of KS) {
  const run = startRun(K)
  const at: number[] = []
  const locked: number[] = []
  let t05 = NaN
  let t08 = NaN
  let maxLate = 0
  let lateSum = 0
  let lateN = 0
  const snapshots = new Map<number, { u: Float64Array; psi: number }>()
  const each = () => {
    const t = run.st.sim.time
    const r = run.st.sim.r
    if (!(t05 >= 0) && r >= 0.5) t05 = t
    if (!(t08 >= 0) && r >= 0.8) t08 = t
    if (t >= 5) maxLate = Math.max(maxLate, r)
    if (t >= 40) {
      lateSum += r
      lateN++
    }
  }
  for (const T of TIMES) {
    runTo(run, T - LOCK_WINDOW, FRAME, true, each)
    snapshots.set(T, { u: Float64Array.from(run.unwrapped), psi: run.psiUnwrapped })
    runTo(run, T, FRAME, true, each)
    at.push(run.st.sim.r)
    const s = snapshots.get(T)!
    const dt = LOCK_WINDOW
    const Omega = (run.psiUnwrapped - s.psi) / dt
    let n = 0
    for (let i = 0; i < N; i++) if (Math.abs((run.unwrapped[i] - s.u[i]) / dt - Omega) < LOCK_TOL) n++
    // the mean-field phase only means something once there is a mean field
    locked.push(K >= KC ? n / N : NaN)
  }
  runTo(run, 60, FRAME, false, each)
  const rLate = lateSum / lateN
  const rTh = rInfinity(K)
  const lockTh = rTh > 0 ? erf((K * rTh) / (SIGMA * Math.SQRT2)) : NaN
  results.set(K, { maxLate, t08 })
  rows.push(
    `${pad(K.toFixed(2), 5)} ${pad(f2(K / KC), 5)} │ ${at.map((r) => pad(f3(r), 6)).join(' ')} │ ${pad(f2(t05), 6)} ${pad(f2(t08), 6)} │ ${pad(f3(rLate), 6)} ${pad(f3(rTh), 6)} │ ${locked.map((x) => pad(Number.isFinite(x) ? `${Math.round(100 * x)}%` : '—', 5)).join(' ')} ${pad(Number.isFinite(lockTh) ? `${Math.round(100 * lockTh)}%` : '—', 6)}`,
  )
}
check(results.get(0)!.maxLate < 0.15, 'K = 0: r stays below 0.15 after 5 s (to 60 s)', `max ${f3(results.get(0)!.maxLate)}`)
check(results.get(0.3)!.maxLate < 0.3, 'K = 0.3: r stays below 0.3 after 5 s (to 60 s)', `max ${f3(results.get(0.3)!.maxLate)}`)
check(results.get(1.2)!.t08 < 20, 'K = 1.2: r exceeds 0.8 within 20 s', `at ${f2(results.get(1.2)!.t08)} s`)
console.log()
console.log('    K  K/Kc │ r(5 s) r(10s) r(20s) r(40s) │ r≥0.5  r≥0.8 │ r 40–60 r(N→∞) │ locked at 5/10/20/40 s  (N→∞)')
for (const r of rows) console.log(r)
console.log(`      locked: effective frequency over the last ${LOCK_WINDOW} s within ${LOCK_TOL} rad/s of the mean field's (≈ 10–15 % while r is small:\n      fireflies that happen to run at the crowd's rate); N→∞: erf(K r∞ / σ√2). Shown for K > K_c only.`)
console.log()

// ---------------------------------------------------------------- 4. frame rate, populations
{
  const rates = [30, 60, 120, 240]
  const t08 = rates.map((fps) => {
    const run = startRun(1.2)
    let hit = NaN
    runTo(run, 30, 1 / fps, false, () => {
      if (!(hit >= 0) && run.st.sim.r >= 0.8) hit = run.st.sim.time
    })
    return hit
  })
  const spread = (Math.max(...t08) - Math.min(...t08)) / Math.min(...t08)
  check(spread < 0.03, 'K = 1.2: time to r ≥ 0.8 does not depend on the frame rate', rates.map((f, i) => `${f} fps ${f2(t08[i])} s`).join(', '))

  const seeds = Array.from({ length: 16 }, (_, i) => i + 1)
  const stats = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return `min ${f2(s[0])}  median ${f2(0.5 * (s[7] + s[8]))}  max ${f2(s[s.length - 1])}`
  }
  const lock12 = seeds.map((serial) => {
    const run = startRun(1.2, serial)
    let hit = NaN
    runTo(run, 40, FRAME, false, () => {
      if (!(hit >= 0) && run.st.sim.r >= 0.8) hit = run.st.sim.time
    })
    return hit
  })
  const noise = (K: number) =>
    seeds.map((serial) => {
      const run = startRun(K, serial)
      let m = 0
      runTo(run, 60, FRAME, false, () => {
        if (run.st.sim.time >= 5) m = Math.max(m, run.st.sim.r)
      })
      return m
    })
  const n0 = noise(0)
  const n3 = noise(0.3)
  console.log(`      16 populations (resetSerial 1–16): K = 1.2 time to r ≥ 0.8: ${stats(lock12)} s`)
  console.log(`                                          K = 0   max r after 5 s:  ${stats(n0)}`)
  console.log(`                                          K = 0.3 max r after 5 s:  ${stats(n3)}`)
  check(Math.max(...lock12) < 20 && Math.max(...n0) < 0.15 && Math.max(...n3) < 0.3, 'the brief holds for all 16 populations')
  console.log()
}

// ---------------------------------------------------------------- 5. the chapter as scripted
{
  const script = NARRATION.fireflies
  const align = (JSON.parse(readFileSync(new URL('../../../public/audio/vo-fireflies.json', import.meta.url), 'utf8')) as { t: number[] }).t
  const timeOf = (phrase: string) => {
    const i = script.indexOf(phrase)
    if (i < 0) throw new Error(`phrase not in the narration: "${phrase}"`)
    return align[i]
  }
  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

  interface Cue {
    phrase: string
    to: number
    /** tween length; 0 sets the coupling at once */
    seconds: number
    /** also bump resetSerial: new clocks (this clears the chart's series too) */
    scramble?: boolean
  }
  /** mirrors the cues of the 'fireflies' chapter in src/content/wing5.tsx */
  const SCRIPTED: Cue[] = [
    { phrase: 'nudges its own timing', to: 1.4, seconds: 3 },
    { phrase: 'Below a certain coupling', to: 0.2, seconds: 2 },
    { phrase: 'Above it, they lock.', to: 1.2, seconds: 2 },
  ]
  /** proposed: lock on "blinks as one", show real noise below K_c, then the core and the stragglers */
  const PROPOSED: Cue[] = [
    { phrase: 'nudges its own timing', to: 2.0, seconds: 3 },
    { phrase: 'Below a certain coupling', to: 0.2, seconds: 0, scramble: true },
    { phrase: 'Above it, they lock.', to: 1.6, seconds: 2 },
  ]
  const MARKS = [
    'nudges its own timing',
    'within minutes',
    'blinks as one',
    'Yoshiki Kuramoto',
    'Below a certain coupling',
    'the flashing is noise',
    'Above it, they lock.',
    'a core forms and grows',
    'the stragglers fall in',
    'The pacemaker cells',
    'This is the opposite',
  ]
  const END = align[align.length - 1]

  /** r at each mark (narration time = simulated time since the chapter's reset) */
  const play = (cues: Cue[], serial = SERIAL) => {
    const run = startRun(0, serial)
    let clock = 0 // narration time; the stage's own clock restarts on a scramble
    let tween: { t0: number; from: number; to: number; seconds: number } | null = null
    const pending = cues.map((c) => ({ ...c, at: timeOf(c.phrase), fired: false }))
    const marks = MARKS.map((m) => ({ at: timeOf(m), r: NaN }))
    marks.push({ at: END, r: NaN })
    /** narration time r first reaches 0.8, and again after the last cue */
    let lock1 = NaN
    let lock2 = NaN
    let lastCue = Infinity
    while (clock < END) {
      for (const c of pending) {
        if (c.fired || clock < c.at) continue
        c.fired = true
        tween = { t0: clock, from: run.p.coupling, to: c.to, seconds: c.seconds }
        if (c.scramble) run.p.resetSerial += 1000
        if (c === pending[pending.length - 1]) lastCue = clock
      }
      if (tween) {
        const u = tween.seconds > 0 ? Math.min(1, (clock - tween.t0) / tween.seconds) : 1
        run.p.coupling = tween.from + (tween.to - tween.from) * easeInOut(u)
        if (u >= 1) tween = null
      }
      frame(run)
      clock += FRAME
      const r = run.st.sim.r
      for (const m of marks) if (!Number.isFinite(m.r) && clock >= m.at) m.r = r
      if (!(lock1 >= 0) && r >= 0.8) lock1 = clock
      if (!(lock2 >= 0) && clock > lastCue && r >= 0.8) lock2 = clock
    }
    return { marks, lock1, lock2 }
  }

  console.log('      the chapter (cue times from public/audio/vo-fireflies.json, as the director resolves them):')
  const variants: [string, Cue[]][] = [
    ['as scripted', SCRIPTED],
    ['scripted + scramble', [SCRIPTED[0], { ...SCRIPTED[1], scramble: true }, SCRIPTED[2]]],
    ['proposed', PROPOSED],
  ]
  console.log('        as scripted:          1.4 over 3 s → 0.2 over 2 s → 1.2 over 2 s')
  console.log('        scripted + scramble:  the same, and "Below a certain coupling" also bumps resetSerial')
  console.log('        proposed:             2.0 over 3 s → 0.2 at once + resetSerial bump → 1.6 over 2 s')
  const results = variants.map(([, cues]) => play(cues))
  console.log(`      ${'phrase'.padEnd(30)} ${'t (s)'.padStart(6)} │ ${variants.map(([name]) => name.padStart(20)).join(' ')}`)
  const labels = [...MARKS, '(end of narration)']
  labels.forEach((m, k) => {
    const at = results[0].marks[k].at
    console.log(`      ${`"${m}"`.padEnd(30)} ${pad(f2(at), 6)} │ ${results.map((res) => pad(`r ${f3(res.marks[k].r)}`, 20)).join(' ')}`)
  })
  console.log(`      ${'r ≥ 0.8 first at'.padEnd(37)} │ ${results.map((res) => pad(`${f2(res.lock1)} s`, 20)).join(' ')}`)
  console.log(`      ${'r ≥ 0.8 again after the last cue at'.padEnd(37)} │ ${results.map((res) => pad(`${f2(res.lock2)} s`, 20)).join(' ')}`)
  const window = timeOf('Above it, they lock.') - timeOf('Below a certain coupling')
  console.log(`      the narration gives ${f2(window)} s between "Below a certain coupling" and "Above it, they lock."`)

  // across populations
  const spread = (cues: Cue[], name: string) => {
    const many = Array.from({ length: 16 }, (_, i) => play(cues, i + 1))
    const range = (xs: number[]) => {
      const v = [...xs].sort((a, b) => a - b)
      return `${f2(v[0])}–${f2(v[v.length - 1])}`
    }
    const at = (m: string) => range(many.map((x) => x.marks[MARKS.indexOf(m)].r))
    console.log(
      `      ${name}, 16 populations: r at "blinks as one" ${at('blinks as one')}, "the flashing is noise" ${at('the flashing is noise')}, "a core forms" ${at('a core forms and grows')}, "the stragglers" ${at('the stragglers fall in')}, "The pacemaker" ${at('The pacemaker cells')}; r ≥ 0.8 first at ${range(many.map((x) => x.lock1))} s, again at ${range(many.map((x) => x.lock2))} s`,
    )
  }
  spread(SCRIPTED, 'as scripted')
  spread(PROPOSED, 'proposed')

  // free dephasing from a locked tree, for timing any rewrite
  for (const K of [0.2, 0]) {
    const run = startRun(1.4)
    runTo(run, 20)
    const t0 = run.st.sim.time
    run.p.coupling = K
    const hits: number[] = [NaN, NaN, NaN]
    runTo(run, t0 + 30, FRAME, false, () => {
      ;[0.5, 0.3, 0.2].forEach((lvl, k) => {
        if (!(hits[k] >= 0) && run.st.sim.r < lvl) hits[k] = run.st.sim.time - t0
      })
    })
    console.log(`      locked at K = 1.4, then K = ${K} at once: r < 0.5 after ${f2(hits[0])} s, < 0.3 after ${f2(hits[1])} s, < 0.2 after ${f2(hits[2])} s (dephasing ~ e^{−σ²t²/2} at K = 0)`)
  }
  console.log()
}

// ---------------------------------------------------------------- 6. the frame loop
{
  const st = createStage()
  const p: FirefliesState = { coupling: 0.8, count: 1500, running: true, resetSerial: 7 }
  advanceStage(st, p, 0)
  check(st.sim.count === 1500 && st.sim.time === 0 && worldTele.firefliesCount === 1 && worldTele.firefliesT[0] === 0, 'first frame: a population for the store serial, one sample at t = 0')
  for (let i = 0; i < 600; i++) advanceStage(st, p, 1 / 60)
  let cadence = true
  for (let i = 1; i < worldTele.firefliesCount; i++) {
    const gap = worldTele.firefliesT[i] - worldTele.firefliesT[i - 1]
    if (gap < SAMPLE_EVERY - 1 / 60 - 1e-6 || gap > SAMPLE_EVERY + 1 / 60 + 1e-6) cadence = false
  }
  check(cadence && Math.abs(worldTele.firefliesCount - 101) <= 1, 'telemetry: a (t, r) sample every 0.1 simulated seconds', `${worldTele.firefliesCount} samples in ${f2(st.sim.time)} s`)
  check(worldTele.firefliesOrder === st.sim.r && worldTele.firefliesR[worldTele.firefliesCount - 1] <= 1, 'telemetry: firefliesOrder is r of the drawn phases')

  const kept = Float64Array.from(st.sim.theta.subarray(0, 1500))
  p.count = 2500
  advanceStage(st, { ...p, running: false }, 1 / 60)
  let same = true
  for (let i = 0; i < 1500; i++) if (st.sim.theta[i] !== kept[i]) same = false
  const fresh = new Kuramoto(2500, seedFor(7))
  let drawn = true
  for (let i = 1500; i < 2500; i++) if (st.sim.theta[i] !== fresh.theta[i] || st.sim.omega[i] !== fresh.omega[i]) drawn = false
  check(same && drawn && st.sim.count === 2500 && st.changed, 'a count change keeps the fireflies there and draws the newcomers from the population seed')

  const t = st.sim.time
  const n = worldTele.firefliesCount
  advanceStage(st, { ...p, running: false }, 1 / 60)
  check(st.sim.time === t && worldTele.firefliesCount === n && !st.changed, 'paused: frozen, no samples, no upload')

  advanceStage(st, p, 1)
  check(Math.abs(st.sim.time - t - MAX_FRAME) < 1e-12, 'a 1 s hitch integrates one capped frame', `${f3(st.sim.time - t)} s`)

  const before = st.sim.theta[0]
  advanceStage(st, { ...p, resetSerial: 8 }, 1 / 60)
  check(st.sim.time > 0 && st.sim.time < 0.02 && worldTele.firefliesCount === 1 && st.sim.theta[0] !== before, 'a new resetSerial: new clocks, time and series restart')

  const again = new Kuramoto(1500, seedFor(8))
  const other = new Kuramoto(1500, seedFor(9))
  check(again.theta[3] === new Kuramoto(1500, seedFor(8)).theta[3] && again.omega[3] !== other.omega[3], 'populations are reproducible per resetSerial and differ between serials')

  const q: FirefliesState = { coupling: 1, count: 100, running: true, resetSerial: 1 }
  const s2 = createStage()
  for (let i = 0; i < 25000; i++) advanceStage(s2, q, 1 / 60)
  check(worldTele.firefliesCount === SERIES_CAP && s2.sim.time > SERIES_CAP * SAMPLE_EVERY, 'the series stops at the cap while the tree runs on', `${worldTele.firefliesCount} samples at ${f2(s2.sim.time)} s`)

  // cost of a frame at the most fireflies
  const big = createStage()
  const pb: FirefliesState = { coupling: 1.2, count: 4000, running: true, resetSerial: 1 }
  for (let i = 0; i < 60; i++) advanceStage(big, pb, 1 / 60)
  const t0 = performance.now()
  const frames = 1200
  for (let i = 0; i < frames; i++) advanceStage(big, pb, 1 / 60)
  console.log(`      cost: ${f3((performance.now() - t0) / frames)} ms per frame at N = 4000 (Node, this machine)`)
}

if (failed) {
  console.log('\nSOME CHECKS FAILED')
  process.exit(1)
}
console.log('\nall checks passed')
