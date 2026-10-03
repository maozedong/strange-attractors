/**
 * Checks the Lenia stage:  pnpm tsx src/world/lenia/verify.ts [--layout]
 *
 * 1. Kernel texture: buildKernel (the exact Float32Array the stage uploads) against an
 *    independent float64 evaluation of Chan's exponential-bump shell at 1000 random
 *    (species, tap) points. Also: weights sum to 1, the texture's outer ring is zero (R ≤ 13),
 *    and the kernel is symmetric under quarter turns and mirroring.
 * 2. Growth and update: the growth and update lines are cut out of stepFrag's own source,
 *    transcribed to JS and compared with G(u) = 2 exp(−((u − m)/s)² / 2) − 1 and
 *    clip(A + G/T, 0, 1) at 1000 random points; plus the error of evaluating the same
 *    expression in float32 (what the GPU does). Also checks the kernel texel ↔ cell offset
 *    mapping the shader uses.
 * 3. The blob counter used for leniaBlobs, on synthetic fields (including one across the seam).
 * 4. Every species alone on a 128 × 128 torus, CPU reference of the same update, 500
 *    generations: mass every 50 (and its range against generation 0), centroid displacement
 *    and farthest excursion, principal-axis rotation, mass period, and the blob count at every
 *    generation (the stage's definition: 8 × 8-cell blocks with mean A > 0.1); then a
 *    per-species check of the behaviour it is catalogued for (glider, spinner, pulsar).
 * 5. (--layout, ~6 min) The stage's own start: three copies at SEED_LAYOUT on 256², for 2000
 *    generations: blob count and mass every 100, the first generation the blob count drops
 *    (two creatures merging or one dying) and the first the mass drops by 10 % (one dying).
 * 6. (--gpu) The real GPU: bundles gpu-check.ts with Vite's build API (no dev server), runs it
 *    in a throwaway headless Chrome (own profile, no debugging port; CHROME=/path overrides
 *    the browser) and compares LeniaSim with the CPU reference on 256²: one and two
 *    generations from random noise, the stage's seed to generation 100 (--gpu-gens=1,10,500
 *    to change), the telemetry reduction, the display shader, an async readback.
 *
 * Sections 1–4 check that the shader computes the same function as the reference; only 6
 * runs it. Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { KERNEL_DIAMETER, KERNEL_RADIUS, SEED_LAYOUT, buildKernel, countBlobs, growth, stampPattern } from './core'
import { CpuLenia } from './cpu'
import type { GpuCheckResult } from './gpu-check'
import { LENIA_GRID, TELE_GRID, stepFrag } from './shaders'
import { LENIA_SPECIES, type LeniaSpecies } from './species'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const fmt = (x: number, d = 3) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(d))
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(2)} %`

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** What each species is catalogued to do; the check in section 4. */
const EXPECT: Record<string, 'glider' | 'spinner' | 'pulsar'> = {
  orbium: 'glider',
  spinner: 'spinner',
  pulsar: 'pulsar',
  shield: 'glider',
}

console.log(`Lenia: ${LENIA_SPECIES.length} species, kernel texture ${KERNEL_DIAMETER}², grid ${LENIA_GRID}² on the GPU, 128² here`)
console.log()

// ---------------------------------------------------------------- 1. kernel texture
{
  console.log('1. kernel texture')
  /** independent reference: written out again, float64, no shared helpers */
  const refShell = (d: number, sp: LeniaSpecies) => {
    const r = d / sp.R
    if (r >= 1) return 0
    const B = sp.peaks.length
    const ring = Math.min(Math.floor(B * r), B - 1)
    const q = B * r - ring
    return q > 0 && q < 1 ? sp.peaks[ring] * Math.exp(4 - 1 / (q * (1 - q))) : 0
  }
  const kernels = LENIA_SPECIES.map((sp) => buildKernel(sp))
  const refSums = LENIA_SPECIES.map((sp) => {
    let s = 0
    for (let dy = -KERNEL_RADIUS; dy <= KERNEL_RADIUS; dy++)
      for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) s += refShell(Math.hypot(dx, dy), sp)
    return s
  })
  const rand = rng(0x1e41a)
  let maxAbs = 0
  let maxRel = 0
  for (let n = 0; n < 1000; n++) {
    const k = Math.floor(rand() * LENIA_SPECIES.length)
    const sp = LENIA_SPECIES[k]
    // half the points uniform over the texture, half inside the support where weights are non-zero
    let col: number
    let row: number
    do {
      col = Math.floor(rand() * KERNEL_DIAMETER)
      row = Math.floor(rand() * KERNEL_DIAMETER)
    } while (n % 2 === 1 && Math.hypot(col - KERNEL_RADIUS, row - KERNEL_RADIUS) >= sp.R)
    const ref = refShell(Math.hypot(col - KERNEL_RADIUS, row - KERNEL_RADIUS), sp) / refSums[k]
    const got = kernels[k][row * KERNEL_DIAMETER + col]
    maxAbs = Math.max(maxAbs, Math.abs(got - ref))
    if (ref > 1e-6) maxRel = Math.max(maxRel, Math.abs(got - ref) / ref)
  }
  check(maxAbs < 1e-8 && maxRel < 1e-6, 'texture = reference formula at 1000 random taps', `max abs error ${fmt(maxAbs)}, max rel error (weights > 1e-6) ${fmt(maxRel)}`)

  for (let k = 0; k < LENIA_SPECIES.length; k++) {
    const sp = LENIA_SPECIES[k]
    const K = kernels[k]
    let sum = 0
    let rim = 0
    let asym = 0
    let taps = 0
    for (let row = 0; row < KERNEL_DIAMETER; row++) {
      for (let col = 0; col < KERNEL_DIAMETER; col++) {
        const w = K[row * KERNEL_DIAMETER + col]
        sum += w
        if (w > 0) taps++
        if (row === 0 || col === 0 || row === KERNEL_DIAMETER - 1 || col === KERNEL_DIAMETER - 1) rim = Math.max(rim, w)
        const turned = K[col * KERNEL_DIAMETER + (KERNEL_DIAMETER - 1 - row)]
        const mirrored = K[row * KERNEL_DIAMETER + (KERNEL_DIAMETER - 1 - col)]
        asym = Math.max(asym, Math.abs(w - turned), Math.abs(w - mirrored))
      }
    }
    check(
      Math.abs(sum - 1) < 1e-6 && rim === 0 && asym === 0,
      `${sp.id}: Σ = 1, outer ring zero, quarter-turn and mirror symmetric`,
      `Σ − 1 = ${fmt(sum - 1)}, ${taps} non-zero taps, rim max ${rim}, asymmetry ${asym}`,
    )
  }
  console.log()
}

// ---------------------------------------------------------------- 2. growth and update, from the shader source
{
  console.log('2. growth and update (the shader\'s own lines)')
  const src = stepFrag.replace(/\s+/g, ' ')
  const zm = /float z = ([^;]+);/.exec(src)
  const gm = /float g = ([^;]+);/.exec(src)
  const um = /gl_FragColor = vec4\(clamp\(([^,]+), 0\.0, 1\.0\)/.exec(src)
  const tapm = /texture2DLodEXT\(uKernel, vec2\(\(float\(i\) \+ 0\.5\) \* INV_DIAM, ky\)/.test(src)
  const offm = /vec2\(float\(i\) - RADIUS, dy\)/.test(src) && /float dy = float\(j\) - RADIUS;/.test(src) && /float ky = \(float\(j\) \+ 0\.5\) \* INV_DIAM;/.test(src)
  check(zm !== null && gm !== null && um !== null, 'found the growth and update lines in stepFrag', zm && gm && um ? `z = ${zm[1]};  g = ${gm[1]};  A' = clamp(${um[1]}, 0, 1)` : 'pattern not found')
  check(tapm && offm, 'kernel texel (i, j) is applied at cell offset (i − R, j − R), the layout buildKernel writes')
  if (zm && gm && um) {
    const js = (e: string) => e.replace(/\bexp\(/g, 'Math.exp(')
    const shaderGrowth = new Function('u', 'uM', 'uS', `const z = ${js(zm[1])}; return ${js(gm[1])};`) as (u: number, m: number, s: number) => number
    const shaderUpdate = new Function('a', 'uDt', 'g', `const v = ${js(um[1])}; return Math.min(1, Math.max(0, v));`) as (a: number, dt: number, g: number) => number
    const f = Math.fround
    /** the same expression, rounded to float32 after every operation (GPU arithmetic) */
    const growth32 = (u: number, m: number, s: number) => {
      const z = f(f(f(u) - f(m)) / f(s))
      const e = f(Math.exp(f(f(-0.5 * z) * z)))
      return f(f(2 * e) - 1)
    }
    const rand = rng(0x6e0)
    let formulaErr = 0
    let float32Err = 0
    let updateErr = 0
    for (let n = 0; n < 1000; n++) {
      const sp = LENIA_SPECIES[n % LENIA_SPECIES.length]
      // half near the growth peak, half over the whole range of K ∗ A
      const u = n % 2 === 0 ? sp.m + (rand() * 2 - 1) * 4 * sp.s : rand()
      const ref = growth(u, sp.m, sp.s)
      formulaErr = Math.max(formulaErr, Math.abs(shaderGrowth(u, sp.m, sp.s) - ref))
      float32Err = Math.max(float32Err, Math.abs(growth32(u, sp.m, sp.s) - ref))
      const a = rand()
      const want = Math.min(1, Math.max(0, a + ref / sp.T))
      updateErr = Math.max(updateErr, Math.abs(shaderUpdate(a, 1 / sp.T, ref) - want))
    }
    check(formulaErr < 1e-12, 'shader growth = G(u) at 1000 random points (float64)', `max error ${fmt(formulaErr)}`)
    check(float32Err < 1e-5, 'the same in float32 arithmetic, as on the GPU', `max error ${fmt(float32Err)}`)
    check(updateErr < 1e-12, "shader update = clip(A + G / T, 0, 1) at the same points", `max error ${fmt(updateErr)}`)
  }
  console.log()
}

// ---------------------------------------------------------------- 3. blob counter
{
  console.log('3. blob counter (leniaBlobs)')
  const n = 32
  const labels = new Int32Array(n * n)
  const queue = new Int32Array(n * n)
  const field = new Float32Array(n * n)
  const disc = (cx: number, cy: number, r: number) => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const dx = ((x - cx + n * 1.5) % n) - n / 2
        const dy = ((y - cy + n * 1.5) % n) - n / 2
        if (dx * dx + dy * dy <= r * r) field[y * n + x] = 0.5
      }
  }
  disc(8, 8, 3)
  disc(24, 20, 3)
  const two = countBlobs(field, n, 0.1, labels, queue)
  field.fill(0)
  disc(0, 16, 3) // straddles the left/right seam
  disc(16, 31, 2) // straddles the top/bottom seam
  const seam = countBlobs(field, n, 0.1, labels, queue)
  field.fill(0)
  field[5 * n + 5] = 0.5
  field[6 * n + 6] = 0.5 // diagonal neighbours: one blob under 8-connectivity
  const diag = countBlobs(field, n, 0.1, labels, queue)
  check(two === 2 && seam === 2 && diag === 1, 'two discs → 2, two seam-straddling discs → 2, diagonal pair → 1', `${two}, ${seam}, ${diag}`)
  console.log()
}

// ---------------------------------------------------------------- 4. species on 128²
interface Track {
  mass: number[]
  displacement: number
  /** farthest the centroid got from where it started (unwrapped) */
  excursion: number
  path: number
  rotationDeg: number
  /** blob count every generation, as the stage counts them (8 × 8-cell blocks, mean > 0.1) */
  blobs: number[]
}

/** Run one creature alone; centroid and axis every 5 generations (minimum-image deltas). */
function run(sp: LeniaSpecies, N: number, gens: number): Track {
  const sim = new CpuLenia(N, sp)
  stampPattern(sim.A, N, sp.cells, N / 2, N / 2, 0)
  const half = N / 2
  const wrap = (d: number) => ((d + half) % N + N) % N - half
  const c: [number, number] = [0, 0]
  const pose = () => {
    sim.centroid(c)
    let xx = 0
    let yy = 0
    let xy = 0
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const v = sim.A[y * N + x]
        if (v === 0) continue
        const dx = wrap(x - c[0])
        const dy = wrap(y - c[1])
        xx += v * dx * dx
        yy += v * dy * dy
        xy += v * dx * dy
      }
    return { x: c[0], y: c[1], angle: Math.atan2(2 * xy, xx - yy) / 2 }
  }
  // the stage's own blob definition: blocks of LENIA_GRID / TELE_GRID cells, at any N
  const block = LENIA_GRID / TELE_GRID
  const nb = N / block
  const blocks = new Float32Array(nb * nb)
  const labels = new Int32Array(nb * nb)
  const queue = new Int32Array(nb * nb)
  const blobCount = () => {
    blocks.fill(0)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) blocks[Math.floor(y / block) * nb + Math.floor(x / block)] += sim.A[y * N + x]
    return countBlobs(blocks, nb, 0.1 * block * block, labels, queue)
  }
  const mass = [sim.mass()]
  const blobs = [blobCount()]
  let prev = pose()
  let dx = 0
  let dy = 0
  let path = 0
  let rot = 0
  let excursion = 0
  for (let g = 1; g <= gens; g++) {
    sim.step()
    mass.push(sim.mass())
    blobs.push(blobCount())
    if (g % 5 === 0) {
      const p = pose()
      const ddx = wrap(p.x - prev.x)
      const ddy = wrap(p.y - prev.y)
      dx += ddx
      dy += ddy
      excursion = Math.max(excursion, Math.hypot(dx, dy))
      path += Math.hypot(ddx, ddy)
      let da = p.angle - prev.angle
      while (da > Math.PI / 2) da -= Math.PI
      while (da < -Math.PI / 2) da += Math.PI
      rot += da
      prev = p
    }
  }
  return { mass, displacement: Math.hypot(dx, dy), excursion, path, rotationDeg: (rot * 180) / Math.PI, blobs }
}

/** Dominant period of the mass after the transient (first autocorrelation peak > 0.5), 0 if none. */
function massPeriod(mass: number[]): number {
  const a = mass.slice(50)
  const mean = a.reduce((s, v) => s + v, 0) / a.length
  const corr = (lag: number) => {
    let num = 0
    let d1 = 0
    let d2 = 0
    for (let i = 0; i + lag < a.length; i++) {
      const x = a[i] - mean
      const y = a[i + lag] - mean
      num += x * y
      d1 += x * x
      d2 += y * y
    }
    return num / Math.sqrt(d1 * d2 || 1)
  }
  for (let lag = 6; lag < 200; lag++) {
    const c = corr(lag)
    if (c > 0.5 && c > corr(lag - 1) && c >= corr(lag + 1)) return lag
  }
  return 0
}

console.log('4. species alone on 128², 500 generations (CPU reference)')
const GENS = 500
for (const sp of LENIA_SPECIES) {
  const t0 = Date.now()
  const tr = run(sp, 128, GENS)
  const m0 = tr.mass[0]
  const settled = tr.mass.slice(50)
  const mean = settled.reduce((s, v) => s + v, 0) / settled.length
  const lo = Math.min(...tr.mass)
  const hi = Math.max(...tr.mass)
  const p2p = (Math.max(...settled) - Math.min(...settled)) / mean
  const period = massPeriod(tr.mass)
  console.log(
    `  ${sp.id} (${sp.label}): R ${sp.R}, T ${sp.T}, m ${sp.m}, s ${sp.s}, β [${sp.peaks.map((b) => fmt(b, 3)).join(', ')}], ${sp.cells[0].length} × ${sp.cells.length} cells  [${((Date.now() - t0) / 1000).toFixed(1)} s]`,
  )
  console.log(`    mass every 50:  ${tr.mass.filter((_, i) => i % 50 === 0).map((v) => v.toFixed(1)).join('  ')}`)
  console.log(
    `    mass range vs generation 0 (${m0.toFixed(2)}): ${pct(lo / m0 - 1)} … ${pct(hi / m0 - 1)};  after 50: mean ${mean.toFixed(2)}, peak-to-peak ${(100 * p2p).toFixed(2)} %, period ${period || '—'}`,
  )
  console.log(
    `    centroid: net displacement ${tr.displacement.toFixed(1)} cells (${(tr.displacement / GENS).toFixed(3)} / generation), farthest ${tr.excursion.toFixed(1)}, path ${tr.path.toFixed(1)};  axis turned ${tr.rotationDeg.toFixed(0)}°;  blobs ${Math.min(...tr.blobs)}…${Math.max(...tr.blobs)}`,
  )
  check(lo / m0 - 1 > -0.1 && hi / m0 - 1 < 0.1, `${sp.id}: mass within ±10 % of generation 0 for all 500 generations`)
  check(tr.blobs.every((b) => b === 1), `${sp.id}: stays one creature (one blob, as the stage counts them, at every generation)`)
  const kind = EXPECT[sp.id]
  if (kind === 'glider') check(tr.displacement > 20, `${sp.id}: glides (net displacement > 20 cells)`, `${tr.displacement.toFixed(1)} cells`)
  else if (kind === 'spinner')
    check(Math.abs(tr.rotationDeg) >= 180 && tr.excursion < 20, `${sp.id}: spins (axis turns ≥ 180°, never farther than 20 cells from its start)`, `${tr.rotationDeg.toFixed(0)}°, farthest ${tr.excursion.toFixed(1)} cells`)
  else if (kind === 'pulsar')
    check(tr.excursion < 5 && p2p >= 0.04 && period > 0, `${sp.id}: pulses in place (never farther than 5 cells, peak-to-peak ≥ 4 %, periodic)`, `farthest ${tr.excursion.toFixed(2)} cells, ${(100 * p2p).toFixed(2)} %, period ${period}`)
  else check(false, `${sp.id}: no expected behaviour listed in verify.ts`)
}
console.log()

// ---------------------------------------------------------------- 5. the stage's start on 256²
if (process.argv.includes('--layout')) {
  console.log('5. three copies at SEED_LAYOUT on 256², 2000 generations')
  const N = LENIA_GRID
  for (const sp of LENIA_SPECIES) {
    const t0 = Date.now()
    const sim = new CpuLenia(N, sp)
    for (const s of SEED_LAYOUT) stampPattern(sim.A, N, sp.cells, s.x * N, s.y * N, s.turns)
    const nb = 32
    const blocks = new Float32Array(nb * nb)
    const labels = new Int32Array(nb * nb)
    const queue = new Int32Array(nb * nb)
    const blobs = () => {
      blocks.fill(0)
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) blocks[(y >> 3) * nb + (x >> 3)] += sim.A[y * N + x]
      return countBlobs(blocks, nb, 0.1 * 64, labels, queue)
    }
    const start = blobs()
    let settledMass = 0
    let fewer = 0
    let lighter = 0
    const log: string[] = []
    for (let g = 1; g <= 2000; g++) {
      sim.step()
      if (g % 5 === 0) {
        const b = blobs()
        const m = sim.mass()
        if (g === 100) settledMass = m
        if (!fewer && b < start) fewer = g
        if (!lighter && settledMass > 0 && m < 0.9 * settledMass) lighter = g
        if (g % 100 === 0) log.push(`${g}:${b}/${m.toFixed(0)}`)
      }
    }
    console.log(
      `  ${sp.id}: blobs ${start} at 0; blob count first drops at ${fewer || '—'}, mass first 10 % below generation 100's at ${lighter || '—'}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`,
    )
    console.log(`    blobs/mass every 100: ${log.join(' ')}`)
    check(start === SEED_LAYOUT.length, `${sp.id}: the layout starts as ${SEED_LAYOUT.length} separate creatures`)
    check(fewer === 0 || fewer >= 1000, `${sp.id}: blob count holds for 1000 generations (no merge or death)`, fewer ? `first drop at ${fewer}` : 'holds for 2000')
  }
  console.log()
} else {
  console.log('5. skipped (pass --layout to run the stage\'s three-creature start on 256², ~6 min)')
  console.log()
}

// ---------------------------------------------------------------- 6. the real GPU
if (process.argv.includes('--gpu')) {
  console.log('6. the GPU (headless Chrome)')
  const result = await runGpuCheck()
  if (typeof result === 'string') {
    check(false, 'GPU check ran', result)
  } else if (result.error) {
    check(false, 'GPU check ran', result.error)
  } else {
    console.log(`  renderer: ${result.renderer};  ${result.msPerStep.toFixed(2)} ms per generation (256², 100 steps)`)
    for (const n of result.noise) {
      check(n.diff1 < 1e-5 && n.diff2 < 1e-5, `${n.id}: GPU = CPU after 1 and 2 generations from random noise`, `max |ΔA| ${fmt(n.diff1)}, ${fmt(n.diff2)}`)
    }
    for (const l of result.layout) {
      const worst = l.rows.reduce((m, r) => Math.max(m, r.gen <= 10 ? r.diff / 1e-4 : r.diff / 5e-3), 0)
      const tele = l.rows.every((r) => Math.abs(r.teleMass - r.gpuMass) < 1e-4 * r.gpuMass + 1e-3 && r.teleBlobs === r.cpuBlobs)
      check(worst < 1, `${l.id}: GPU follows the CPU from the stage's seed (|ΔA| < 1e-4 to gen 10, < 5e-3 after)`, l.rows.map((r) => `gen ${r.gen}: ${fmt(r.diff)}, mass ${r.gpuMass.toFixed(2)} vs ${r.cpuMass.toFixed(2)}`).join(';  '))
      check(tele, `${l.id}: telemetry reduction = field mass, blobs = CPU blobs`, l.rows.map((r) => `${r.teleMass.toFixed(2)}/${r.teleBlobs}`).join(' '))
    }
    check(result.displayCompiled, 'display shader compiles and draws')
    const a = result.asyncStats
    const e = result.asyncExpected
    check(a !== null && e !== null && Math.abs(a.mass - e.mass) < 1e-4 * e.mass && a.blobs === e.blobs, 'asynchronous telemetry readback lands', a && e ? `mass ${a.mass.toFixed(3)} vs ${e.mass.toFixed(3)}, blobs ${a.blobs} vs ${e.blobs}` : 'no result')
  }
  console.log()
} else {
  console.log('6. skipped (pass --gpu to run the real shaders in headless Chrome)')
  console.log()
}

/** Bundle gpu-check.ts, run it in headless Chrome, return its result (or why it could not run). */
async function runGpuCheck(): Promise<GpuCheckResult | string> {
  const chrome =
    process.env.CHROME ??
    (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? '' : '/usr/bin/google-chrome')
  if (!chrome || !existsSync(chrome)) return `no Chrome found${chrome ? ` at ${chrome}` : ''}; set CHROME=/path/to/chrome`
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'lenia-gpu-'))
  try {
    const { build } = await import('vite')
    await build({
      configFile: false,
      logLevel: 'error',
      root: here,
      build: {
        outDir: dir,
        emptyOutDir: false,
        minify: false,
        lib: { entry: join(here, 'gpu-check.ts'), formats: ['iife'], name: 'leniaGpuCheck', fileName: () => 'gpu-check.js' },
      },
    })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><pre id="out"></pre><script src="gpu-check.js"></script></body></html>')
    const gensArg = process.argv.find((a) => a.startsWith('--gpu-gens='))
    const url = `${pathToFileURL(join(dir, 'index.html')).href}?gens=${gensArg ? gensArg.slice('--gpu-gens='.length) : '1,10,100'}`
    const args = [
      '--headless=new',
      `--user-data-dir=${join(dir, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--ignore-gpu-blocklist',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      '--virtual-time-budget=600000',
      '--dump-dom',
      url,
    ]
    const dom = await new Promise<string>((resolve, reject) => {
      const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      let text = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('headless Chrome timed out after 10 min'))
      }, 600_000)
      child.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString()
        // Chrome sometimes lingers after dumping the page; stop it once the dump is complete
        if (text.includes('</html>')) child.kill()
      })
      child.on('error', reject)
      child.on('close', () => {
        clearTimeout(timer)
        resolve(text)
      })
    })
    const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)
    if (!m || m[1] === '') return 'the page produced no result (see gpu-check.ts)'
    const json = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    return JSON.parse(json) as GpuCheckResult
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
