/**
 * The lava-lamp wall's lamps and wax, computed on the CPU in double precision so the wall
 * (LavaWall uploads `lavaBlobs` into a small texture every frame) and the key (`lavaKey`) see
 * exactly the same blobs at the same time. Time is Unix seconds, as Date.now() / 1000.
 *
 * Lamp units: a lamp lives in one cell of a LAMP_COLS × LAMP_ROWS grid, measured in units of the
 * cell's smaller side, origin at the cell centre, +y up. The silhouette constants below are
 * shared with the shader (lavaShaders.ts).
 */

export const LAMP_COLS = 12
export const LAMP_ROWS = 8
export const LAMP_COUNT = LAMP_COLS * LAMP_ROWS
export const BLOBS_PER_LAMP = 3
export const BLOB_COUNT = LAMP_COUNT * BLOBS_PER_LAMP
/** texels per lamp in the wall's data texture: one per blob, then the lamp's colour */
export const LAMP_TEXELS = BLOBS_PER_LAMP + 1

/** silhouette, lamp units (see the header) */
export const LAMP_SHAPE = {
  /** metal base: a cone from baseBottom (half-width baseHalfBottom) up to baseTop */
  baseBottom: -0.47,
  baseTop: -0.19,
  baseHalfBottom: 0.15,
  baseHalfTop: 0.085,
  /** glass: an uneven capsule, a wide circle low and a narrow one high */
  glassLowY: -0.08,
  glassLowR: 0.125,
  glassHighY: 0.27,
  glassHighR: 0.058,
  /** glass wall thickness */
  glassWall: 0.01,
  /** metal cap */
  capBottom: 0.31,
  capTop: 0.41,
  capHalfBottom: 0.062,
  capHalfTop: 0.04,
  /** the wax pool at the bottom of the glass is this deep */
  poolDepth: 0.034,
} as const

const GLASS_BOTTOM = LAMP_SHAPE.glassLowY - LAMP_SHAPE.glassLowR
const GLASS_TOP = LAMP_SHAPE.glassHighY + LAMP_SHAPE.glassHighR

/** wax colours, sRGB: reds, oranges, pinks, a few violets (weights: how many lamps get each) */
export const WAX_PALETTE: readonly { hex: string; weight: number }[] = [
  { hex: '#ff3b26', weight: 3 }, // red
  { hex: '#e5231b', weight: 2 }, // deep red
  { hex: '#ff6a14', weight: 3 }, // orange
  { hex: '#ff9a1f', weight: 2 }, // amber
  { hex: '#ff4d86', weight: 2 }, // pink
  { hex: '#ff73b4', weight: 1.5 }, // light pink
  { hex: '#a65cff', weight: 1 }, // violet
  { hex: '#7d4dff', weight: 0.6 }, // deep violet
]

export interface LampParams {
  /** index into WAX_PALETTE */
  wax: number
  /** 0.85..1: bulbs are not all equally bright */
  bulb: number
  /** per blob: frequencies (Hz) and phases (cycles) of the rise, the wobble and the sway */
  riseHz: Float64Array
  risePhase: Float64Array
  wobbleHz: Float64Array
  wobblePhase: Float64Array
  swayHz: Float64Array
  swayPhase: Float64Array
  /** sway amplitude as a share of the free width */
  sway: Float64Array
  radius: Float64Array
}

/** Seed of the lamp PRNG: the wall is the same on every load. */
const LAMP_SEED = 0x1a7a1a4d

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

function buildLamps(): LampParams[] {
  const rand = mulberry32(LAMP_SEED)
  const total = WAX_PALETTE.reduce((s, c) => s + c.weight, 0)
  const lamps: LampParams[] = []
  for (let i = 0; i < LAMP_COUNT; i++) {
    let pick = rand() * total
    let wax = 0
    while (wax < WAX_PALETTE.length - 1 && pick >= WAX_PALETTE[wax].weight) {
      pick -= WAX_PALETTE[wax].weight
      wax++
    }
    const n = BLOBS_PER_LAMP
    const lamp: LampParams = {
      wax,
      bulb: 0.85 + 0.15 * rand(),
      riseHz: new Float64Array(n),
      risePhase: new Float64Array(n),
      wobbleHz: new Float64Array(n),
      wobblePhase: new Float64Array(n),
      swayHz: new Float64Array(n),
      swayPhase: new Float64Array(n),
      sway: new Float64Array(n),
      radius: new Float64Array(n),
    }
    for (let j = 0; j < n; j++) {
      // a round trip takes 28..64 s; the wobble and the sway are quicker and incommensurate
      lamp.riseHz[j] = 1 / (28 + 36 * rand())
      lamp.risePhase[j] = rand()
      lamp.wobbleHz[j] = 1 / (7 + 8 * rand())
      lamp.wobblePhase[j] = rand()
      lamp.swayHz[j] = 1 / (11 + 16 * rand())
      lamp.swayPhase[j] = rand()
      lamp.sway[j] = 0.25 + 0.5 * rand()
      // one big blob, two smaller
      lamp.radius[j] = j === 0 ? 0.045 + 0.01 * rand() : 0.03 + 0.012 * rand()
    }
    lamps.push(lamp)
  }
  return lamps
}

/** The 96 lamps, row-major from the top-left. */
export const LAMPS: readonly LampParams[] = buildLamps()

/** glass half-width at height y (the capsule's straight flank, a close approximation) */
export function glassHalfWidth(y: number): number {
  const s = LAMP_SHAPE
  // the glass is a capsule: two circles joined by their common tangents, so below the lower
  // centre and above the upper one the width follows the circle, not the clamped flank
  if (y <= s.glassLowY) return Math.sqrt(Math.max(s.glassLowR ** 2 - (y - s.glassLowY) ** 2, 0))
  if (y >= s.glassHighY) return Math.sqrt(Math.max(s.glassHighR ** 2 - (y - s.glassHighY) ** 2, 0))
  const h = s.glassHighY - s.glassLowY
  const b = (s.glassLowR - s.glassHighR) / h
  const a = Math.sqrt(Math.max(1 - b * b, 0))
  return (s.glassLowR - b * (y - s.glassLowY)) / a
}

const TAU = 2 * Math.PI

function frac(x: number): number {
  return x - Math.floor(x)
}

/** height 0..1 (pool to top) of a blob: rise, lingering at both ends, plus a little wobble */
function blobHeight(lamp: LampParams, j: number, t: number): number {
  const c = frac(lamp.riseHz[j] * t + lamp.risePhase[j])
  const s = 0.5 - 0.5 * Math.cos(TAU * c)
  const linger = s * s * (3 - 2 * s)
  const wob = 0.5 + 0.5 * Math.sin(TAU * frac(lamp.wobbleHz[j] * t + lamp.wobblePhase[j]))
  return Math.min(Math.max(0.9 * linger + 0.1 * wob, 0), 1)
}

/** lowest centre any blob takes (sunk into the pool); the highest depends on its radius */
const BLOB_LOW = GLASS_BOTTOM + LAMP_SHAPE.poolDepth * 0.6
function blobHigh(r: number): number {
  return GLASS_TOP - LAMP_SHAPE.glassWall - 1.6 * r
}

/**
 * Write every blob at time `t` (Unix seconds) into `out`, LAMP_TEXELS vec4s per lamp:
 * texel j < 3 = (x, y, radius, vertical stretch) in lamp units, texel 3 = (wax r, g, b in
 * linear light, bulb brightness). `waxLinear` holds the palette in linear RGB (3 per colour).
 * `out` needs LAMP_COUNT * LAMP_TEXELS * 4 floats.
 */
export function lavaBlobs(t: number, out: Float32Array | Float64Array, waxLinear?: ArrayLike<number>): void {
  const dt = 0.05
  for (let i = 0; i < LAMP_COUNT; i++) {
    const lamp = LAMPS[i]
    const base = i * LAMP_TEXELS * 4
    for (let j = 0; j < BLOBS_PER_LAMP; j++) {
      const r = lamp.radius[j]
      const lo = BLOB_LOW
      const hi = blobHigh(r)
      const h = blobHeight(lamp, j, t)
      const y = lo + (hi - lo) * h
      // rising or sinking wax stretches into a teardrop
      const vy = ((blobHeight(lamp, j, t + dt) - blobHeight(lamp, j, t - dt)) * (hi - lo)) / (2 * dt)
      const stretch = 1 + 0.45 * Math.min(Math.abs(vy) / 0.03, 1)
      // how far the blob may swing: the glass narrows above and below its centre, so test the
      // blob's whole outline (an ellipse with semi-axes r/√st across and r√st along y)
      const ax = r / Math.sqrt(stretch)
      const ay = r * Math.sqrt(stretch)
      let free = Infinity
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * TAU
        const room = glassHalfWidth(y + ay * Math.sin(th)) - LAMP_SHAPE.glassWall - Math.abs(ax * Math.cos(th))
        if (room < free) free = room
      }
      free = Math.max(free, 0)
      const x = free * lamp.sway[j] * Math.sin(TAU * frac(lamp.swayHz[j] * t + lamp.swayPhase[j]))
      const o = base + j * 4
      out[o] = x
      out[o + 1] = y
      out[o + 2] = r
      out[o + 3] = stretch
    }
    if (waxLinear) {
      const o = base + BLOBS_PER_LAMP * 4
      out[o] = waxLinear[lamp.wax * 3]
      out[o + 1] = waxLinear[lamp.wax * 3 + 1]
      out[o + 2] = waxLinear[lamp.wax * 3 + 2]
      out[o + 3] = lamp.bulb
    }
  }
}

// ------------------------------------------------------------------------------- the key

/** blob centres are quantised over these ranges (lamp units) to one byte each */
const KEY_X_RANGE = [-0.13, 0.13] as const
const KEY_Y_RANGE = [GLASS_BOTTOM, GLASS_TOP] as const

function quantise(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(255, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * 256)))
}

// FNV-1a 256 state as 16 little-endian 16-bit limbs (scratch: no allocation per call)
const LIMBS = 16
const fnvState = new Uint32Array(LIMBS)
const fnvTemp = new Uint32Array(LIMBS)
/** FNV-1a 256 offset basis, most significant 16-bit limb first */
const FNV256_OFFSET = [
  0xdd26, 0x8dbc, 0xaac5, 0x5036, 0x2d98, 0xc384, 0xc4e5, 0x76cc, 0xc8b1, 0x5368, 0x47b6, 0xbbb3, 0x1023, 0xb4c8,
  0xcaee, 0x0535,
]
const keyBlobs = new Float64Array(LAMP_COUNT * LAMP_TEXELS * 4)
const HEX = '0123456789abcdef'

export function fnv256Reset(): void {
  for (let i = 0; i < LIMBS; i++) fnvState[i] = FNV256_OFFSET[LIMBS - 1 - i]
}

/** h ^= byte; h *= 2^168 + 2^8 + 0x63 (mod 2^256) */
export function fnv256Byte(byte: number): void {
  const h = fnvState
  h[0] ^= byte & 0xff
  // h * 0x163 (= 2^8 + 0x63) plus h << 168 (10 limbs and 8 bits)
  let carry = 0
  for (let i = 0; i < LIMBS; i++) {
    let v = h[i] * 0x163 + carry
    if (i >= 10) {
      const lo = i >= 11 ? h[i - 11] >>> 8 : 0
      v += ((h[i - 10] << 8) & 0xffff) | lo
    }
    fnvTemp[i] = v & 0xffff
    carry = Math.floor(v / 0x10000)
  }
  h.set(fnvTemp)
}

/** the 256-bit state as 64 lowercase hex characters, most significant first */
export function fnv256Hex(): string {
  let s = ''
  for (let i = LIMBS - 1; i >= 0; i--) {
    const v = fnvState[i]
    s += HEX[(v >>> 12) & 15] + HEX[(v >>> 8) & 15] + HEX[(v >>> 4) & 15] + HEX[v & 15]
  }
  return s
}

/**
 * The wall's key at `timeSeconds` (Unix seconds): every blob centre quantised to 8 bits in x
 * and 8 in y (576 bytes, lamps row-major from the top-left, blobs in order), hashed with
 * FNV-1a 256. 64 hex characters. Deterministic, and it changes every second because the wax
 * keeps moving. A picture of a key, not a cryptographic one: Cloudflare feeds its camera frames
 * into a CSPRNG, and FNV is not one.
 */
export function lavaKey(timeSeconds: number): string {
  lavaBlobs(timeSeconds, keyBlobs)
  fnv256Reset()
  for (let i = 0; i < LAMP_COUNT; i++) {
    for (let j = 0; j < BLOBS_PER_LAMP; j++) {
      const o = (i * LAMP_TEXELS + j) * 4
      fnv256Byte(quantise(keyBlobs[o], KEY_X_RANGE))
      fnv256Byte(quantise(keyBlobs[o + 1], KEY_Y_RANGE))
    }
  }
  return fnv256Hex()
}
