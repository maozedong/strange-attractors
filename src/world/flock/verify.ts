/**
 * Checks for the murmuration. Run: pnpm tsx src/world/flock/verify.ts
 *
 *  1. 10,000 birds, all rules, 600 frames at 60 fps: under 8 s in total (ms per frame
 *     printed, wall and CPU), no NaN, no bird farther than 2.6 from the origin at the end,
 *     alignment above 0.7 within 300 frames
 *  2. the same start with alignment off: alignment stays below 0.4
 *  3. what each rule does, from a settled flock: collisions without separation, spread
 *     without cohesion; and how fast the flock dissolves and recovers when alignment is
 *     switched off and on again mid-flight (numbers for the narration)
 *  4. the hawk: a hole opens round it, nobody escapes the bounds, still no NaN
 *  5. 20,000 birds (the cap); the instance matrices (cost, proper rotations along the
 *     velocity); and no allocation per frame once warm
 *  6. framing: how far a fov-40° camera should stand for the flock to fill ~70 % of the height
 */
import { loadavg } from 'node:os'
import { PerformanceObserver } from 'node:perf_hooks'
import {
  COLLISION_DISTANCE,
  createFlock,
  HAWK_ENTRY_TIME,
  HAWK_PERIOD,
  MAX_BOIDS,
  spawnFlock,
  stepFlock,
  type Flock,
  type FlockRules,
} from './boids'
import { createBirdPose, writeBirdMatrices } from './orient'

let failed = false
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed = true
}
const info = (s: string) => console.log(`      ${s}`)
const fmt = (x: number, d = 3) => x.toFixed(d)
const DT = 1 / 60
const SEED = 20251003

function finite(f: Flock) {
  for (let i = 0; i < f.n * 3; i++) if (!Number.isFinite(f.pos[i]) || !Number.isFinite(f.vel[i])) return false
  return true
}
function maxRadius(f: Flock) {
  let m = 0
  for (let i = 0; i < f.n; i++) m = Math.max(m, Math.hypot(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2]))
  return m
}
function gyration(f: Flock) {
  let s = 0
  const [cx, cy, cz] = f.centroid
  for (let i = 0; i < f.n; i++) s += (f.pos[i * 3] - cx) ** 2 + (f.pos[i * 3 + 1] - cy) ** 2 + (f.pos[i * 3 + 2] - cz) ** 2
  return Math.sqrt(s / f.n)
}
function settled(frames = 300, n = 10000) {
  const f = createFlock(MAX_BOIDS, SEED)
  spawnFlock(f, n)
  for (let k = 0; k < frames; k++) stepFlock(f, DT, 'all', false)
  return f
}
const sum = (a: Float64Array, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i]
  return s
}
const trace = (a: Float64Array) => [30, 60, 120, 180, 300, 450, 600].map((k) => `${k}:${fmt(a[k - 1], 2)}`).join(' ')

console.log(`machine load (1/5/15 min): ${loadavg().map((x) => x.toFixed(1)).join(' / ')}`)

// ---------------------------------------------------------------- 1. all rules
const main = createFlock(MAX_BOIDS, SEED)
spawnFlock(main, 10000)
{
  const ms = new Float64Array(600)
  const alignment = new Float64Array(600)
  let maxR = 0
  const cpu0 = process.cpuUsage()
  for (let k = 0; k < 600; k++) {
    const t0 = performance.now()
    stepFlock(main, DT, 'all', false)
    ms[k] = performance.now() - t0
    alignment[k] = main.alignment
    if (k % 30 === 29) maxR = Math.max(maxR, maxRadius(main))
  }
  const cpu = process.cpuUsage(cpu0)
  const total = sum(ms)
  const late = Array.from(ms.subarray(300)).sort((a, b) => a - b)
  info(
    `10,000 birds × 600 frames: ${fmt(total / 1000, 2)} s wall, ${fmt(total / 600, 2)} ms/frame ` +
      `(CPU ${fmt((cpu.user + cpu.system) / 1000 / 600, 2)} ms/frame); settled, frames 300–600: ` +
      `median ${fmt(late[150], 2)}, p95 ${fmt(late[285], 2)} ms`,
  )
  check(total < 8000, `600 frames under 8 s (${fmt(total / 1000, 2)} s)`)
  check(finite(main), 'no NaN in positions or velocities')
  const rEnd = maxRadius(main)
  check(rEnd <= 2.6, `farthest bird after 600 frames ${fmt(rEnd)} ≤ 2.6 (farthest seen during the run ${fmt(maxR)})`)
  let cross = -1
  for (let k = 0; k < 600; k++) if (cross < 0 && alignment[k] > 0.7) cross = k + 1
  info(`alignment, all rules (frame:value): ${trace(alignment)}`)
  check(cross > 0 && cross <= 300, `alignment passes 0.7 at frame ${cross} (≤ 300); ${fmt(alignment[599])} at 600`)
  info(
    `neighbours found ${fmt(main.meanNeighbours, 1)} of 12; nearest flockmate ${fmt(main.meanNearest)} on average; ` +
      `${fmt(100 * main.collisions, 2)} % of birds closer than ${COLLISION_DISTANCE} to one`,
  )
}

// ---------------------------------------------------------------- 2. alignment off
{
  const f = createFlock(MAX_BOIDS, SEED)
  spawnFlock(f, 10000)
  const alignment = new Float64Array(600)
  for (let k = 0; k < 600; k++) {
    stepFlock(f, DT, 'noAlignment', false)
    alignment[k] = f.alignment
  }
  const max = alignment.reduce((a, b) => Math.max(a, b), 0)
  info(`alignment, alignment off: ${trace(alignment)}`)
  check(max < 0.4, `alignment off stays below 0.4 (max ${fmt(max)}, mean over frames 300–600 ${fmt(sum(alignment, 300) / 300)})`)
  check(finite(f) && maxRadius(f) <= 2.6, `alignment off: no NaN, farthest bird ${fmt(maxRadius(f))}`)
}

// ---------------------------------------------------------------- 3. each rule, from a settled flock
{
  const variant = (rules: FlockRules) => {
    const f = settled()
    let coll = 0, nearest = 0, ali = 0, rg = 0
    for (let k = 0; k < 300; k++) {
      stepFlock(f, DT, rules, false)
      if (k >= 150) {
        coll += f.collisions / 150
        nearest += f.meanNearest / 150
        ali += f.alignment / 150
        if (k % 10 === 0) rg += gyration(f) / 15
      }
    }
    return { f, coll, nearest, ali, rg }
  }
  const base = variant('all')
  const noSep = variant('noSeparation')
  const noCoh = variant('noCohesion')
  const row = (name: string, v: typeof base) =>
    info(
      `${name.padEnd(14)} collisions ${fmt(100 * v.coll, 2).padStart(6)} %   nearest ${fmt(v.nearest)}   ` +
        `alignment ${fmt(v.ali)}   radius of gyration ${fmt(v.rg, 2)}   farthest ${fmt(maxRadius(v.f), 2)}`,
    )
  info('2.5–5 s after the switch, from a flock settled for 5 s:')
  row('all rules', base)
  row('no separation', noSep)
  row('no cohesion', noCoh)
  check(base.coll < 0.01, `all rules: under 1 % of birds within ${COLLISION_DISTANCE} of a flockmate (${fmt(100 * base.coll, 2)} %)`)
  check(noSep.coll > 10 * base.coll + 0.05, `separation off: collisions jump (${fmt(100 * noSep.coll, 1)} % vs ${fmt(100 * base.coll, 2)} %)`)
  check(noCoh.nearest > base.nearest * 1.08, `cohesion off: birds spread out (nearest ${fmt(noCoh.nearest)} vs ${fmt(base.nearest)})`)

  // switching alignment off mid-flight, then on again
  const f = settled()
  let gone = -1, back = -1
  for (let k = 0; k < 900; k++) {
    stepFlock(f, DT, 'noAlignment', false)
    if (gone < 0 && f.alignment < 0.4) gone = k + 1
  }
  for (let k = 0; k < 900; k++) {
    stepFlock(f, DT, 'all', false)
    if (back < 0 && f.alignment > 0.7) back = k + 1
  }
  info(`alignment switched off mid-flight: below 0.4 after ${fmt(gone / 60, 1)} s; switched back on: above 0.7 after ${fmt(back / 60, 1)} s`)
  check(gone > 0 && back > 0, 'the flock dissolves without alignment and re-forms with it')
}

// ---------------------------------------------------------------- 4. the hawk
{
  const f = settled()
  const ctrl = settled()
  const R = 0.3
  const near = (g: Flock, x: number, y: number, z: number) => {
    let c = 0
    for (let i = 0; i < g.n; i++) {
      const dx = g.pos[i * 3] - x, dy = g.pos[i * 3 + 1] - y, dz = g.pos[i * 3 + 2] - z
      if (dx * dx + dy * dy + dz * dz < R * R) c++
    }
    return c
  }
  const frames = Math.round((HAWK_PERIOD * 1.5) / DT)
  let inHole = 0, inCtrl = 0, samples = 0, maxR = 0, ok = true, minAlign = 1
  for (let k = 0; k < frames; k++) {
    stepFlock(f, DT, 'all', true)
    stepFlock(ctrl, DT, 'all', false)
    minAlign = Math.min(minAlign, f.alignment)
    if (k > 60 && k % 10 === 0) {
      // the same point of the path, in a flock with no hawk
      inHole += near(f, f.hawk[0], f.hawk[1], f.hawk[2])
      inCtrl += near(ctrl, f.hawk[0], f.hawk[1], f.hawk[2])
      samples++
      maxR = Math.max(maxR, maxRadius(f))
      ok = ok && finite(f)
    }
  }
  info(
    `hawk on for ${fmt(HAWK_PERIOD * 1.5, 0)} s (enters at path time ${HAWK_ENTRY_TIME} s, centre 3.5 s later): ` +
      `${fmt(inHole / samples, 1)} birds within ${R} of it on average, ${fmt(inCtrl / samples, 1)} round the same points ` +
      `with no hawk; flock alignment never below ${fmt(minAlign, 2)}`,
  )
  check(inHole < 0.1 * inCtrl, `the hawk clears a hole round itself (${fmt(inHole / samples, 1)} vs ${fmt(inCtrl / samples, 1)})`)
  check(ok && maxR <= 2.6, `with the hawk: no NaN, farthest bird ${fmt(maxR)} ≤ 2.6`)
  let healed = -1
  for (let k = 0; k < 600; k++) {
    stepFlock(f, DT, 'all', false)
    if (healed < 0 && f.hawkPresence === 0 && near(f, f.hawk[0], f.hawk[1], f.hawk[2]) >= 0.5 * inCtrl / samples) healed = k + 1
  }
  info(`after the hawk leaves, its hole has refilled to half the usual density ${healed > 0 ? `after ${fmt(healed / 60, 1)} s` : 'not within 10 s'}`)
}

// ---------------------------------------------------------------- 5. the cap, the matrices, allocation
{
  const big = createFlock(MAX_BOIDS, SEED)
  spawnFlock(big, MAX_BOIDS)
  let t = 0
  for (let k = 0; k < 240; k++) {
    const t0 = performance.now()
    stepFlock(big, DT, 'all', false)
    if (k >= 120) t += performance.now() - t0
  }
  info(`${MAX_BOIDS} birds: ${fmt(t / 120, 2)} ms/frame over frames 120–240`)
  check(finite(big) && maxRadius(big) <= 2.6, `${MAX_BOIDS} birds: no NaN, farthest bird ${fmt(maxRadius(big))}`)

  const f = main
  const pose = createBirdPose(MAX_BOIDS)
  const matrices = new Float32Array(MAX_BOIDS * 16)
  for (let i = 0; i < MAX_BOIDS; i++) matrices[i * 16 + 15] = 1
  let tm = 0
  for (let k = 0; k < 300; k++) {
    stepFlock(f, DT, 'all', false)
    const t0 = performance.now()
    writeBirdMatrices(f, pose, matrices, DT, 1)
    if (k >= 60) tm += performance.now() - t0
  }
  info(`orienting 10,000 instance matrices: ${fmt(tm / 240, 3)} ms/frame`)
  let worst = 0, worstDet = 0
  for (let i = 0; i < f.n; i++) {
    const m = matrices.subarray(i * 16, i * 16 + 16)
    const r = [m[0], m[1], m[2]], u = [m[4], m[5], m[6]], fw = [m[8], m[9], m[10]]
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    worst = Math.max(worst, Math.abs(dot(r, u)), Math.abs(dot(u, fw)), Math.abs(dot(r, fw)), Math.abs(dot(fw, fw) - 1), Math.abs(dot(u, u) - 1))
    const det = r[0] * (u[1] * fw[2] - u[2] * fw[1]) - r[1] * (u[0] * fw[2] - u[2] * fw[0]) + r[2] * (u[0] * fw[1] - u[1] * fw[0])
    worstDet = Math.max(worstDet, Math.abs(det - 1))
    const s = Math.hypot(f.vel[i * 3], f.vel[i * 3 + 1], f.vel[i * 3 + 2])
    worst = Math.max(worst, 1 - (fw[0] * f.vel[i * 3] + fw[1] * f.vel[i * 3 + 1] + fw[2] * f.vel[i * 3 + 2]) / s)
  }
  check(worst < 1e-4 && worstDet < 1e-4, `instance matrices are rotations along the velocity (worst ${worst.toExponential(1)}, det − 1 ${worstDet.toExponential(1)})`)
}

// ---------------------------------------------------------------- 6. framing
{
  const f = main
  const ys: number[] = []
  const rs: number[] = []
  for (let k = 0; k < 600; k++) {
    stepFlock(f, DT, 'all', false)
    if (k % 60 === 0)
      for (let i = 0; i < f.n; i++) {
        ys.push(f.pos[i * 3 + 1])
        rs.push(Math.hypot(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2]))
      }
  }
  ys.sort((a, b) => a - b)
  rs.sort((a, b) => a - b)
  const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))]
  const h = pct(ys, 0.99) - pct(ys, 0.01)
  const r98 = pct(rs, 0.98)
  const tan = Math.tan((20 * Math.PI) / 180)
  info(
    `flock extent over 10 s: y from ${fmt(pct(ys, 0.01), 2)} to ${fmt(pct(ys, 0.99), 2)} (98 % of birds), 98 % within ` +
      `${fmt(r98, 2)} of the origin. A fov-40° camera aimed at the origin: ${fmt(h / (0.7 * 2 * tan), 1)} units away ` +
      `fills ~70 % of the height; ${fmt(r98 / Math.sin((20 * Math.PI) / 180), 1)} keeps the whole ball in frame`,
  )
}

// ---------------------------------------------------------------- allocation (last: needs the GC observer)
async function allocation() {
  const f = main
  const pose = createBirdPose(MAX_BOIDS)
  const matrices = new Float32Array(MAX_BOIDS * 16)
  let gcs = 0
  const obs = new PerformanceObserver((list) => {
    gcs += list.getEntries().length
  })
  obs.observe({ entryTypes: ['gc'] })
  await new Promise((r) => setTimeout(r, 50))
  gcs = 0
  const before = process.memoryUsage().heapUsed
  for (let k = 0; k < 300; k++) {
    stepFlock(f, DT, k % 120 < 60 ? 'all' : 'noCohesion', true)
    writeBirdMatrices(f, pose, matrices, DT, 1)
  }
  const grew = process.memoryUsage().heapUsed - before
  await new Promise((r) => setTimeout(r, 50))
  obs.disconnect()
  check(gcs === 0 && grew < 256 * 1024, `no allocation per frame: 300 warm frames grew the heap by ${fmt(grew / 1024, 1)} KB, ${gcs} collections`)
}

allocation().then(() => {
  if (failed) {
    console.log('\nSOME CHECKS FAILED')
    process.exit(1)
  }
  console.log('\nall checks passed')
})
