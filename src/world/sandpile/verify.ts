/**
 * Checks for the sandpile stage. Run: pnpm tsx src/world/sandpile/verify.ts
 *
 *  1. avalanche sizes: 300,000 random grains on a 128 x 128 pile started uniformly 0..3; the
 *     log-binned histogram and the fitted exponent of P(size)
 *  2. the mean avalanche size in the stationary state against Dhar's exact result
 *     ⟨s⟩ = mean over x of Σ_y G(x, y), G the inverse of the grid Laplacian (solved here by CG)
 *  3. the abelian property: 2^16 grains on the centre of an empty 101 x 101 grid, relaxed by
 *     sweeps, equals the same grains added one at a time with a full stack relaxation each
 *     (same final grid, same total topplings), and the stack relaxation of all of them at once
 *  4. the stage's single-source pattern: time, nothing lost over the edge, D4 symmetry; and
 *     what 2^18 grains do to the same grid
 *  5. the stage's critical start: recurrent (Dhar's burning test), height statistics against
 *     the exact stationary values, avalanche sizes from the first grain
 *  6. the frame loop: running/rate/cap/budget, frame-rate independence, centre mode, flash
 *     timing, telemetry, and how much of the grid is lit at the chapter's rates
 */
import type { SandpileState } from '../../fractal/types'
import { worldTele } from '../telemetry'
import {
  buildCriticalPile,
  buildSingleSource,
  centreIndex,
  createPile,
  dropGrain,
  dropMany,
  grainsOn,
  IDENTITY_GRAINS,
  interior,
  isRecurrent,
  loadInterior,
  mulberry32,
  randomSite,
  relaxSweeps,
  SAND_N,
  seedUniform,
} from './pile'
import {
  createSim,
  FLASH_SECONDS,
  holdForReset,
  loadPile,
  MAX_GRAINS_PER_FRAME,
  MAX_TOPPLINGS_PER_FRAME,
  seedFor,
  stepSim,
  writeTexture,
} from './sim'

let failed = false
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed = true
}
const info = (label: string) => console.log(`      ${label}`)
const ms = (t0: number) => `${(performance.now() - t0).toFixed(0)} ms`
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Mean over sites of Σ_y G(x, y): solve (4I − A) u = 1 with Dirichlet edges by CG, average u. */
function dharMeanAvalanche(n: number): number {
  const N = n * n
  const u = new Float64Array(N)
  const r = new Float64Array(N).fill(1)
  const p = new Float64Array(N).fill(1)
  const q = new Float64Array(N)
  let rr = N
  for (let it = 0; it < 20 * n && rr > 1e-20 * N; it++) {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x
        let s = 4 * p[i]
        if (x > 0) s -= p[i - 1]
        if (x < n - 1) s -= p[i + 1]
        if (y > 0) s -= p[i - n]
        if (y < n - 1) s -= p[i + n]
        q[i] = s
      }
    let pq = 0
    for (let i = 0; i < N; i++) pq += p[i] * q[i]
    const alpha = rr / pq
    let rr2 = 0
    for (let i = 0; i < N; i++) {
      u[i] += alpha * p[i]
      r[i] -= alpha * q[i]
      rr2 += r[i] * r[i]
    }
    const beta = rr2 / rr
    rr = rr2
    for (let i = 0; i < N; i++) p[i] = r[i] + beta * p[i]
  }
  let s = 0
  for (let i = 0; i < N; i++) s += u[i]
  return s / N
}

/** Least-squares slope of y on x. */
function slope(xs: number[], ys: number[]): number {
  const k = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / k
  const my = ys.reduce((a, b) => a + b, 0) / k
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < k; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  return sxy / sxx
}

/**
 * Fit P(s) ∝ s^−τ on log-binned counts: bin i holds sizes [2^i, 2^(i+1)), 2^i integers wide, so
 * the density is count / (total · 2^i), placed at the bin's geometric centre.
 */
function fitTau(hist: Float64Array, lo: number, hi: number): number {
  let total = 0
  for (let i = 0; i < hist.length; i++) total += hist[i]
  const xs: number[] = []
  const ys: number[] = []
  for (let i = lo; i <= hi; i++) {
    if (hist[i] <= 0) continue
    xs.push(0.5 * (i + Math.log2(2 ** (i + 1) - 1)))
    ys.push(Math.log2(hist[i] / (total * 2 ** i)))
  }
  return -slope(xs, ys)
}

function printHistogram(hist: Float64Array) {
  let total = 0
  let last = 0
  for (let i = 0; i < hist.length; i++) {
    total += hist[i]
    if (hist[i] > 0) last = i
  }
  info('bin  sizes              count     P(bin)    P(s) per size')
  for (let i = 0; i <= last; i++) {
    const lo = 2 ** i
    const hi = 2 ** (i + 1) - 1
    const range = lo === hi ? `${lo}` : `${lo}-${hi}`
    info(
      `${String(i).padStart(3)}  ${range.padEnd(17)} ${String(hist[i]).padStart(7)}   ${(hist[i] / total).toExponential(2)}  ${(hist[i] / total / lo).toExponential(2)}`,
    )
  }
}

// ---------------------------------------------------------------- 1. power law, 2. Dhar's mean
{
  const n = 128
  const GRAINS = 300_000
  const WARM = 20_000 // the uniform start (density 1.5) needs ~10k grains to reach criticality
  const p = createPile(n)
  const rand = mulberry32(2024)
  seedUniform(p, rand)
  const all = new Float64Array(24)
  const stationary = new Float64Array(24)
  let sumS = 0
  let countS = 0
  let maxS = 0
  let quiet = 0
  const t0 = performance.now()
  for (let g = 0; g < GRAINS; g++) {
    const s = dropGrain(p, randomSite(p, rand), null)
    if (g >= WARM) {
      sumS += s
      countS++
    }
    if (s === 0) {
      quiet++
      continue
    }
    const bin = Math.min(23, 31 - Math.clz32(s))
    all[bin]++
    if (g >= WARM) stationary[bin]++
    if (s > maxS) maxS = s
  }
  console.log(`\n1. ${GRAINS.toLocaleString('en-US')} random grains on ${n} x ${n}, uniform 0..3 start (${ms(t0)})`)
  info(`${quiet.toLocaleString('en-US')} grains caused no toppling (${((quiet / GRAINS) * 100).toFixed(1)}%), largest avalanche ${maxS.toLocaleString('en-US')} topplings`)
  printHistogram(all)
  const [lo, hi] = [2, 11]
  const tau = fitTau(all, lo, hi)
  const tauStat = fitTau(stationary, lo, hi)
  info(`fit over bins ${lo}..${hi} (sizes 4..4095; bins 0-1 are lattice-scale, above ~2^12 the 128 grid cuts off):`)
  info(`  all grains: P(s) ~ s^-${tau.toFixed(3)}; after the first ${WARM.toLocaleString('en-US')}: s^-${tauStat.toFixed(3)}`)
  info(`  narrower bins 3..10: s^-${fitTau(all, 3, 10).toFixed(3)}; wider 1..12: s^-${fitTau(all, 1, 12).toFixed(3)}`)
  check(tau > 1.0 && tau < 1.35, `exponent τ = ${tau.toFixed(3)} is in the 2D BTW range (≈ 1.0–1.3)`)

  const exact = dharMeanAvalanche(n)
  const measured = sumS / countS
  const err = Math.abs(measured / exact - 1)
  check(err < 0.05, `2. mean avalanche size after warm-up ${measured.toFixed(1)} vs Dhar's exact ${exact.toFixed(1)} (${(err * 100).toFixed(1)}% off)`)
}

// ---------------------------------------------------------------- 3. abelian property
{
  const n = 101
  const N = 2 ** 16
  console.log(`\n3. ${N.toLocaleString('en-US')} grains on the centre of an empty ${n} x ${n} grid`)
  let t0 = performance.now()
  const a = createPile(n)
  a.h[centreIndex(a)] = N
  const sw = relaxSweeps(a)
  const tSweeps = ms(t0)
  t0 = performance.now()
  const b = createPile(n)
  const c = centreIndex(b)
  let naiveTopplings = 0
  for (let g = 0; g < N; g++) naiveTopplings += dropGrain(b, c, null)
  const tNaive = ms(t0)
  t0 = performance.now()
  const d = createPile(n)
  const stackTopplings = dropMany(d, centreIndex(d), N)
  const tStack = ms(t0)
  const ga = interior(a)
  const gb = interior(b)
  info(`sweeps: ${sw.sweeps} sweeps, ${sw.topplings.toLocaleString('en-US')} topplings, ${tSweeps}`)
  info(`grain by grain: ${naiveTopplings.toLocaleString('en-US')} topplings, ${tNaive}; all at once on the stack: ${tStack}`)
  info(`${(N - grainsOn(a)).toLocaleString('en-US')} grains fell off the edge (the pile outgrows this grid, so the edge is exercised too)`)
  check(same(ga, gb), 'sweep relaxation and grain-by-grain stabilisation give the identical final grid')
  check(sw.topplings === naiveTopplings && stackTopplings === naiveTopplings, 'and the identical number of topplings (sweeps, grain by grain, stack)')
  check(same(ga, interior(d)), 'stack relaxation of all grains at once gives the same grid')
  let stable = true
  for (let i = 0; i < ga.length; i++) if (ga[i] > 3) stable = false
  check(stable, 'the result is stable (every site 0..3)')
}

// ---------------------------------------------------------------- 4. the stage's pattern
{
  const n = SAND_N
  console.log(`\n4. the single-source pattern: ${IDENTITY_GRAINS.toLocaleString('en-US')} grains on ${n} x ${n}`)
  const t0 = performance.now()
  const r = buildSingleSource(n, IDENTITY_GRAINS)
  const t = performance.now() - t0
  const g = r.grid
  const c = (n - 1) / 2
  let half = 0
  const counts = [0, 0, 0, 0]
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = g[y * n + x]
      counts[v]++
      if (v > 0) half = Math.max(half, Math.abs(x - c), Math.abs(y - c))
    }
  info(`${r.sweeps} sweeps, ${r.topplings.toLocaleString('en-US')} topplings, ${t.toFixed(0)} ms on this machine (main thread of node; the browser worker is similar)`)
  info(`pile reaches ${half} sites from the centre of ${c}; sites with 0/1/2/3 grains: ${counts.join(' / ')}`)
  check(r.lost === 0 && half < c, 'no grain reaches the edge: the pattern is the infinite-plane single-source pile')
  let d4 = true
  for (let y = 0; y < n && d4; y++)
    for (let x = 0; x < n; x++) {
      const v = g[y * n + x]
      if (v !== g[x * n + y] || v !== g[y * n + (n - 1 - x)] || v !== g[(n - 1 - y) * n + x]) {
        d4 = false
        break
      }
    }
  check(d4, 'the pattern has the square’s full symmetry (both mirrors and the diagonal)')
  const t1 = performance.now()
  const big = buildSingleSource(n, 2 ** 18)
  info(
    `for comparison, 2^18 = 262,144 grains on the same grid: ${big.lost.toLocaleString('en-US')} grains (${((big.lost / 2 ** 18) * 100).toFixed(0)}%) fall off the edge, ${ms(t1)}`,
  )
}

// ---------------------------------------------------------------- 5. the stage's critical start
{
  const n = SAND_N
  console.log(`\n5. the live pile's start on ${n} x ${n}`)
  const t0 = performance.now()
  const built = buildCriticalPile(n, seedFor(0))
  const t = ms(t0)
  info(`uniform 0..3, ${built.poured.toLocaleString('en-US')} grains poured one at a time, ${built.rounds} burning rounds: ${t}`)
  const p = createPile(n)
  loadInterior(p, built.grid)
  check(isRecurrent(p), 'the start is recurrent (Dhar’s burning test: every site topples exactly once)')
  // exact stationary single-site probabilities (Priezzhev 1994)
  const pi = Math.PI
  const exact = [
    2 / pi ** 2 - 4 / pi ** 3,
    1 / 4 - 1 / (2 * pi) - 3 / pi ** 2 + 12 / pi ** 3,
    3 / 8 + 1 / pi - 12 / pi ** 3,
    3 / 8 - 1 / (2 * pi) + 1 / pi ** 2 + 4 / pi ** 3,
  ]
  const got = [0, 0, 0, 0]
  for (let i = 0; i < built.grid.length; i++) got[built.grid[i]]++
  for (let k = 0; k < 4; k++) got[k] /= n * n
  const worst = Math.max(...got.map((v, k) => Math.abs(v - exact[k])))
  check(
    worst < 0.005,
    `P(0..3) = ${got.map((v) => v.toFixed(4)).join(' ')} vs exact ${exact.map((v) => v.toFixed(4)).join(' ')} (worst ${worst.toFixed(4)})`,
  )
  const dhar = dharMeanAvalanche(n)
  const rand = mulberry32(5)
  let s = 0
  const K = 5000
  for (let g = 0; g < K; g++) s += dropGrain(p, randomSite(p, rand), null)
  const first = s / K
  const u = createPile(n)
  seedUniform(u, mulberry32(seedFor(0)))
  let su = 0
  for (let g = 0; g < K; g++) su += dropGrain(u, randomSite(u, rand), null)
  check(
    Math.abs(first / dhar - 1) < 0.15,
    `first ${K.toLocaleString('en-US')} grains average ${first.toFixed(0)} topplings vs the stationary ${dhar.toFixed(0)} (Dhar); a plain uniform start: ${(su / K).toFixed(1)}`,
  )
}

// ---------------------------------------------------------------- 6. the frame loop
{
  console.log('\n6. the frame loop')
  const n = SAND_N
  const start = buildCriticalPile(n, seedFor(0)).grid
  const state = (patch: Partial<SandpileState>): SandpileState => ({
    running: true,
    rate: 200,
    mode: 'random',
    identity: false,
    resetSerial: 0,
    ...patch,
  })
  const data = new Uint8Array(n * n * 4)
  const histTotal = () => worldTele.sandHistogram.reduce((a, b) => a + b, 0)

  // paused: nothing falls
  const sim = createSim(n)
  loadPile(sim, start, 0)
  for (let f = 0; f < 120; f++) stepSim(sim, state({ running: false }), 1 / 60)
  check(worldTele.sandGrains === 0 && same(interior(sim.pile), start), 'running = false drops nothing')

  // frame-rate independence: the grid depends only on how many grains have fallen. Pour for
  // 10 s, then let any avalanche still running and any grains still owed finish.
  const drain = (s: ReturnType<typeof createSim>, fps: number) => {
    let grains = 0
    for (let f = 0; f < 600 && (s.pile.top > 0 || s.acc >= 1); f++) {
      stepSim(s, state({ rate: 0 }), 1 / fps)
      grains += s.grains
    }
    return grains
  }
  const run = (fps: number, seconds: number) => {
    const s = createSim(n)
    loadPile(s, start, 0)
    let spread = 0
    for (let f = 0; f < fps * seconds; f++) {
      stepSim(s, state({}), 1 / fps)
      if (s.pile.top > 0) spread++
    }
    drain(s, fps)
    return { grid: interior(s.pile), grains: worldTele.sandGrains, spread }
  }
  const r30 = run(30, 10)
  const r60 = run(60, 10)
  const r144 = run(144, 10)
  check(
    r30.grains === 2000 && r60.grains === 2000 && r144.grains === 2000,
    `200 grains/s for 10 s drops ${r30.grains} / ${r60.grains} / ${r144.grains} grains at 30 / 60 / 144 fps`,
  )
  check(same(r30.grid, r60.grid) && same(r60.grid, r144.grid), 'and leaves the identical grid at every frame rate')
  info(`frames that ended with an avalanche still running (budget reached): ${r30.spread} / ${r60.spread} / ${r144.spread}`)

  // telemetry: every grain counted, every avalanche binned, against a replay of the same drops
  {
    const s = createSim(n)
    loadPile(s, start, 0)
    let grains = 0
    for (let f = 0; f < 1200; f++) {
      stepSim(s, state({ rate: 500 }), 1 / 60)
      grains += s.grains
    }
    grains += drain(s, 60)
    const shadow = createPile(n)
    loadInterior(shadow, start)
    const rand = mulberry32(seedFor(0) ^ 0x2545_f491)
    let avalanches = 0
    let last = 0
    for (let k = 0; k < grains; k++) {
      const t = dropGrain(shadow, randomSite(shadow, rand), null)
      if (t > 0) {
        avalanches++
        last = t
      }
    }
    check(
      worldTele.sandGrains === grains && histTotal() === avalanches && worldTele.sandLastAvalanche === last && same(interior(s.pile), interior(shadow)),
      `telemetry: ${grains} grains, ${avalanches} avalanches binned, last ${last} topplings, final grid: all match a replay`,
    )
    holdForReset(s)
    check(worldTele.sandGrains === 0 && histTotal() === 0 && !s.ready, 'a reset clears the counters and stops pouring until the fresh pile lands')
    stepSim(s, state({}), 1 / 60)
    check(s.grains === 0, 'nothing falls while the fresh pile is on its way')
  }

  // cap and budget
  {
    const s = createSim(n)
    loadPile(s, start, 0)
    let worstGrains = 0
    let worstTopplings = 0
    let worstMs = 0
    for (let f = 0; f < 240; f++) {
      const t0 = performance.now()
      stepSim(s, state({ rate: 1e9 }), 1 / 60)
      if (f >= 30) worstMs = Math.max(worstMs, performance.now() - t0) // after JIT warm-up
      worstGrains = Math.max(worstGrains, s.grains)
      worstTopplings = Math.max(worstTopplings, s.topplings)
    }
    check(
      worstGrains <= MAX_GRAINS_PER_FRAME && s.acc <= MAX_GRAINS_PER_FRAME,
      `an absurd rate drops at most ${worstGrains} grains a frame and owes at most ${MAX_GRAINS_PER_FRAME}`,
    )
    check(
      worstTopplings <= MAX_TOPPLINGS_PER_FRAME + 8,
      `no frame runs more than the budget: worst ${worstTopplings.toLocaleString('en-US')} topplings (budget ${MAX_TOPPLINGS_PER_FRAME.toLocaleString('en-US')}), ${worstMs.toFixed(1)} ms`,
    )
    const e = createSim(n)
    loadPile(e, new Uint8Array(n * n), 0)
    stepSim(e, state({ rate: 3 * 60, mode: 'centre' }), 1 / 60)
    const g = interior(e.pile)
    const c = ((n - 1) / 2) * n + (n - 1) / 2
    check(g[c] === 3 && grainsOn(e.pile) === 3, "mode 'centre' drops on the centre site")
    // an avalanche keeps running while paused; nothing new falls
    const q = createSim(n)
    loadPile(q, start, 0)
    let f = 0
    while (q.pile.top === 0 && f++ < 100000) stepSim(q, state({ rate: 5000 }), 1 / 60)
    const before = worldTele.sandGrains
    let frames = 0
    while (q.pile.top > 0 && frames++ < 100) stepSim(q, state({ running: false }), 1 / 60)
    check(q.pile.top === 0 && worldTele.sandGrains === before, `paused mid-avalanche: it finishes over ${frames} more frame(s), no new grains`)
  }

  // flashes: full on the frame of the toppling, gone after FLASH_SECONDS
  {
    const s = createSim(n)
    loadPile(s, start, 0)
    let f = 0
    while (s.topplings === 0 && f < 10000) {
      stepSim(s, state({ rate: 60 }), 1 / 60)
      f++
    }
    let site = -1
    for (let i = 0; i < s.heat.length && site < 0; i++) if (s.heat[i] === 1) site = i
    const y = Math.floor(site / s.pile.w) - 1
    const x = (site % s.pile.w) - 1
    const k = (y * n + x) * 4 + 1
    writeTexture(s, data, 1 / 60)
    const first = data[k]
    let frames = 1
    for (; frames < 120; frames++) {
      stepSim(s, state({ running: false }), 1 / 60)
      writeTexture(s, data, 1 / 60)
      if (data[k] === 0) break
    }
    check(
      first === 255 && Math.abs(frames / 60 - FLASH_SECONDS) <= 1.01 / 60,
      `a toppled site flashes at ${first} and is dark ${frames} frames (${(frames / 60).toFixed(3)} s) later`,
    )
    let more = 0
    while (writeTexture(s, data, 1 / 60) && more < 1000) more++
    check(!writeTexture(s, data, 1 / 60), 'once paused and every flash has faded, the texture is not rewritten')
  }

  // how much of the grid is lit, and what a frame costs, at the chapter's rates
  {
    info('at 60 fps, 20 s at each rate after 10 s of warm-up (lit: flash > 0; bright: flash > 1/2, i.e. drawn > 1/4 of the way to white):')
    for (const [rate, flash] of [[20, 0.4], [200, 0.4], [500, 0.4], [2000, 0.4], [200, 0.15], [2000, 0.1]]) {
      const s = createSim(n)
      loadPile(s, start, 0)
      s.flashSeconds = flash
      let lit = 0
      let bright = 0
      let samples = 0
      let work = 0
      let worst = 0
      for (let f = 0; f < 60 * 30; f++) {
        const t0 = performance.now()
        stepSim(s, state({ rate }), 1 / 60)
        writeTexture(s, data, 1 / 60)
        const dt = performance.now() - t0
        if (f >= 60 * 10) {
          work += dt
          worst = Math.max(worst, dt)
          let a = 0
          let b = 0
          for (let k = 1; k < data.length; k += 4) {
            if (data[k] > 0) a++
            if (data[k] > 127) b++
          }
          lit += a / (n * n)
          bright += b / (n * n)
          samples++
        }
      }
      info(
        `  ${String(rate).padStart(4)} grains/s, flash ${flash.toFixed(2)} s: lit ${((lit / samples) * 100).toFixed(1)}%, bright ${((bright / samples) * 100).toFixed(1)}%; sim + texture ${(work / samples).toFixed(2)} ms/frame mean, ${worst.toFixed(1)} ms worst`,
      )
    }
  }

  // what the chart will see on the stage's grid
  {
    const s = createSim(n)
    loadPile(s, start, 0)
    for (let f = 0; f < 60 * 120; f++) stepSim(s, state({ rate: 500 }), 1 / 60)
    const h = worldTele.sandHistogram
    let total = 0
    let beyond = 0
    let top = 0
    for (let i = 0; i < h.length; i++) {
      total += h[i]
      if (i >= 16) beyond += h[i]
      if (h[i] > 0) top = i
    }
    info(`stage grid, 2 minutes at 500 grains/s: ${total.toLocaleString('en-US')} avalanches, largest in bin ${top} (≥ ${(2 ** top).toLocaleString('en-US')} topplings), ${beyond} (${((beyond / total) * 100).toFixed(2)}%) in bins ≥ 16`)
    info(`  counts per bin 0..${top}: ${Array.from(h.subarray(0, top + 1)).join(' ')}`)
    info(`  stage-grid fit, bins 2..13: P(s) ~ s^-${fitTau(h, 2, 13).toFixed(3)}`)
  }
}

console.log(failed ? '\nSOME CHECKS FAILED' : '\nall checks passed')
if (failed) process.exitCode = 1
