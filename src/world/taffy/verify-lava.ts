/**
 * Checks the lava-lamp wall:  pnpm tsx src/world/taffy/verify-lava.ts [--png out.png [unixSeconds]]
 *
 * 1. Hash. The limb-wise FNV-1a 256 equals a BigInt reference (offset basis
 *    0xdd268dbc…aee0535, prime 2^168 + 2^8 + 0x63) on random byte strings.
 * 2. Key. 64 lowercase hex characters, the same for the same second, different for each of
 *    3,600 consecutive seconds, and its bits balanced (mean ≈ 0.5).
 * 3. Wax. Over a day sampled every 7 s, every blob stays inside its glass.
 * 4. Light. `shadeLava` mirrors lavaFrag line for line; over the whole wall at several times the
 *    brightest channel before the final clamp stays at or under LAVA_MAX_VALUE.
 *
 * --png renders the wall at 1500 × 1000 (about its size on screen at the lamps pose) at the given
 * Unix time (default now). Exits non-zero if any check fails. Not bundled.
 */
import {
  BLOBS_PER_LAMP,
  LAMP_COLS,
  LAMP_COUNT,
  LAMP_ROWS,
  LAMP_SHAPE as S,
  LAMP_TEXELS,
  WAX_PALETTE,
  fnv256Byte,
  fnv256Hex,
  fnv256Reset,
  lavaBlobs,
  lavaKey,
} from './lava'
import { LAVA_MAX_VALUE } from './lavaShaders'
import { writePng } from './png'

let failures = 0
function check(ok: boolean, msg: string) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}

// --------------------------------------------------------------------------------------- 1. hash
console.log('\n1. FNV-1a 256')
{
  const OFFSET = 0xdd268dbcaac550362d98c384c4e576ccc8b1536847b6bbb31023b4c8caee0535n
  const PRIME = (1n << 168n) + (1n << 8n) + 0x63n
  const MASK = (1n << 256n) - 1n
  const ref = (bytes: number[]) => {
    let h = OFFSET
    for (const b of bytes) h = ((h ^ BigInt(b)) * PRIME) & MASK
    return h.toString(16).padStart(64, '0')
  }
  const mine = (bytes: number[]) => {
    fnv256Reset()
    for (const b of bytes) fnv256Byte(b)
    return fnv256Hex()
  }
  let same = mine([]) === ref([])
  let seed = 3
  for (let t = 0; t < 200 && same; t++) {
    const bytes: number[] = []
    const n = t * 3
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0
      bytes.push(seed >>> 24)
    }
    same = mine(bytes) === ref(bytes)
  }
  check(same, 'matches the BigInt reference on the empty string and 200 random strings')
}

// ---------------------------------------------------------------------------------------- 2. key
console.log('\n2. key')
{
  const t0 = 1_790_000_000
  const k = lavaKey(t0)
  check(/^[0-9a-f]{64}$/.test(k), `64 hex characters: ${k}`)
  check(lavaKey(t0) === k, 'the same second gives the same key')
  const seen = new Set<string>()
  let ones = 0
  for (let i = 0; i < 3600; i++) {
    const key = lavaKey(t0 + i)
    seen.add(key)
    for (const ch of key) {
      let v = parseInt(ch, 16)
      while (v) {
        ones += v & 1
        v >>= 1
      }
    }
  }
  check(seen.size === 3600, `3,600 consecutive seconds give ${seen.size} distinct keys`)
  const mean = ones / (3600 * 256)
  check(Math.abs(mean - 0.5) < 0.01, `bits balanced: mean ${mean.toFixed(4)}`)
  const t1 = performance.now()
  for (let i = 0; i < 100; i++) lavaKey(t0 + i)
  console.log(`       ${((performance.now() - t1) / 100).toFixed(3)} ms per key`)
}

// ---------------------------------------------------------------------------------------- 3. wax
console.log('\n3. wax stays in its glass')
const blobs = new Float64Array(LAMP_COUNT * LAMP_TEXELS * 4)
{
  let worst = -Infinity
  const t0 = 1_790_000_000
  for (let t = t0; t < t0 + 86400; t += 7) {
    lavaBlobs(t, blobs)
    for (let i = 0; i < LAMP_COUNT; i++)
      for (let j = 0; j < BLOBS_PER_LAMP; j++) {
        const o = (i * LAMP_TEXELS + j) * 4
        const x = blobs[o]
        const y = blobs[o + 1]
        const r = blobs[o + 2]
        const st = blobs[o + 3]
        // the blob's outline: semi-axes r / √st across, r √st along y
        const ax = r / Math.sqrt(st)
        const ay = r * Math.sqrt(st)
        for (let a = 0; a < 16; a++) {
          const th = (a / 16) * 2 * Math.PI
          const sd = sdGlass(x + ax * Math.cos(th), y + ay * Math.sin(th))
          // the bottom of the glass is the wax pool, which a sunk blob may overlap
          if (y + ay * Math.sin(th) < S.glassLowY - S.glassLowR + S.poolDepth) continue
          worst = Math.max(worst, sd + S.glassWall)
        }
      }
  }
  check(worst <= 0.002, `deepest excursion into the glass wall over a day: ${worst.toFixed(4)} lamp units`)
}

// -------------------------------------------------------------------------------------- 4. light
console.log('\n4. light')
const waxLinear = new Float64Array(WAX_PALETTE.length * 3)
WAX_PALETTE.forEach((w, i) => {
  const n = parseInt(w.hex.slice(1), 16)
  ;[(n >> 16) & 255, (n >> 8) & 255, n & 255].forEach((c, k) => {
    const v = c / 255
    waxLinear[i * 3 + k] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
})
const W = 1500
const H = 1000
{
  let maxRaw = 0
  const col = new Float64Array(3)
  for (const t of [1_790_000_000, 1_790_000_013, 1_790_003_333, 1_790_050_001]) {
    lavaBlobs(t, blobs, waxLinear)
    for (let py = 0; py < H; py += 2)
      for (let px = 0; px < W; px += 2) {
        shadeLava((px + 0.5) / W, 1 - (py + 0.5) / H, 4.8, 3.2, W, blobs, col)
        maxRaw = Math.max(maxRaw, col[0], col[1], col[2])
      }
  }
  check(maxRaw <= LAVA_MAX_VALUE, `brightest channel before the clamp: ${maxRaw.toFixed(3)} (ceiling ${LAVA_MAX_VALUE})`)
}

const pngAt = process.argv.indexOf('--png')
if (pngAt > 0) {
  const path = process.argv[pngAt + 1] ?? 'lava.png'
  const t = Number(process.argv[pngAt + 2] ?? Date.now() / 1000)
  lavaBlobs(t, blobs, waxLinear)
  const rgb = new Uint8Array(W * H * 3)
  const col = new Float64Array(3)
  const acc = new Float64Array(3)
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      acc.fill(0)
      // 2 × 2 supersampling
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 2; sx++) {
          shadeLava((px + 0.25 + 0.5 * sx) / W, 1 - (py + 0.25 + 0.5 * sy) / H, 4.8, 3.2, W, blobs, col)
          for (let c = 0; c < 3; c++) acc[c] += Math.min(col[c], LAVA_MAX_VALUE) / 4
        }
      for (let c = 0; c < 3; c++) {
        // AgX-like soft shoulder, then sRGB
        const x = 1 - Math.exp(-acc[c] * 1.2)
        rgb[(py * W + px) * 3 + c] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055))
      }
    }
  writePng(path, W, H, rgb)
  console.log(`\npreview written to ${path} (t = ${t}, key ${lavaKey(Math.floor(t)).slice(0, 16)}…)`)
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

// ---------------------------------------------------------------------------- the shader mirror

function sdGlass(x: number, y: number): number {
  return sdUnevenCapsule(x, y - S.glassLowY, S.glassLowR, S.glassHighR, S.glassHighY - S.glassLowY)
}

function sdUnevenCapsule(px: number, py: number, r1: number, r2: number, h: number): number {
  px = Math.abs(px)
  const b = (r1 - r2) / h
  const a = Math.sqrt(1 - b * b)
  const k = -b * px + a * py
  if (k < 0) return Math.hypot(px, py) - r1
  if (k > a * h) return Math.hypot(px, py - h) - r2
  return a * px + b * py - r1
}

function sdTrapezoid(px: number, py: number, r1: number, r2: number, he: number): number {
  const k1x = r2
  const k1y = he
  const k2x = r2 - r1
  const k2y = 2 * he
  px = Math.abs(px)
  const cax = px - Math.min(px, py < 0 ? r1 : r2)
  const cay = Math.abs(py) - he
  const t = clamp(((k1x - px) * k2x + (k1y - py) * k2y) / (k2x * k2x + k2y * k2y), 0, 1)
  const cbx = px - k1x + k2x * t
  const cby = py - k1y + k2y * t
  const s = cbx < 0 && cay < 0 ? -1 : 1
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby))
}

function clamp(x: number, a: number, b: number) {
  return Math.min(Math.max(x, a), b)
}
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
function sq(x: number): number {
  return x * x
}

/** wax field at lamp point (qx, qy) */
function waxField(qx: number, qy: number, lamp: number, data: Float64Array): number {
  const glassBottom = S.glassLowY - S.glassLowR
  let field = (S.poolDepth * S.poolDepth) / Math.max(sq(qy - glassBottom), 1e-6)
  for (let j = 0; j < BLOBS_PER_LAMP; j++) {
    const o = (lamp * LAMP_TEXELS + j) * 4
    const st = data[o + 3]
    const dx = (qx - data[o]) * Math.sqrt(st)
    const dy = (qy - data[o + 1]) / Math.sqrt(st)
    field += (data[o + 2] * data[o + 2]) / Math.max(dx * dx + dy * dy, 1e-6)
  }
  return field
}

/** lavaFrag at plane uv (u, v up), plane width × height, rendered `pxW` pixels wide; linear, unclamped */
export function shadeLava(u: number, v: number, width: number, height: number, pxW: number, data: Float64Array, out: Float64Array) {
  const cellFx = u * LAMP_COLS
  const cellFy = v * LAMP_ROWS
  const cx = Math.min(Math.floor(cellFx), LAMP_COLS - 1)
  const cy = Math.min(Math.floor(cellFy), LAMP_ROWS - 1)
  const csx = width / LAMP_COLS
  const csy = height / LAMP_ROWS
  const unit = Math.min(csx, csy)
  const qx = ((cellFx - cx - 0.5) * csx) / unit
  const qy = ((cellFy - cy - 0.5) * csy) / unit
  const lamp = (LAMP_ROWS - 1 - cy) * LAMP_COLS + cx
  const aa = width / unit / pxW

  const lo = (lamp * LAMP_TEXELS + BLOBS_PER_LAMP) * 4
  const wax = [data[lo], data[lo + 1], data[lo + 2]]
  const bulb = data[lo + 3]
  const glow = [0, 1, 2].map((k) => (wax[k] + ([1.0, 0.74, 0.42][k] - wax[k]) * 0.45) * bulb)
  const WALL = [0.0095, 0.0062, 0.0046]
  const SHELF = [0.016, 0.0105, 0.0078]
  const METAL = [0.02, 0.017, 0.015]
  const WW = [1.0, 0.93, 0.84]
  const fill = (sd: number) => 1 - smoothstep(-aa, aa, sd)
  const mix3 = (a: number[], b: number[], t: number) => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t)

  const glassBottom = S.glassLowY - S.glassLowR
  const glassTop = S.glassHighY + S.glassHighR
  const sdG = sdGlass(qx, qy)
  const sdBase = sdTrapezoid(qx, qy - 0.5 * (S.baseBottom + S.baseTop), S.baseHalfBottom, S.baseHalfTop, 0.5 * (S.baseTop - S.baseBottom))
  const sdCap = sdTrapezoid(qx, qy - 0.5 * (S.capBottom + S.capTop), S.capHalfBottom, S.capHalfTop, 0.5 * (S.capTop - S.capBottom))

  const outD = Math.max(sdG, 0)
  let col = [0, 1, 2].map((k) => WALL[k] + glow[k] * 0.035 * Math.exp((-outD * outD) / 0.0042))

  const shelfTop = S.baseBottom
  const onShelf = 1 - smoothstep(shelfTop - aa, shelfTop + aa, qy)
  const shelf = [0, 1, 2].map(
    (k) =>
      SHELF[k] +
      WW[k] * 0.018 * Math.exp(-sq((qy - shelfTop) / Math.max(0.004, aa))) +
      glow[k] * 0.03 * Math.exp((-qx * qx) / 0.012) * smoothstep(shelfTop - 0.03, shelfTop, qy),
  )
  col = mix3(col, shelf, onShelf)

  const y01 = clamp((qy - glassBottom) / (glassTop - glassBottom), 0, 1)
  const liquid = glow.map((g) => g * (0.03 + 0.11 * Math.exp(-3.2 * y01)))
  const field = waxField(qx, qy, lamp, data)
  // fwidth(field) = |dF/dx| + |dF/dy| over one pixel
  const fw = clamp(Math.abs(waxField(qx + aa, qy, lamp, data) - field) + Math.abs(waxField(qx, qy + aa, lamp, data) - field), 1e-3, 0.5)
  const waxMask = smoothstep(1 - fw, 1 + fw, field)
  const heat = Math.exp(-1.6 * y01)
  const core = smoothstep(1, 3, field)
  const waxLit = wax.map((w) => w * bulb * (0.42 + 0.33 * heat) * (0.82 + 0.18 * core))
  const inner = fill(sdG + S.glassWall)
  const content = mix3(liquid, waxLit, waxMask * inner)
  const rim = Math.exp(-sq((sdG + 0.5 * S.glassWall) / Math.max(0.5 * S.glassWall, aa)))
  const hw = S.glassLowR + (S.glassHighR - S.glassLowR) * clamp((qy - S.glassLowY) / (S.glassHighY - S.glassLowY), 0, 1)
  const spec =
    Math.exp(-sq((qx / hw + 0.6) / 0.11)) *
    smoothstep(glassBottom + 0.02, glassBottom + 0.12, qy) *
    (1 - smoothstep(glassTop - 0.1, glassTop - 0.01, qy))
  for (let k = 0; k < 3; k++) content[k] += (glow[k] + (WW[k] - glow[k]) * 0.5) * 0.07 * rim + WW[k] * 0.085 * spec
  col = mix3(col, content, fill(sdG))

  const baseH = (qy - S.baseBottom) / (S.baseTop - S.baseBottom)
  const bw = S.baseHalfBottom + (S.baseHalfTop - S.baseHalfBottom) * clamp(baseH, 0, 1)
  const base = [0, 1, 2].map(
    (k) =>
      METAL[k] * (0.7 + 0.6 * baseH) +
      WW[k] * 0.03 * Math.exp(-sq((qx / bw + 0.45) / 0.2)) +
      glow[k] * 0.16 * Math.exp(-sq((qy - S.baseTop) / 0.012)) +
      glow[k] * 0.025 * smoothstep(0.4, 1, baseH),
  )
  col = mix3(col, base, fill(sdBase))

  const cw = S.capHalfBottom + (S.capHalfTop - S.capHalfBottom) * clamp((qy - S.capBottom) / (S.capTop - S.capBottom), 0, 1)
  const cap = [0, 1, 2].map(
    (k) => METAL[k] + WW[k] * 0.025 * Math.exp(-sq((qx / cw + 0.45) / 0.22)) + glow[k] * 0.05 * Math.exp(-sq((qy - S.capBottom) / 0.015)),
  )
  col = mix3(col, cap, fill(sdCap))

  const ex = (u - 0.5) * 2
  const ey = (v - 0.5) * 2 * 0.92
  const vg = 1 - 0.42 * smoothstep(0.3, 1.5, Math.hypot(ex, ey))
  out[0] = col[0] * vg
  out[1] = col[1] * vg
  out[2] = col[2] * vg
}
