/**
 * Checks the chaos-game presets:  pnpm tsx src/fractal/ifs/verify-presets.ts [--png out.png]
 *
 * 1. Frame. A 200,000-step chaos game per preset in published coordinates (the first 1,000
 *    iterates dropped). The baked `frame` must match the 0.05–99.95 percentile box within 1 % of
 *    its size. The 0.5–99.5 box and the full extent are printed alongside: the tighter box cuts
 *    real attractor off (Sierpiński's corners, the fern's stalk), because an IFS orbit has no
 *    outliers once it is on the attractor, only sparse parts.
 * 2. Variation. At v = −1, −0.5, 0.5, 1 the stage-unit system the GPU runs stays bounded over
 *    200,000 steps (every iterate finite and well inside the respawn bound) and inside a
 *    ±VARIATION_LIMIT stage-unit square; its box is printed against the frame.
 * 3. Packing. presetUniforms' rows equal stageMap; the cumulative probabilities never decrease
 *    and end at exactly 1, with 1 in every unused slot; each map's motion (fixed point, R(phi) S)
 *    reproduces the map, so a point moved along it to t = 1 lands where the map puts it, and a
 *    copy never shrinks below its final area on the way (no pinch).
 * 4. Gain. The point density on screen at the reference size (one stage unit = 260 CSS px):
 *    the baked `gain` must be within 15 % of REF_DENSITY / (density at the median point),
 *    clamped to GAIN_MIN..GAIN_MAX.
 *
 * --png renders the preview grid (rows: presets; columns: v = −1, 0, 1) after 24 collage
 * iterations of 262,144 points, as the GPU runs them.
 *
 * Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import {
  IFS_PRESETS,
  IFS_PRESET_ORDER,
  MAP_COUNT_MAX,
  presetUniforms,
  slotTone,
  stageFrame,
  stageMap,
  type IfsFrame,
  type IfsMap,
  type StageMap,
} from './presets'
import { REF_PX_PER_STAGE } from './shaders'
import type { IfsPreset } from '../types'

const STEPS = 200_000
const TRANSIENT = 1_000
const FRAME_TOL = 0.01
/** stage units; far inside IfsSim's RESPAWN_BOUND of 50 */
const VARIATION_LIMIT = 1.6
/** points per CSS px² at the median point that `gain` 1 is tuned for; see ChaosGame */
const REF_DENSITY = 8
const GAIN_MIN = 0.4
const GAIN_MAX = 2.5
const GAIN_TOL = 0.15
const N_POINTS = 512 * 512

let failures = 0
function check(ok: boolean, msg: string) {
  if (!ok) {
    failures++
    console.log(`  FAIL ${msg}`)
  }
}

/** Small, fast, seedable PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Affine = { a: number; b: number; c: number; d: number; e: number; f: number }

/** Run the chaos game; returns the iterates after the transient (null if any went non-finite). */
function orbit(maps: readonly Affine[], probs: readonly number[], steps: number, seed = 7) {
  const rand = mulberry32(seed)
  const cum: number[] = []
  let total = 0
  for (const p of probs) cum.push((total += p))
  const xs = new Float64Array(steps)
  const ys = new Float64Array(steps)
  let x = 0
  let y = 0
  for (let i = 0; i < steps + TRANSIENT; i++) {
    const u = rand() * total
    let k = 0
    while (k < maps.length - 1 && u >= cum[k]) k++
    const m = maps[k]
    const nx = m.a * x + m.b * y + m.e
    y = m.c * x + m.d * y + m.f
    x = nx
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (i >= TRANSIENT) {
      xs[i - TRANSIENT] = x
      ys[i - TRANSIENT] = y
    }
  }
  return { xs, ys }
}

function quantileBox(xs: Float64Array, ys: Float64Array, q: number) {
  const sx = Float64Array.from(xs).sort()
  const sy = Float64Array.from(ys).sort()
  const at = (s: Float64Array, p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
  return { x0: at(sx, q), x1: at(sx, 1 - q), y0: at(sy, q), y1: at(sy, 1 - q) }
}

type Box = ReturnType<typeof quantileBox>
const boxFrame = (b: Box): IfsFrame => ({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, halfW: (b.x1 - b.x0) / 2, halfH: (b.y1 - b.y0) / 2 })
const fmt = (v: number, d = 4) => (v >= 0 ? ' ' : '') + v.toFixed(d)
const fmtBox = (b: Box, d = 3) => `x [${fmt(b.x0, d)}, ${fmt(b.x1, d)}]  y [${fmt(b.y0, d)}, ${fmt(b.y1, d)}]`
const fmtFrame = (f: IfsFrame) => `{ cx: ${+f.cx.toFixed(4)}, cy: ${+f.cy.toFixed(4)}, halfW: ${+f.halfW.toFixed(4)}, halfH: ${+f.halfH.toFixed(4)} }`

function stageMaps(id: IfsPreset, v: number): StageMap[] {
  return IFS_PRESETS[id].maps.map((_, i) => stageMap(id, i, v, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }))
}

for (const id of IFS_PRESET_ORDER) {
  const def = IFS_PRESETS[id]
  const probs = def.maps.map((m: IfsMap) => m.p)
  console.log(`\n${id}`)

  // 1. frame
  const run = orbit(def.maps, probs, STEPS)
  check(run !== null, 'published system is not bounded')
  if (!run) continue
  const box = quantileBox(run.xs, run.ys, 0.0005)
  const measured = boxFrame(box)
  const fr = def.frame
  const tolX = FRAME_TOL * 2 * measured.halfW
  const tolY = FRAME_TOL * 2 * measured.halfH
  console.log(`  frame 0.05–99.95 %  ${fmtBox(box)}  →  ${fmtFrame(measured)}`)
  console.log(`  frame 0.5–99.5 %    ${fmtBox(quantileBox(run.xs, run.ys, 0.005))}`)
  console.log(`  full extent         ${fmtBox(quantileBox(run.xs, run.ys, 0))}`)
  check(
    Math.abs(fr.cx - measured.cx) <= tolX &&
      Math.abs(fr.cy - measured.cy) <= tolY &&
      Math.abs(fr.halfW - measured.halfW) <= tolX &&
      Math.abs(fr.halfH - measured.halfH) <= tolY,
    `baked frame ${fmtFrame(fr)} is not the measured one`,
  )

  // 2. variation
  for (const v of [-1, -0.5, 0.5, 1]) {
    const vr = orbit(stageMaps(id, v), probs, STEPS)
    check(vr !== null, `v = ${v}: blows up`)
    if (!vr) continue
    const full = quantileBox(vr.xs, vr.ys, 0)
    const lim = Math.max(Math.abs(full.x0), Math.abs(full.x1), Math.abs(full.y0), Math.abs(full.y1))
    const sf = stageFrame(id)
    const b = quantileBox(vr.xs, vr.ys, 0.0005)
    console.log(
      `  v = ${fmt(v, 1)}  box ${fmtBox(b)}  (frame ±${sf.halfW.toFixed(3)} × ±${sf.halfH.toFixed(3)}; furthest point ${lim.toFixed(3)})`,
    )
    check(lim < VARIATION_LIMIT, `v = ${v}: reaches ${lim.toFixed(3)} stage units`)
  }

  // 3. packing
  for (const v of [-1, 0, 0.37, 1]) {
    const u = presetUniforms(id, v)
    const maps = stageMaps(id, v)
    check(u.count === def.maps.length, `count ${u.count}`)
    for (let i = 0; i < MAP_COUNT_MAX; i++) {
      if (i > 0) check(u.cumulative[i] >= u.cumulative[i - 1], `cumulative decreases at ${i}`)
      if (i >= u.count - 1) check(u.cumulative[i] === 1, `cumulative[${i}] = ${u.cumulative[i]}, want 1`)
      if (i >= u.count) continue
      const m = maps[i]
      const row = u.maps.subarray(i * 6, i * 6 + 6)
      const want = [m.a, m.b, m.e, m.c, m.d, m.f]
      check(want.every((w, j) => Math.abs(row[j] - w) < 1e-6), `rows of map ${i} at v = ${v}`)
      check(u.tones[i] === Math.fround(slotTone(def.maps[i].color)), `tone of map ${i}`)
      // motion: A = R(phi) S, S symmetric, fixed point fixed; endpoint of the motion = the map
      const [fx, fy, phi, , s11, s12, s22] = u.motion.subarray(i * 8, i * 8 + 8)
      const cs = Math.cos(phi)
      const sn = Math.sin(phi)
      const A = [cs * s11 - sn * s12, cs * s12 - sn * s22, sn * s11 + cs * s12, sn * s12 + cs * s22]
      check(
        Math.abs(A[0] - m.a) < 1e-5 && Math.abs(A[1] - m.b) < 1e-5 && Math.abs(A[2] - m.c) < 1e-5 && Math.abs(A[3] - m.d) < 1e-5,
        `motion of map ${i} at v = ${v} does not reproduce A`,
      )
      check(
        Math.abs(m.a * fx + m.b * fy + m.e - fx) < 1e-5 && Math.abs(m.c * fx + m.d * fy + m.f - fy) < 1e-5,
        `fixed point of map ${i} at v = ${v}`,
      )
      check(s11 + s22 >= -1e-9, `S of map ${i} has negative trace`)
      const px = 0.31
      const py = -0.72
      const dx = px - fx
      const dy = py - fy
      const sx = s11 * dx + s12 * dy
      const sy = s12 * dx + s22 * dy
      const ex = fx + cs * sx - sn * sy
      const ey = fy + sn * sx + cs * sy
      check(Math.abs(ex - (m.a * px + m.b * py + m.e)) < 1e-5 && Math.abs(ey - (m.c * px + m.d * py + m.f)) < 1e-5, `motion endpoint of map ${i}`)
      // no pinch: along the motion a copy's area, det((1−t) I + t S), never drops below what the
      // map ends at (a straight chord would take the dragon's 135° copy down to a tenth of it)
      const detA = m.a * m.d - m.b * m.c
      if (detA > 0) {
        let least = Infinity
        for (let k = 0; k <= 32; k++) {
          const t = k / 32
          const q11 = 1 - t + t * s11
          const q22 = 1 - t + t * s22
          const q12 = t * s12
          least = Math.min(least, q11 * q22 - q12 * q12)
        }
        check(least >= Math.min(1, detA) * (1 - 1e-6), `motion of map ${i} at v = ${v} pinches to area ${least.toFixed(4)}`)
      }
    }
  }

  // 4. gain
  {
    const g = orbit(stageMaps(id, 0), probs, N_POINTS, 99)
    if (g) {
      const W = 1400
      const grid = new Uint32Array(W * W)
      for (let i = 0; i < N_POINTS; i++) {
        const px = Math.floor(g.xs[i] * REF_PX_PER_STAGE + W / 2)
        const py = Math.floor(g.ys[i] * REF_PX_PER_STAGE + W / 2)
        if (px >= 0 && py >= 0 && px < W && py < W) grid[py * W + px]++
      }
      const counts = Array.from(grid.filter((c) => c > 0)).sort((a, b) => a - b)
      let acc = 0
      let median = 0
      for (const c of counts) {
        acc += c
        if (acc >= N_POINTS / 2) {
          median = c
          break
        }
      }
      const want = Math.min(GAIN_MAX, Math.max(GAIN_MIN, REF_DENSITY / median))
      console.log(`  density at the median point ${median} / px²  →  gain ${want.toFixed(2)} (baked ${def.gain})`)
      check(Math.abs(def.gain - want) <= GAIN_TOL * want, `gain ${def.gain}, want ≈ ${want.toFixed(2)}`)
    }
  }
}

// ---------------------------------------------------------------- optional preview

const pngAt = process.argv.indexOf('--png')
if (pngAt > 0) {
  const path = process.argv[pngAt + 1] ?? 'ifs-presets.png'
  const CELL = 300
  const VIEW = 1.25
  const cols = [-1, 0, 1]
  const W = CELL * cols.length
  const H = CELL * IFS_PRESET_ORDER.length
  const img = new Float32Array(W * H * 3)
  const ramp = [
    [0.043, 0.114, 0.42],
    [0.302, 0.247, 0.839],
    [0.914, 0.416, 0.627],
    [1.0, 0.941, 0.784],
  ]
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const speedColor = (t: number) => {
    const w = [ss(0, 0.35, t), ss(0.35, 0.68, t), ss(0.68, 1, t)]
    let c = ramp[0]
    for (let i = 0; i < 3; i++) c = c.map((v, j) => v + (ramp[i + 1][j] - v) * w[i])
    return c
  }
  IFS_PRESET_ORDER.forEach((id, row) => {
    const def = IFS_PRESETS[id]
    cols.forEach((v, col) => {
      const maps = stageMaps(id, v)
      const cum: number[] = []
      let total = 0
      for (const m of def.maps) cum.push((total += m.p))
      const rand = mulberry32(1234)
      const xs = new Float64Array(N_POINTS)
      const ys = new Float64Array(N_POINTS)
      const which = new Int8Array(N_POINTS)
      for (let i = 0; i < N_POINTS; i++) {
        xs[i] = 2 * rand() - 1
        ys[i] = 2 * rand() - 1
      }
      for (let it = 0; it < 24; it++) {
        for (let i = 0; i < N_POINTS; i++) {
          const u = rand() * total
          let k = 0
          while (k < maps.length - 1 && u >= cum[k]) k++
          const m = maps[k]
          const x = xs[i]
          xs[i] = m.a * x + m.b * ys[i] + m.e
          ys[i] = m.c * x + m.d * ys[i] + m.f
          which[i] = k
        }
      }
      const gain = 0.08 * def.gain * ((CELL / (2 * VIEW)) / REF_PX_PER_STAGE) ** 2 * 1.1
      for (let i = 0; i < N_POINTS; i++) {
        const px = Math.floor((xs[i] / VIEW / 2 + 0.5) * CELL)
        const py = Math.floor((0.5 - ys[i] / VIEW / 2) * CELL)
        if (px < 0 || py < 0 || px >= CELL || py >= CELL) continue
        const c = speedColor(slotTone(def.maps[which[i]].color))
        const o = ((row * CELL + py) * W + col * CELL + px) * 3
        for (let j = 0; j < 3; j++) img[o + j] += c[j] * gain
      }
    })
  })
  // filmic-ish shoulder, then sRGB
  const rgb = new Uint8Array(W * H * 3)
  for (let i = 0; i < rgb.length; i++) {
    const x = 1 - Math.exp(-img[i])
    rgb[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055))
  }
  writePng(path, W, H, rgb)
  console.log(`\npreview written to ${path}`)
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

function writePng(path: string, w: number, h: number, rgb: Uint8Array) {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(Buffer.from(type, 'ascii'), 4)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = 2
  writeFileSync(
    path,
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]),
  )
}
