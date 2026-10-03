export { toSrgb, writePng } from './png'
import { toSrgb, writePng } from './png'
/**
 * Checks the taffy puller:  pnpm tsx src/world/taffy/verify.ts [--png out.png [pulls,...]]
 *
 * Everything runs the GPU's own arithmetic on the CPU (puller.ts: the field, midpointStep, the rod
 * frames), in double precision.
 *
 * 1. Braid. The rods' paths over two pulls, projected on the x axis: every exchange of two
 *    neighbours is a generator σi (sign from which rod passes below). The word's image in
 *    SL(2,Z) (σ1 ↦ [[1,1],[0,1]], σ2 ↦ [[1,0],[−1,1]], exact for 3-braids) gives the dilatation
 *    (|tr| + √(tr² − 4)) / 2 when |tr| > 2 (pseudo-Anosov); it must match BRAID_ENTROPY.
 * 2. Field. u = ∇⊥ψ everywhere (so the flow is exactly area-preserving), the fluid on each rod's
 *    surface moves with the rod (no penetration, no slip), and no guard zone ever reaches
 *    another rod's surface (the condition that makes 2 exact).
 * 3. Tracers. A 200 × 200 grid over the domain, outside the rods, for 6 pulls: no NaN, nothing
 *    past RESPAWN_BOUND (so nothing would respawn), and the one-pull map's Jacobian determinant
 *    stays 1 (two tangent vectors per tracer, re-orthonormalised every substep).
 * 4. Material line. 2000 points on the x axis from −0.8 to 0.8. Its length after each pull,
 *    exactly (a point is inserted, advected from t = 0, wherever two neighbours drift more than
 *    MAX_SEG apart) while that stays affordable, and for all 6 pulls from the stretch of 20,000
 *    tangent elements along it (L = ∫ |∂x/∂s| ds). The growth per pull must stay at or above the
 *    braid's topological entropy, the floor Thurston–Nielsen theory sets for any such flow.
 * 5. Substeps. One pull at SUBSTEPS_PER_PULL against 4× as many: the line comes out the same
 *    length (pointwise, chaos amplifies any difference, so the gap after one half-turn is
 *    printed for information).
 *
 * --png renders the taffy (262,144 points, as the GPU draws them at the default framing) after
 * the given pulls (default 0,1,2,4,6). Exits non-zero if any check fails. Not bundled.
 */
import {
  BLOB_RADIUS,
  BOUNDARY_RADIUS,
  BRAID_ENTROPY,
  GUARD_WIDTH,
  PULL_PROTOCOL,
  RESPAWN_BOUND,
  ROD_FRAME,
  ROD_RADIUS,
  ROD_STRIDE,
  SLOT_X,
  SLOT_Y,
  SUBSTEPS_PER_PULL,
  freshTaffy,
  midpointStep,
  rodFrame,
  rodKinematics,
  streamFunction,
  velocity,
  type PullProtocol,
} from './puller'
import { REF_PX_PER_UNIT } from './shaders'

const S = SUBSTEPS_PER_PULL
const DT = 1 / S
const PULLS = 6
const MAX_SEG = 0.01
/** stop refining the exact line beyond this many points */
const EXACT_CAP = 1_500_000
const TANGENTS = 20_000

let failures = 0
function check(ok: boolean, msg: string) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}
const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x))

/** rod frames for every substep's start, midpoint and end over `pulls` pulls */
function frames(pulls: number, protocol: PullProtocol, s = S) {
  const n = pulls * s
  const f0: Float64Array[] = []
  const fm: Float64Array[] = []
  const f1: Float64Array[] = []
  for (let i = 0; i < n; i++) {
    f0.push(rodFrame(i / s, new Float64Array(ROD_FRAME), protocol))
    fm.push(rodFrame((i + 0.5) / s, new Float64Array(ROD_FRAME), protocol))
    f1.push(rodFrame((i + 1) / s, new Float64Array(ROD_FRAME), protocol))
  }
  return { f0, fm, f1, n, dt: 1 / s }
}
type Frames = ReturnType<typeof frames>

// ------------------------------------------------------------------------------------- 1. braid
type Mat = [number, number, number, number]
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
]
const GEN: Record<string, Mat> = {
  '1': [1, 1, 0, 1],
  '-1': [1, -1, 0, 1],
  '2': [1, 0, -1, 1],
  '-2': [1, 0, 1, 1],
}

/** Track rod identities through the swaps and read the braid off the x-projection. */
function braidWord(protocol: PullProtocol, pulls: number): string[] {
  // identities: which rod sits in each slot; positions per identity from the kinematics
  const steps = 20000 * pulls
  const word: string[] = []
  const frame = new Float64Array(ROD_FRAME)
  const slotOf = [0, 1, 2] // slot of rod identity i at the start of the current half
  const pos = (tau: number, out: number[][]) => {
    rodKinematics(tau, frame, protocol)
    const f = tau - Math.floor(tau)
    const second = f >= 0.5
    const a = second ? 1 : 0
    const b = second ? 2 : 1
    for (let id = 0; id < 3; id++) {
      const slot = slotOf[id]
      const k = slot === a ? 0 : slot === b ? 1 : 2
      out[id][0] = frame[k * ROD_STRIDE]
      out[id][1] = frame[k * ROD_STRIDE + 1]
    }
  }
  const prev = [
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  const cur = [
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  pos(0, prev)
  let halfIndex = 0
  for (let i = 1; i <= steps; i++) {
    const tau = (i / steps) * pulls
    const h = Math.floor(tau * 2 - 1e-12)
    if (h > halfIndex) {
      // a half ended: the two slots swapped occupants
      const second = (halfIndex & 1) === 1
      const a = second ? 1 : 0
      const b = second ? 2 : 1
      for (let id = 0; id < 3; id++) {
        if (slotOf[id] === a) slotOf[id] = b
        else if (slotOf[id] === b) slotOf[id] = a
      }
      halfIndex = h
    }
    pos(tau - 1e-12, cur)
    // order by x before and after; an exchange of neighbours is a crossing
    const before = [0, 1, 2].sort((p, q) => prev[p][0] - prev[q][0])
    const after = [0, 1, 2].sort((p, q) => cur[p][0] - cur[q][0])
    for (let k = 0; k < 2; k++) {
      if (before[k] === after[k + 1] && before[k + 1] === after[k]) {
        const left = before[k] // moving right
        const right = before[k + 1]
        // positive (σ: a clockwise exchange) when the strand moving right passes above
        const sign = cur[left][1] > cur[right][1] ? 1 : -1
        word.push(String(sign * (k + 1)))
      }
    }
    for (let id = 0; id < 3; id++) {
      prev[id][0] = cur[id][0]
      prev[id][1] = cur[id][1]
    }
  }
  return word
}

function braidEntropy(word: string[], pulls: number) {
  let m: Mat = [1, 0, 0, 1]
  for (const g of word) m = mul(m, GEN[g])
  const tr = Math.abs(m[0] + m[3])
  const dil = tr > 2 ? (tr + Math.sqrt(tr * tr - 4)) / 2 : 1
  return { tr, dil, perPull: Math.log(dil) / pulls }
}

console.log(`\ntaffy puller: protocol '${PULL_PROTOCOL}', ${S} substeps per pull\n`)
console.log('1. braid')
for (const protocol of ['repeat', 'alternating'] as PullProtocol[]) {
  const word = braidWord(protocol, 2)
  const pretty = word.map((g) => (g.startsWith('-') ? `σ${g.slice(1)}⁻¹` : `σ${g}`)).join(' ')
  const { tr, perPull } = braidEntropy(word, 2)
  console.log(`  ${protocol.padEnd(11)} two pulls: ${pretty}   |trace| ${tr}   entropy ${fmt(perPull, 4)} per pull`)
  check(word.length === 4, `${protocol}: one crossing per half-turn`)
  check(tr > 2 && Math.abs(perPull - BRAID_ENTROPY[protocol]) < 1e-9, `${protocol}: pseudo-Anosov, entropy matches BRAID_ENTROPY (${fmt(BRAID_ENTROPY[protocol], 4)})`)
}

// ------------------------------------------------------------------------------------- 2. field
console.log('\n2. field')
{
  const rods = new Float64Array(ROD_FRAME)
  const u = new Float64Array(2)
  const rand = seeded(7)
  let maxCurl = 0
  let maxU = 0
  const h = 1e-6
  for (let i = 0; i < 40000; i++) {
    rodFrame(rand() * 2, rods)
    const x = (rand() * 2 - 1) * 1.2
    const y = (rand() * 2 - 1) * 1.2
    velocity(x, y, rods, u)
    const dy = (streamFunction(x, y + h, rods) - streamFunction(x, y - h, rods)) / (2 * h)
    const dx = (streamFunction(x + h, y, rods) - streamFunction(x - h, y, rods)) / (2 * h)
    maxCurl = Math.max(maxCurl, Math.hypot(u[0] - dy, u[1] + dx))
    maxU = Math.max(maxU, Math.hypot(u[0], u[1]))
  }
  check(maxCurl < 1e-5, `u = ∇⊥ψ: max deviation ${maxCurl.toExponential(1)} (max |u| ${fmt(maxU, 2)} per pull)`)

  let maxSlip = 0
  for (let i = 0; i < 40000; i++) {
    rodFrame(rand() * 2, rods)
    const k = i % 3
    const o = k * ROD_STRIDE
    const th = rand() * 2 * Math.PI
    const rx = Math.cos(th) * ROD_RADIUS * (1 + 1e-9)
    const ry = Math.sin(th) * ROD_RADIUS * (1 + 1e-9)
    velocity(rods[o] + rx, rods[o + 1] + ry, rods, u)
    const vx = rods[o + 2] - rods[o + 4] * ry
    const vy = rods[o + 3] + rods[o + 4] * rx
    maxSlip = Math.max(maxSlip, Math.hypot(u[0] - vx, u[1] - vy))
  }
  check(maxSlip < 1e-5, `rod surfaces move with the rods: max |u − rod| ${maxSlip.toExponential(1)}`)

  let minGap = Infinity
  for (let i = 0; i <= 20000; i++) {
    rodKinematics((i / 20000) * 2, rods)
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++) {
        const d = Math.hypot(rods[a * ROD_STRIDE] - rods[b * ROD_STRIDE], rods[a * ROD_STRIDE + 1] - rods[b * ROD_STRIDE + 1])
        minGap = Math.min(minGap, d - (2 * ROD_RADIUS + GUARD_WIDTH))
      }
  }
  check(minGap > 0, `guard zones never reach another rod: closest margin ${fmt(minGap, 4)}`)
}

// ----------------------------------------------------------------------------------- 3. tracers
console.log('\n3. tracers (200 × 200 grid, 6 pulls)')
const F = frames(PULLS, PULL_PROTOCOL)
{
  const xs: number[] = []
  const ys: number[] = []
  for (let j = 0; j < 200; j++)
    for (let i = 0; i < 200; i++) {
      const x = -1 + (i + 0.5) / 100
      const y = -1 + (j + 0.5) / 100
      let inRod = false
      for (let k = 0; k < 3; k++) if (Math.hypot(x - SLOT_X[k], y - SLOT_Y[k]) <= ROD_RADIUS) inRod = true
      if (!inRod) {
        xs.push(x)
        ys.push(y)
      }
    }
  const X = Float64Array.from(xs)
  const Y = Float64Array.from(ys)
  const o = new Float64Array(2)
  let pushes = 0
  let nan = 0
  let maxAbs = 0
  // Jacobian determinant of the one-pull map at every 7th tracer: two tangent vectors pushed
  // through each substep by finite differences and re-orthonormalised (QR), log |det| summed
  const eps = 1e-7
  const J = Math.ceil(X.length / 7)
  const q = new Float64Array(J * 4)
  const logDet = new Float64Array(J)
  for (let k = 0; k < J; k++) {
    q[k * 4] = 1
    q[k * 4 + 3] = 1
  }
  const a = new Float64Array(2)
  for (let n = 0; n < F.n; n++) {
    if (n < S) {
      for (let k = 0; k < J; k++) {
        const x = X[k * 7]
        const y = Y[k * 7]
        midpointStep(x, y, DT, F.f0[n], F.fm[n], F.f1[n], a)
        midpointStep(x + eps * q[k * 4], y + eps * q[k * 4 + 1], DT, F.f0[n], F.fm[n], F.f1[n], o)
        const v1x = (o[0] - a[0]) / eps
        const v1y = (o[1] - a[1]) / eps
        midpointStep(x + eps * q[k * 4 + 2], y + eps * q[k * 4 + 3], DT, F.f0[n], F.fm[n], F.f1[n], o)
        const v2x = (o[0] - a[0]) / eps
        const v2y = (o[1] - a[1]) / eps
        const r11 = Math.hypot(v1x, v1y)
        const q1x = v1x / r11
        const q1y = v1y / r11
        const r12 = q1x * v2x + q1y * v2y
        const wx = v2x - r12 * q1x
        const wy = v2y - r12 * q1y
        const r22 = Math.hypot(wx, wy)
        logDet[k] += Math.log(r11 * r22)
        q[k * 4] = q1x
        q[k * 4 + 1] = q1y
        q[k * 4 + 2] = wx / r22
        q[k * 4 + 3] = wy / r22
      }
    }
    for (let i = 0; i < X.length; i++) {
      if (midpointStep(X[i], Y[i], DT, F.f0[n], F.fm[n], F.f1[n], o)) pushes++
      X[i] = o[0]
      Y[i] = o[1]
      if (!Number.isFinite(o[0]) || !Number.isFinite(o[1])) nan++
      maxAbs = Math.max(maxAbs, Math.abs(o[0]), Math.abs(o[1]))
    }
  }
  const dets = Array.from(logDet, (l) => Math.abs(Math.exp(l) - 1)).sort((p, r) => p - r)
  const median = dets[Math.floor(dets.length / 2)]
  const p99 = dets[Math.floor(dets.length * 0.99)]
  check(nan === 0, `no NaN (${X.length} tracers)`)
  check(maxAbs < RESPAWN_BOUND, `all stay inside the domain: max |x|, |y| = ${fmt(maxAbs)} (respawn bound ${RESPAWN_BOUND})`)
  console.log(`       points put back on a rod surface (integration drift at no-slip walls): ${pushes} of ${X.length * F.n} steps (${fmt((100 * pushes) / (X.length * F.n), 3)} %)`)
  check(p99 < 3e-3, `one-pull map preserves area: |det J − 1| median ${median.toExponential(1)}, 99th percentile ${p99.toExponential(1)} (${J} tracers)`)
}

// ------------------------------------------------------------------------------ 4. material line
console.log('\n4. material line: 2000 points on y = 0, x ∈ [−0.8, 0.8] (length 1.6)')
const L0 = 1.6
function exactLine(fr: Frames, pulls: number): number[] {
  const o = new Float64Array(2)
  const advect = (s: number, steps: number) => {
    let x = -0.8 + 1.6 * s
    let y = 0
    for (let n = 0; n < steps; n++) {
      midpointStep(x, y, fr.dt, fr.f0[n], fr.fm[n], fr.f1[n], o)
      x = o[0]
      y = o[1]
    }
    return o
  }
  let s = new Float64Array(2000).map((_, i) => i / 1999)
  let X = s.map((v) => -0.8 + 1.6 * v)
  let Y = new Float64Array(2000)
  const lengths: number[] = []
  const perPull = Math.round(1 / fr.dt)
  for (let n = 0; n < pulls * perPull; n++) {
    for (let i = 0; i < X.length; i++) {
      midpointStep(X[i], Y[i], fr.dt, fr.f0[n], fr.fm[n], fr.f1[n], o)
      X[i] = o[0]
      Y[i] = o[1]
    }
    let extra = 0
    for (let i = 0; i + 1 < X.length; i++) if (Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]) > MAX_SEG) extra++
    if (X.length + extra > EXACT_CAP) break
    if (extra) {
      const ns = new Float64Array(X.length + extra)
      const nx = new Float64Array(X.length + extra)
      const ny = new Float64Array(X.length + extra)
      let w = 0
      for (let i = 0; i < X.length; i++) {
        ns[w] = s[i]
        nx[w] = X[i]
        ny[w] = Y[i]
        w++
        if (i + 1 < X.length && Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]) > MAX_SEG) {
          const sm = 0.5 * (s[i] + s[i + 1])
          const p = advect(sm, n + 1)
          ns[w] = sm
          nx[w] = p[0]
          ny[w] = p[1]
          w++
        }
      }
      s = ns
      X = nx
      Y = ny
    }
    if ((n + 1) % perPull === 0) {
      let L = 0
      for (let i = 1; i < X.length; i++) L += Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1])
      lengths.push(L)
    }
  }
  return lengths
}

/** L(t) = ∫ |∂x/∂s| ds from tangent elements (renormalised companions), midpoint rule */
function tangentLine(fr: Frames, pulls: number, count: number): number[] {
  const o = new Float64Array(2)
  const eps = 1e-6
  const X = new Float64Array(count)
  const Y = new Float64Array(count)
  const TX = new Float64Array(count)
  const TY = new Float64Array(count)
  const logS = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    X[i] = -0.8 + 1.6 * ((i + 0.5) / count)
    TX[i] = 1
  }
  const lengths: number[] = []
  const perPull = Math.round(1 / fr.dt)
  for (let n = 0; n < pulls * perPull; n++) {
    for (let i = 0; i < count; i++) {
      midpointStep(X[i] + eps * TX[i], Y[i] + eps * TY[i], fr.dt, fr.f0[n], fr.fm[n], fr.f1[n], o)
      const cx = o[0]
      const cy = o[1]
      midpointStep(X[i], Y[i], fr.dt, fr.f0[n], fr.fm[n], fr.f1[n], o)
      X[i] = o[0]
      Y[i] = o[1]
      const dx = (cx - o[0]) / eps
      const dy = (cy - o[1]) / eps
      const g = Math.hypot(dx, dy)
      logS[i] += Math.log(g)
      TX[i] = dx / g
      TY[i] = dy / g
    }
    if ((n + 1) % perPull === 0) {
      let L = 0
      for (let i = 0; i < count; i++) L += Math.exp(logS[i])
      lengths.push((L * 1.6) / count)
    }
  }
  return lengths
}

{
  const exact = exactLine(F, PULLS)
  const tangent = tangentLine(F, PULLS, TANGENTS)
  console.log('       pull   exact length   tangent estimate   ln(L_n / L_n−1)   ln(L_n / L_0) / n')
  const rates: number[] = []
  for (let n = 1; n <= PULLS; n++) {
    const L = tangent[n - 1]
    const Lp = n === 1 ? L0 : tangent[n - 2]
    const ex = exact[n - 1]
    const r = Math.log(L / Lp)
    rates.push(r)
    console.log(
      `       ${String(n).padStart(4)}   ${(ex !== undefined ? ex.toFixed(1) : '(too long)').padStart(12)}   ${L.toExponential(3).padStart(16)}   ${r.toFixed(3).padStart(15)}   ${(Math.log(L / L0) / n).toFixed(3).padStart(17)}`,
    )
  }
  const later = rates.slice(1)
  const mean = later.reduce((a, b) => a + b, 0) / later.length
  const spread = Math.sqrt(later.reduce((a, b) => a + (b - mean) ** 2, 0) / later.length)
  console.log(`       growth per pull over pulls 2–6: ${fmt(mean)} ± ${fmt(spread)}; braid floor ${fmt(BRAID_ENTROPY[PULL_PROTOCOL], 3)}`)
  if (exact.length > 0) {
    const agree = exact.every((L, i) => Math.abs(Math.log(L / tangent[i])) < 0.15)
    check(agree, `exact and tangent lengths agree within 15 % where both exist (${exact.length} pulls)`)
  }
  check(later.every((r) => r >= BRAID_ENTROPY[PULL_PROTOCOL]), 'growth per pull stays at or above the topological entropy')
  check(spread < 0.35 * mean, 'growth per pull is roughly constant (spread under 35 % of the mean)')

  const other: PullProtocol = PULL_PROTOCOL === 'alternating' ? 'repeat' : 'alternating'
  const t2 = tangentLine(frames(PULLS, other), PULLS, TANGENTS)
  const r2 = t2.map((L, i) => Math.log(L / (i === 0 ? L0 : t2[i - 1])))
  console.log(`       for comparison, '${other}': growth per pull ${r2.map((r) => r.toFixed(2)).join(', ')} (floor ${fmt(BRAID_ENTROPY[other], 3)})`)
}

// ---------------------------------------------------------------------------------- 5. substeps
console.log('\n5. substeps')
{
  // pointwise, chaos amplifies any difference, so compare what the eye sees: the line's length
  const fine = frames(1, PULL_PROTOCOL, 4 * S)
  const coarse = exactLine(frames(1, PULL_PROTOCOL), 1)[0]
  const ref = exactLine(fine, 1)[0]
  check(Math.abs(coarse / ref - 1) < 0.02, `line length after one pull: ${fmt(coarse, 2)} at ${S} substeps, ${fmt(ref, 2)} at ${4 * S} (${fmt(100 * (coarse / ref - 1), 2)} %)`)
  const o = new Float64Array(2)
  let sumD = 0
  let count = 0
  const rand = seeded(11)
  for (let i = 0; i < 2000; i++) {
    const r = BLOB_RADIUS * Math.sqrt(rand())
    const th = 2 * Math.PI * rand()
    let ax = r * Math.cos(th)
    let ay = r * Math.sin(th)
    let inRod = false
    for (let k = 0; k < 3; k++) if (Math.hypot(ax - SLOT_X[k], ay - SLOT_Y[k]) <= ROD_RADIUS) inRod = true
    if (inRod) continue
    let bx = ax
    let by = ay
    for (let n = 0; n < S / 2; n++) {
      midpointStep(ax, ay, DT, F.f0[n], F.fm[n], F.f1[n], o)
      ax = o[0]
      ay = o[1]
    }
    for (let n = 0; n < 2 * S; n++) {
      midpointStep(bx, by, fine.dt, fine.f0[n], fine.fm[n], fine.f1[n], o)
      bx = o[0]
      by = o[1]
    }
    sumD += Math.hypot(ax - bx, ay - by)
    count++
  }
  console.log(`       after one half-turn the same points sit ${(sumD / count).toExponential(1)} apart on average (${fmt((sumD / count) * 352, 2)} px at the stage's framing)`)
}

// ------------------------------------------------------------------------------------- preview
const pngAt = process.argv.indexOf('--png')
if (pngAt > 0) {
  const path = process.argv[pngAt + 1] ?? 'taffy.png'
  const list = (process.argv[pngAt + 2] ?? '0,1,2,4,6').split(',').map(Number)
  renderPreview(path, list)
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The taffy as the GPU draws it at the default framing (camera 3.9 at fov 40, 1000 px tall). */
function renderPreview(path: string, pulls: number[]) {
  const N = 512 * 512
  const state = new Float32Array(N * 4)
  freshTaffy(N, state)
  const X = new Float64Array(N)
  const Y = new Float64Array(N)
  const C = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    X[i] = state[i * 4]
    Y[i] = state[i * 4 + 1]
    C[i] = state[i * 4 + 2]
  }
  const pxPerUnit = 1000 / (2 * 3.9 * Math.tan((20 * Math.PI) / 180))
  const W = Math.round(2 * BOUNDARY_RADIUS * 1.04 * pxPerUnit)
  const half = W / 2 / pxPerUnit
  const IW = W * pulls.length
  const img = new Float32Array(IW * W * 3)
  const warm = [0.961, 0.703, 0.713] // speedColor(0.85)
  const cool = [0.288, 0.24, 0.816] // speedColor(0.3)
  const gain = 0.08 * Math.min(Math.max((pxPerUnit / REF_PX_PER_UNIT) ** 2, 1 / 16), 16)
  const ink = [0.863, 0.807, 0.723] // #efe8dc, linear
  const o = new Float64Array(2)
  const f0 = new Float64Array(ROD_FRAME)
  const fm = new Float64Array(ROD_FRAME)
  const f1 = new Float64Array(ROD_FRAME)
  const rods = new Float64Array(ROD_FRAME)
  let n = 0
  pulls.forEach((target, col) => {
    for (; n < Math.round(target * S); n++) {
      rodFrame(n / S, f0)
      rodFrame((n + 0.5) / S, fm)
      rodFrame((n + 1) / S, f1)
      for (let i = 0; i < N; i++) {
        midpointStep(X[i], Y[i], DT, f0, fm, f1, o)
        X[i] = o[0]
        Y[i] = o[1]
      }
    }
    // points: 1.6 px soft discs, additive
    for (let i = 0; i < N; i++) {
      const sx = (X[i] + half) * pxPerUnit
      const sy = (half - Y[i]) * pxPerUnit
      const c = C[i] ? cool : warm
      for (let py = Math.floor(sy - 0.8); py <= Math.floor(sy + 0.8); py++)
        for (let px = Math.floor(sx - 0.8); px <= Math.floor(sx + 0.8); px++) {
          if (px < 0 || py < 0 || px >= W || py >= W) continue
          const qx = (px + 0.5 - sx) / 0.8
          const qy = (py + 0.5 - sy) / 0.8
          const d2 = qx * qx + qy * qy
          if (Math.abs(qx) > 1 || Math.abs(qy) > 1 || d2 > 1) continue
          const w = Math.exp(-2 * d2) * gain
          const k = (py * IW + col * W + px) * 3
          img[k] += c[0] * w
          img[k + 1] += c[1] * w
          img[k + 2] += c[2] * w
        }
    }
    // rods (2 px rings, ink 0.72) and the boundary (1.2 px, ink 0.15)
    rodKinematics(target, rods)
    for (let py = 0; py < W; py++)
      for (let px = 0; px < W; px++) {
        const x = (px + 0.5) / pxPerUnit - half
        const y = half - (py + 0.5) / pxPerUnit
        const ring = (d: number, r: number, h: number) => 1 - smooth(h - 0.5, h + 0.5, Math.abs(d - r) * pxPerUnit)
        let a = 0.15 * ring(Math.hypot(x, y), BOUNDARY_RADIUS, 0.6)
        for (let k = 0; k < 3; k++) a += 0.72 * ring(Math.hypot(x - rods[k * ROD_STRIDE], y - rods[k * ROD_STRIDE + 1]), ROD_RADIUS, 1)
        const k = (py * IW + col * W + px) * 3
        img[k] += ink[0] * a
        img[k + 1] += ink[1] * a
        img[k + 2] += ink[2] * a
      }
  })
  writePng(path, IW, W, toSrgb(img))
  console.log(`\npreview written to ${path} (pulls ${pulls.join(', ')})`)
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

