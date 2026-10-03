/**
 * Checks the Turing sphere's numerics and its presets:
 *   pnpm tsx src/world/turing/verify.ts            (about a minute)
 *   pnpm tsx src/world/turing/verify.ts --sphere   (adds ~2.5 min per preset on the sphere)
 *   pnpm tsx src/world/turing/verify.ts --sphere=labyrinth
 *
 * 1. The reduced grid (grid.ts): cell sizes, φ spacing, and the explicit-Euler stability bound
 *    Du·λmax (Gershgorin; must be ≤ 2), against the naive full-resolution grid that only treats
 *    the pole rows.
 * 2. Stability in practice: diffusion of a noisy flat field, naive grid against reduced grid.
 * 3. Conservation: diffusion alone keeps Σ area · u to rounding.
 * 4. Accuracy and isotropy: the discrete operator on zonal harmonics P_l(p · a) about a tilted
 *    axis a (∇²P_l = −l(l+1) P_l), by latitude band, up to the pattern's own wavelength (l = 64).
 * 5. Consistency: a diffusion step of SphereGS equals x + D·lap(x) (its two code paths agree).
 * 6. The presets on a flat 128 × 128 periodic grid, 6000 steps from the seeds (the same seeding,
 *    Du, Dv and dt as the sphere): mean V, connected components of V > 0.2, holes, shape, the RMS
 *    change of V over the last 200 steps, the component count every 1000 steps, the label checks.
 * 7. The presets reached from each other's finished coat through the component's dial glide
 *    (glide.ts), 6000 steps after the switch: the transition matrix the chapter and the instrument
 *    rely on. No coat may die; each must take its label, except where Gray–Scott's multistability
 *    keeps a spot field a spot field (listed as such, not failed).
 * 8. (--sphere) On the sphere itself, with the CPU reference of the GPU scheme: steps until the
 *    pattern reaches 50 / 90 / 99 % of the sphere from the seeds, and its cover by 30° latitude
 *    band (the poles must look like the equator).
 *
 * Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import { FlatGS, SphereGS, patternStats, rmsDiff, type PatternStats } from './cpu'
import { GLIDE_STEPS, glideDials, type Dials } from './glide'
import { DU, DV, GRID_H, GRID_W, MIN_PHI_SPACING, SEED_DISCS, SEED_NOISE, SEED_RADIUS, buildRows, diffusionCfl, mulberry32 } from './grid'
import { TURING_PRESETS, type TuringPreset } from './presets'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)} %`
const STEPS_PER_SECOND = 720 // 12 steps per frame at 60 Hz
const args = process.argv.slice(2)

console.log('Turing patterns: Gray–Scott on the sphere')
console.log(
  `  grid ${GRID_W} × ${GRID_H}, Du = ${DU}, Dv = ${DV}, dt = 1; seeds: ${SEED_DISCS} discs of radius ${SEED_RADIUS}, ${pct(SEED_NOISE, 0)} noise`,
)
console.log()

// ---------------------------------------------------------------- 1. the reduced grid
const rows = buildRows()
const naiveRows = buildRows(GRID_W, GRID_H, { naive: true })
{
  let minSp = Infinity
  let maxSp = 0
  let worstJump = 1
  for (let j = 1; j < GRID_H - 1; j++) {
    const sp = rows.m[j] * rows.sin[j]
    minSp = Math.min(minSp, sp)
    maxSp = Math.max(maxSp, sp)
    if (j > 1 && j < GRID_H - 2) worstJump = Math.max(worstJump, rows.m[j] / rows.m[j + 1], rows.m[j + 1] / rows.m[j])
  }
  const cells = rows.m.reduce((s, m) => s + GRID_W / m, 0)
  const cfl = diffusionCfl(rows)
  const naiveCfl = diffusionCfl(naiveRows)
  console.log(
    `reduced grid: ${cells} cells (${pct(cells / (GRID_W * GRID_H))} of the texels); poles one cell each, reading the mean of the ${rows.poleTaps} cells next to them`,
  )
  check(minSp >= MIN_PHI_SPACING - 1e-9 && maxSp < 2 * MIN_PHI_SPACING, 'φ spacing of every non-pole row within [0.8, 1.6) equator texels', `${minSp.toFixed(3)} … ${maxSp.toFixed(3)}`)
  check(worstJump <= 2, 'cell size changes by at most 2× between rows away from the poles (two taps suffice)', `worst ${worstJump}×`)
  check(rows.poleTaps === 8 && rows.m[1] === rows.m[GRID_H - 2], 'the rings next to both poles have the same 8 cells')
  check(cfl <= 2, 'explicit Euler stable: Du·λmax ≤ 2 on the reduced grid', `${cfl.toFixed(3)}; 5-point stencil at the equator ${(8 * DU).toFixed(2)}`)
  check(naiveCfl > 2, 'and unstable on the naive grid (only the pole rows treated), as claimed', `Du·λmax = ${naiveCfl.toFixed(0)}`)
  let lastBad = 0
  for (let j = 0; j < GRID_H / 2; j++) if (DU * (4 * naiveRows.cPhi[j] + 2 * (naiveRows.cN[j] + naiveRows.cS[j])) > 2) lastBad = j
  const deg = (((lastBad + 1) / GRID_H) * 180).toFixed(1)
  console.log(`      on the naive grid every row within ${deg}° of a pole is unstable (rows 1 … ${lastBad} and their mirror)`)
}

// ---------------------------------------------------------------- 2. stability in practice
{
  const run = (r: typeof rows) => {
    const s = new SphereGS(r, null)
    s.reaction = false
    const rand = mulberry32(7)
    for (let c = 0; c < s.cells; c++) {
      s.u[c] = 0.5 + 0.01 * (rand() - 0.5)
      s.v[c] = 0
    }
    s.step(0, 0, 40)
    let worst = 0
    for (let c = 0; c < s.cells; c++) worst = Math.max(worst, Math.abs(s.u[c] - 0.5))
    return worst
  }
  const naive = run(naiveRows)
  const reduced = run(rows)
  check(naive > 0.4, 'naive grid: ±0.5 % noise blows up within 40 diffusion steps (clamped at 0 and 1)', `max |u − ½| = ${naive.toFixed(3)}`)
  check(reduced < 0.005, 'reduced grid: the same noise decays', `max |u − ½| = ${reduced.toExponential(2)}`)
}

// ---------------------------------------------------------------- 3. conservation
{
  const s = new SphereGS(rows, null)
  s.reaction = false
  const rand = mulberry32(11)
  for (let c = 0; c < s.cells; c++) s.u[c] = 0.2 + 0.6 * rand()
  const m0 = s.integral(s.u)
  s.step(0, 0, 300)
  const m1 = s.integral(s.u)
  check(Math.abs(m1 - m0) / m0 < 1e-12, 'diffusion conserves Σ area · u (every face carries the same flux seen from both sides)', `relative change ${(Math.abs(m1 - m0) / m0).toExponential(1)} after 300 steps`)
  const area = s.integral(new Float64Array(s.cells).fill(1))
  const exact = (4 * Math.PI) / (Math.PI / GRID_H) ** 2
  check(Math.abs(area - exact) / exact < 1e-4, 'cell areas add up to the sphere (4π / h²)', `${area.toFixed(1)} vs ${exact.toFixed(1)}`)
}

// ---------------------------------------------------------------- 4. accuracy and isotropy
{
  const s = new SphereGS(rows, null)
  const p = s.cellCentres()
  const a = [1, 2, 0.7]
  const an = Math.hypot(a[0], a[1], a[2])
  const h = Math.PI / GRID_H
  const x = new Float64Array(s.cells)
  const lap = new Float64Array(s.cells)
  const bands = [
    { name: 'polar |lat| ≥ 60°', lo: 60, hi: 91 },
    { name: 'mid 30–60°', lo: 30, hi: 60 },
    { name: 'equatorial < 30°', lo: -1, hi: 30 },
  ]
  console.log('accuracy of h²∇² on P_l(p · a), a tilted 31° from the pole; relative RMS error by band (caps excluded):')
  for (const l of [8, 32, 64]) {
    for (let c = 0; c < s.cells; c++) x[c] = legendre(l, (p[c * 3] * a[0] + p[c * 3 + 1] * a[1] + p[c * 3 + 2] * a[2]) / an)
    s.laplacian(x, lap)
    const k2 = l * (l + 1) * h * h
    const parts: string[] = []
    let worst = 0
    for (const b of bands) {
      let num = 0
      let den = 0
      for (let j = 1; j < GRID_H - 1; j++) {
        const lat = Math.abs(90 - ((j + 0.5) / GRID_H) * 180)
        if (lat < b.lo || lat >= b.hi) continue
        const w = rows.sin[j] * rows.m[j]
        for (let g = 0; g < s.count[j]; g++) {
          const c = s.offset[j] + g
          num += w * (lap[c] + k2 * x[c]) ** 2
          den += w * (k2 * x[c]) ** 2
        }
      }
      const err = Math.sqrt(num / den)
      worst = Math.max(worst, err)
      parts.push(`${b.name} ${pct(err, 2)}`)
    }
    const wavelength = (2 * Math.PI) / Math.sqrt(l * (l + 1)) / h
    console.log(`      l = ${String(l).padStart(2)} (wavelength ${wavelength.toFixed(0).padStart(3)} texels): ${parts.join(', ')}`)
    if (l === 64) check(worst < 0.05, 'at the pattern scale (l = 64) the operator is within 5 % everywhere, poles included', `worst band ${pct(worst, 2)}`)
  }
}

// ---------------------------------------------------------------- 5. consistency of the CPU paths
{
  const s = new SphereGS(rows, null)
  s.reaction = false
  const rand = mulberry32(5)
  for (let c = 0; c < s.cells; c++) {
    s.u[c] = 0.3 + 0.4 * rand()
    s.v[c] = 0.3 + 0.4 * rand()
  }
  const u0 = Float64Array.from(s.u)
  const lap = new Float64Array(s.cells)
  s.laplacian(u0, lap)
  s.step(0, 0, 1)
  let worst = 0
  for (let c = 0; c < s.cells; c++) worst = Math.max(worst, Math.abs(s.u[c] - (u0[c] + DU * lap[c])))
  check(worst < 1e-14, 'a diffusion step equals u + Du·lap(u) (step and laplacian make the same taps)', `max difference ${worst.toExponential(1)}`)
}
console.log()

// ---------------------------------------------------------------- 6. the presets from the seeds
const N = 128
const holesOf = (st: PatternStats) => st.off.count - st.off.spanning
const isSpots = (st: PatternStats) => st.on.count >= 40 && st.on.spanning === 0 && holesOf(st) === 0 && st.on.elongation <= 1.3 && st.on.medianArea <= 80
const LABELS: Record<string, { rule: string; judge: (st: PatternStats, counts: number[]) => boolean }> = {
  spots: { rule: '≥ 40 separate round components (elongation ≤ 1.3, area ≤ 80), no holes', judge: (st) => isSpots(st) },
  stripes: {
    rule: '5 … 80 separate components, none wrapping, no holes, median elongation ≥ 2.2 (round spots are ~1.1)',
    judge: (st) => st.on.count >= 5 && st.on.count <= 80 && st.on.spanning === 0 && holesOf(st) === 0 && st.on.elongation >= 2.2,
  },
  labyrinth: {
    rule: 'a few large components (≤ 8, the largest ≥ 40 % of the pattern) joined in loops (holes, or wrapping), cover ≥ 35 %',
    judge: (st) => st.on.count <= 8 && st.on.largest >= 0.4 && (holesOf(st) >= 1 || st.on.spanning >= 1) && st.cover >= 0.35,
  },
  mitosis: {
    rule: 'spots whose number keeps growing (last ≥ 1.4 × the lowest count seen)',
    judge: (st, counts) => isSpots(st) && counts[counts.length - 1] >= 1.4 * Math.min(...counts),
  },
  holes: {
    rule: 'one wrapping component with ≥ 40 round holes (hole elongation ≤ 1.5)',
    judge: (st) => st.on.count === 1 && st.on.spanning === 1 && holesOf(st) >= 40 && st.off.elongation <= 1.5,
  },
}

const fmtRow = (cells: (string | number)[], widths: number[]) => cells.map((c, i) => String(c).padStart(widths[i])).join('  ')
const W6 = [10, 6, 6, 6, 5, 5, 5, 5, 5, 5, 8, 34]
console.log('presets, flat 128 × 128 periodic grid, 6000 steps from the seeds (V > 0.2 is "pattern"):')
console.log(fmtRow(['preset', 'f', 'k', 'mean V', 'comp', 'wrap', 'holes', 'area', 'elong', 'h.el', 'rms200', 'components at 1000, 2000 … 6000'], W6))
const settled: Record<string, FlatGS> = {}
for (const p of TURING_PRESETS) {
  const s = new FlatGS(N)
  const counts: number[] = []
  let prev: Float64Array | null = null
  for (let t = 1; t <= 6; t++) {
    if (t === 6) {
      s.step(p.feed, p.kill, 800)
      prev = Float64Array.from(s.v)
      s.step(p.feed, p.kill, 200)
    } else s.step(p.feed, p.kill, 1000)
    counts.push(patternStats(s.v, N).on.count)
  }
  const st = patternStats(s.v, N)
  settled[p.id] = s
  console.log(
    fmtRow(
      [
        p.id,
        p.feed.toFixed(4),
        p.kill.toFixed(4),
        st.meanV.toFixed(3),
        st.on.count,
        st.on.spanning,
        holesOf(st),
        Math.round(st.on.medianArea),
        st.on.elongation.toFixed(2),
        st.off.elongation.toFixed(2),
        rmsDiff(prev!, s.v).toExponential(1),
        counts.join(', '),
      ],
      W6,
    ),
  )
  const rule = LABELS[p.id]
  if (rule) check(rule.judge(st, counts), `  "${p.label}": ${rule.rule}`)
  else check(false, `  "${p.label}": no label rule for id '${p.id}'`)
}
console.log('      (comp: components; wrap: components that wrap the torus; area / elong: median over components;')
console.log('       h.el: median elongation of the holes; rms200: RMS change of V over the last 200 steps)')
console.log()

// ---------------------------------------------------------------- 7. transitions through the glide
/** spot fields are stable throughout the spot and worm regimes: switching between them changes nothing */
const MULTISTABLE: Record<string, string[]> = { stripes: ['spots', 'mitosis'], mitosis: ['spots'] }
console.log(`transitions: each preset's finished coat, dials glided (${GLIDE_STEPS} steps) to another preset, 6000 steps on:`)
for (const from of TURING_PRESETS) {
  for (const to of TURING_PRESETS) {
    if (from.id === to.id) continue
    const s = new FlatGS(N)
    s.u.set(settled[from.id].u)
    s.v.set(settled[from.id].v)
    const counts = glideRun(s, from, to, 6000, 1200)
    const st = patternStats(s.v, N)
    const alive = st.cover > 0.05
    const known = MULTISTABLE[to.id]?.includes(from.id)
    const label = LABELS[to.id].judge(st, counts)
    const desc = `${st.on.count}${st.on.spanning ? ' (wraps)' : ''} comps, largest ${pct(st.on.largest, 0)}, elong ${st.on.elongation.toFixed(1)}, ${holesOf(st)} holes, cover ${pct(st.cover, 0)}; counts ${counts.join(', ')}`
    if (known && alive && isSpots(st)) console.log(`same  ${from.id} → ${to.id}: stays spots (multistable)  ${desc}`)
    else check(alive && label, `${from.id} → ${to.id}`, desc)
  }
}
console.log()

// ---------------------------------------------------------------- 8. on the sphere
const sphereArg = args.find((a) => a === '--sphere' || a.startsWith('--sphere='))
if (sphereArg) {
  const only = sphereArg.includes('=') ? sphereArg.split('=')[1] : null
  console.log('on the sphere (CPU reference of the GPU scheme), from the seeds, 36000 steps (50 s at 720 steps/s):')
  for (const p of TURING_PRESETS) {
    if (only && p.id !== only) continue
    sphereRun(p)
  }
} else {
  console.log('(run with --sphere for the coverage times and latitude bands on the sphere itself)')
}

console.log()
console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

// ---------------------------------------------------------------- helpers

/** Run `steps` steps in 12-step frames with the dials gliding from `a` to `b`; component counts at the switch and every `every` steps. */
function glideRun(s: FlatGS, a: TuringPreset, b: TuringPreset, steps: number, every: number): number[] {
  const d: Dials = { f: a.feed, k: a.kill, vf: 0, vk: 0 }
  // the coat as it was at the switch, then every `every` steps
  const counts: number[] = [patternStats(s.v, N).on.count]
  for (let t = 0; t < steps; t += 12) {
    glideDials(d, b.feed, b.kill, 12)
    s.step(d.f, d.k, 12)
    if ((t + 12) % every === 0) counts.push(patternStats(s.v, N).on.count)
  }
  return counts
}

function legendre(l: number, x: number): number {
  let p0 = 1
  let p1 = x
  if (l === 0) return 1
  for (let n = 1; n < l; n++) {
    const p2 = ((2 * n + 1) * x * p1 - n * p0) / (n + 1)
    p0 = p1
    p1 = p2
  }
  return p1
}

/** Coverage over time and latitude bands for one preset on the sphere. */
function sphereRun(p: TuringPreset): void {
  const s = new SphereGS(rows)
  const probes = coverageProbes(s, 3000, 8)
  const coverage = () => {
    let hit = 0
    for (const pr of probes) {
      for (let i = 0; i < pr.length; i++) {
        if (s.v[pr[i]] > 0.2) {
          hit++
          break
        }
      }
    }
    return hit / probes.length
  }
  const marks: (number | null)[] = [null, null, null]
  const thresholds = [0.5, 0.9, 0.99]
  const every = 720
  for (let t = every; t <= 36000; t += every) {
    s.step(p.feed, p.kill, every)
    const c = coverage()
    for (let i = 0; i < 3; i++) if (marks[i] === null && c >= thresholds[i]) marks[i] = t
  }
  const bandCover: string[] = []
  let lo = Infinity
  let hi = 0
  for (let b = 0; b < 6; b++) {
    let area = 0
    let on = 0
    for (let j = Math.floor((b * GRID_H) / 6); j < Math.floor(((b + 1) * GRID_H) / 6); j++) {
      const w = rows.sin[j] * rows.m[j]
      for (let g = 0; g < s.count[j]; g++) {
        area += w
        if (s.v[s.offset[j] + g] > 0.2) on += w
      }
    }
    bandCover.push(pct(on / area, 0))
    lo = Math.min(lo, on / area)
    hi = Math.max(hi, on / area)
  }
  const sec = (t: number | null) => (t === null ? 'not reached' : `${t} steps (${(t / STEPS_PER_SECOND).toFixed(0)} s)`)
  console.log(`  ${p.id}: 50 % ${sec(marks[0])}, 90 % ${sec(marks[1])}, 99 % ${sec(marks[2])}`)
  console.log(`      cover (V > 0.2) by 30° band, north to south: ${bandCover.join(' ')}`)
  check(marks[2] !== null, `  ${p.id} covers the sphere from the seeds within 50 s`)
  check(hi > 0 && (hi - lo) / hi < 0.15, `  ${p.id}: the poles look like the equator (band covers within 15 % of each other)`)
}

/** For each of `n` Fibonacci points, the cells within `radius` equator texels (geodesic). */
function coverageProbes(s: SphereGS, n: number, radius: number): Int32Array[] {
  const dth = Math.PI / GRID_H
  const cosR = Math.cos(radius * dth)
  const out: Int32Array[] = []
  for (let q = 0; q < n; q++) {
    const z = 1 - (2 * (q + 0.5)) / n
    const phi = q * Math.PI * (3 - Math.sqrt(5))
    const th = Math.acos(z)
    const r = Math.sqrt(1 - z * z)
    const cx = r * Math.cos(phi)
    const cz = r * Math.sin(phi)
    const found: number[] = []
    const j0 = Math.max(0, Math.floor(th / dth - radius - 2))
    const j1 = Math.min(GRID_H - 1, Math.ceil(th / dth + radius + 2))
    for (let j = j0; j <= j1; j++) {
      const t = (j + 0.5) * dth
      const st = Math.sin(t)
      const ct = Math.cos(t)
      const m = rows.m[j]
      for (let g = 0; g < s.count[j]; g++) {
        let best = -2
        for (let i = 0; i < m; i += Math.max(1, m >> 3)) {
          const ph = (2 * Math.PI * (g * m + i + 0.5)) / GRID_W
          best = Math.max(best, st * Math.cos(ph) * cx + ct * z + st * Math.sin(ph) * cz)
        }
        if (best >= cosR) found.push(s.offset[j] + g)
      }
    }
    out.push(Int32Array.from(found))
  }
  return out
}
