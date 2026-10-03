/**
 * The chaos game's iterated function systems.
 *
 * Every preset is a short list of affine maps  x' = a x + b y + e,  y' = c x + d y + f,  each
 * chosen with probability p. `maps` keep the published coefficients in their published
 * coordinates, so a chapter can quote them as they appear in the literature, and `frame` is the
 * attractor's 0.05–99.95 percentile box in those coordinates (checked by verify-presets.ts; the
 * 0.5–99.5 box cuts off Sierpiński's corners and the fern's stalk: an orbit on an IFS attractor has
 * sparse parts but no outliers).
 *
 * Stage units
 *   The published systems live in unrelated places: the triangle in [0, 1]², the fern up to
 *   y = 10, the spiral out to x = ±7. The simulation therefore runs every preset in stage units:
 *   published coordinates shifted so the frame centre is 0 and scaled so the frame's larger
 *   half-extent is 1 (`stageFrame`). Conjugating by that shift-and-scale leaves every linear
 *   part a, b, c, d unchanged and only rewrites e, f, so it is the same system drawn in the
 *   same place as every other one: a cloud that sits on one attractor folds in place into the
 *   next instead of first being flung off screen or shrunk to a dot.
 *
 * Variation (the "different species" slider)
 *   variation v ∈ [−1, 1] turns every non-stem map's linear part by 8° · v · kr and scales it by
 *   1 + 0.06 · v · ks (kr, ks = the preset's `variation` strengths), about the map's own fixed
 *   point. Keeping fixed points where they are keeps the corners, the
 *   fern's tip and the spiral's eye in place, so the attractor bends without wandering out of
 *   its frame.
 */
import type { IfsPreset } from '../types'

/** One affine map  x' = a x + b y + e,  y' = c x + d y + f,  chosen with probability `p`. */
export interface IfsMap {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  p: number
  /** palette slot 0..3; the points this map placed are drawn speedColor(0.12 + 0.28 × color) */
  color: 0 | 1 | 2 | 3
  /** a stalk map (the fern's and the leaf's stem); the variation slider leaves it alone */
  stem?: boolean
}

/** An axis-aligned box: centre and half-extents. */
export interface IfsFrame {
  cx: number
  cy: number
  halfW: number
  halfH: number
}

export interface IfsPresetDef {
  /** published coefficients, published coordinates */
  maps: readonly IfsMap[]
  /** the attractor's 0.05–99.95 percentile box in published coordinates */
  frame: IfsFrame
  /**
   * Strength of the variation slider for this preset, as fractions of the full 8° turn and 6 %
   * scale change. Scale is the dangerous half: a map whose contraction is already close to 1
   * (the fern's frond, the spiral's arm) grows the attractor by 1 / (1 − ρ), so a few percent
   * more scale can double it.
   */
  variation: { rotation: number; scale: number }
  /**
   * Brightness factor that brings this attractor's typical point density on screen to the
   * shared reference (measured by verify-presets.ts), so a sparse leaf and a dense spiral
   * read equally bright at the same `gain`.
   */
  gain: number
  /** where the coefficients come from */
  source: string
}

export const MAP_COUNT_MAX = 4

/** Variation at |v| = 1: rotation in radians and relative scale change of every non-stem map. */
export const VARIATION_ROTATION = (8 * Math.PI) / 180
export const VARIATION_SCALE = 0.06

/** Palette t of a colour slot (the house speedColor ramp). */
export function slotTone(color: number): number {
  return 0.12 + 0.28 * color
}

const H3 = Math.sqrt(3) / 2

export const IFS_PRESETS: Record<IfsPreset, IfsPresetDef> = {
  sierpinski: {
    // halfway to a corner of the equilateral triangle (0, 0), (1, 0), (1/2, √3/2)
    maps: [
      { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0, p: 1 / 3, color: 1 },
      { a: 0.5, b: 0, c: 0, d: 0.5, e: 0.5, f: 0, p: 1 / 3, color: 2 },
      { a: 0.5, b: 0, c: 0, d: 0.5, e: 0.25, f: H3 / 2, p: 1 / 3, color: 3 },
    ],
    frame: { cx: 0.4998, cy: 0.4295, halfW: 0.4935, halfH: 0.4295 },
    variation: { rotation: 1, scale: 1 },
    gain: 0.67,
    source: 'Sierpiński (1915); the chaos game as in Barnsley, Fractals Everywhere (1988)',
  },
  fern: {
    maps: [
      { a: 0, b: 0, c: 0, d: 0.16, e: 0, f: 0, p: 0.01, color: 0, stem: true },
      { a: 0.85, b: 0.04, c: -0.04, d: 0.85, e: 0, f: 1.6, p: 0.85, color: 2 },
      { a: 0.2, b: -0.26, c: 0.23, d: 0.22, e: 0, f: 1.6, p: 0.07, color: 1 },
      { a: -0.15, b: 0.28, c: 0.26, d: 0.24, e: 0, f: 0.44, p: 0.07, color: 3 },
    ],
    frame: { cx: 0.2421, cy: 5.1515, halfW: 2.4123, halfH: 4.8437 },
    variation: { rotation: 1, scale: 0.5 },
    gain: 0.8,
    source: 'Barnsley, Fractals Everywhere (1988), Table 3.8.3',
  },
  dragon: {
    // Heighway's dragon: f₁(z) = (1+i) z / 2 (turn +45°), f₂(z) = 1 − (1−i) z / 2 (turn +135°),
    // both shrinking by 1/√2. A literal ±45° pair would draw Lévy's C curve instead.
    maps: [
      { a: 0.5, b: -0.5, c: 0.5, d: 0.5, e: 0, f: 0, p: 0.5, color: 1 },
      { a: -0.5, b: -0.5, c: 0.5, d: -0.5, e: 1, f: 0, p: 0.5, color: 3 },
    ],
    frame: { cx: 0.416, cy: 0.1673, halfW: 0.7439, halfH: 0.4955 },
    variation: { rotation: 1, scale: 0.3 },
    gain: 1.6,
    source: 'Heighway dragon (Davis & Knuth, 1970); IFS form as in Edgar, Measure, Topology and Fractal Geometry',
  },
  leaf: {
    maps: [
      { a: 0.14, b: 0.01, c: 0, d: 0.51, e: -0.08, f: -1.31, p: 0.1, color: 0, stem: true },
      { a: 0.43, b: 0.52, c: -0.45, d: 0.5, e: 1.49, f: -0.75, p: 0.35, color: 1 },
      { a: 0.45, b: -0.49, c: 0.47, d: 0.47, e: -1.62, f: -0.74, p: 0.35, color: 2 },
      { a: 0.49, b: 0, c: 0, d: 0.51, e: 0.02, f: 1.62, p: 0.2, color: 3 },
    ],
    frame: { cx: -0.0425, cy: -0.0357, halfW: 3.1767, halfH: 3.1094 },
    variation: { rotation: 1, scale: 0.7 },
    gain: 2.5,
    source: "Barnsley's maple leaf, as tabulated in Paul Bourke's IFS notes",
  },
  spiral: {
    maps: [
      { a: 0.787879, b: -0.424242, c: 0.242424, d: 0.859848, e: 1.758647, f: 1.408065, p: 0.9, color: 2 },
      { a: -0.121212, b: 0.257576, c: 0.151515, d: 0.05303, e: -6.721654, f: 1.377236, p: 0.05, color: 1 },
      { a: 0.181818, b: -0.136364, c: 0.090909, d: 0.181818, e: 6.086107, f: 1.568035, p: 0.05, color: 3 },
    ],
    frame: { cx: -0.0213, cy: 4.9808, halfW: 6.8591, halfH: 4.4877 },
    variation: { rotation: 1, scale: 0.4 },
    gain: 0.4,
    source: "Fractint's spiral.ifs, as tabulated in Paul Bourke's IFS notes",
  },
}

/** Presets in the order a chapter or a picker should offer them. */
export const IFS_PRESET_ORDER: readonly IfsPreset[] = ['sierpinski', 'fern', 'dragon', 'leaf', 'spiral']

/** The preset's frame in stage units: centred on 0, larger half-extent 1. */
export function stageFrame(preset: IfsPreset, out: IfsFrame = { cx: 0, cy: 0, halfW: 1, halfH: 1 }): IfsFrame {
  const fr = IFS_PRESETS[preset].frame
  const s = Math.max(fr.halfW, fr.halfH)
  out.cx = 0
  out.cy = 0
  out.halfW = fr.halfW / s
  out.halfH = fr.halfH / s
  return out
}

/**
 * Everything the GPU needs for one preset at one variation, in stage units. Build one with
 * `createIfsUniforms()` and refill it with `presetUniforms(…, out)` so slider drags do not
 * allocate.
 */
export interface IfsUniforms {
  /** number of maps in use, 1..MAP_COUNT_MAX */
  count: number
  /**
   * Per map, 6 floats (a, b, e, c, d, f): the two rows of the augmented matrix [A | t], so
   * map i is x' = dot(maps[6i..6i+2], (x, y, 1)), y' = dot(maps[6i+3..6i+5], (x, y, 1)).
   * Bind as `uniform vec3 uRows[2 * MAP_COUNT_MAX]`. Unused slots hold the identity.
   */
  maps: Float32Array
  /** cumulative probability through map i; the last used slot and every unused slot are 1 */
  cumulative: Float32Array
  /** palette t (speedColor input) of each map's colour slot */
  tones: Float32Array
  /**
   * Per map, 8 floats describing one step as a motion, for the renderer's in-between frames:
   * (fx, fy, phi, 0, s11, s12, s22, 0), where (fx, fy) is the map's fixed point and its
   * linear part is A = R(phi) · S with S symmetric. Moving a point p by the map over t ∈ [0, 1]
   * as  fix + R(t·phi) · ((1−t) I + t S) · (p − fix)  turns each copy as it shrinks instead of
   * sliding it along straight chords (which pinches a copy that turns by 135°). Unused slots
   * hold the identity motion.
   */
  motion: Float32Array
  /** the preset's frame in stage units (see stageFrame) */
  frame: IfsFrame
}

export function createIfsUniforms(): IfsUniforms {
  return {
    count: 1,
    maps: new Float32Array(6 * MAP_COUNT_MAX),
    cumulative: new Float32Array(MAP_COUNT_MAX),
    tones: new Float32Array(MAP_COUNT_MAX),
    motion: new Float32Array(8 * MAP_COUNT_MAX),
    frame: { cx: 0, cy: 0, halfW: 1, halfH: 1 },
  }
}

/** One map in stage units after the variation, as plain doubles (a, b, c, d, e, f). */
export interface StageMap {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * Map `i` of `preset` in stage units with the variation applied. Writes into `out` and returns
 * it. Shared by presetUniforms and the CPU checks, so both run exactly the same system.
 */
export function stageMap(preset: IfsPreset, i: number, variation: number, out: StageMap): StageMap {
  const def = IFS_PRESETS[preset]
  const m = def.maps[i]
  const fr = def.frame
  const s = Math.max(fr.halfW, fr.halfH)
  // conjugate by u = (x − c) / s: same linear part, translation (A c + t − c) / s
  let a = m.a
  let b = m.b
  let c = m.c
  let d = m.d
  let e = (m.a * fr.cx + m.b * fr.cy + m.e - fr.cx) / s
  let f = (m.c * fr.cx + m.d * fr.cy + m.f - fr.cy) / s

  const v = clampVariation(variation)
  if (v !== 0 && !m.stem) {
    // fixed point: (I − A) x* = t (I − A is invertible for any contraction)
    const det = (1 - a) * (1 - d) - b * c
    const fx = ((1 - d) * e + b * f) / det
    const fy = (c * e + (1 - a) * f) / det
    const k = 1 + VARIATION_SCALE * def.variation.scale * v
    const turn = VARIATION_ROTATION * def.variation.rotation * v
    const cs = k * Math.cos(turn)
    const sn = k * Math.sin(turn)
    // A' = k R(θ) A
    const a2 = cs * a - sn * c
    const b2 = cs * b - sn * d
    const c2 = sn * a + cs * c
    const d2 = sn * b + cs * d
    a = a2
    b = b2
    c = c2
    d = d2
    // t' = x* − A' x*
    e = fx - (a * fx + b * fy)
    f = fy - (c * fx + d * fy)
  }
  out.a = a
  out.b = b
  out.c = c
  out.d = d
  out.e = e
  out.f = f
  return out
}

const scratchMap: StageMap = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }

/**
 * Pack `preset` at `variation` (−1..1, clamped) for the GPU. Pass `out` to refill an existing
 * IfsUniforms without allocating; otherwise a new one is returned.
 */
export function presetUniforms(preset: IfsPreset, variation: number, out: IfsUniforms = createIfsUniforms()): IfsUniforms {
  const def = IFS_PRESETS[preset]
  const n = Math.min(def.maps.length, MAP_COUNT_MAX)
  let total = 0
  for (let i = 0; i < n; i++) total += def.maps[i].p

  out.count = n
  let running = 0
  for (let i = 0; i < MAP_COUNT_MAX; i++) {
    const r = i * 6
    const q = i * 8
    if (i >= n) {
      out.maps.set(IDENTITY_ROWS, r)
      out.motion.set(IDENTITY_MOTION, q)
      out.cumulative[i] = 1
      out.tones[i] = slotTone(0)
      continue
    }
    const src = def.maps[i]
    const m = stageMap(preset, i, variation, scratchMap)
    out.maps[r] = m.a
    out.maps[r + 1] = m.b
    out.maps[r + 2] = m.e
    out.maps[r + 3] = m.c
    out.maps[r + 4] = m.d
    out.maps[r + 5] = m.f

    running += src.p
    // the last map closes the distribution exactly, so float rounding can never pick past it
    out.cumulative[i] = i === n - 1 ? 1 : running / total
    out.tones[i] = slotTone(src.color)

    // motion: fixed point, then A = R(phi) S with S symmetric. phi = atan2(c − b, a + d) is the
    // one rotation for which R(−phi) A is symmetric with a non-negative trace, so S is the polar
    // factor when det A > 0, and for a reflection (det A < 0) the flip falls on S's smaller axis.
    const det = (1 - m.a) * (1 - m.d) - m.b * m.c
    const fx = ((1 - m.d) * m.e + m.b * m.f) / det
    const fy = (m.c * m.e + (1 - m.a) * m.f) / det
    const phi = Math.atan2(m.c - m.b, m.a + m.d)
    const cs = Math.cos(phi)
    const sn = Math.sin(phi)
    // S = R(−phi) A
    const s11 = cs * m.a + sn * m.c
    const s12 = 0.5 * (cs * m.b + sn * m.d + (cs * m.c - sn * m.a))
    const s22 = cs * m.d - sn * m.b
    out.motion[q] = fx
    out.motion[q + 1] = fy
    out.motion[q + 2] = phi
    out.motion[q + 3] = 0
    out.motion[q + 4] = s11
    out.motion[q + 5] = s12
    out.motion[q + 6] = s22
    out.motion[q + 7] = 0
  }
  stageFrame(preset, out.frame)
  return out
}

const IDENTITY_ROWS = [1, 0, 0, 0, 1, 0]
const IDENTITY_MOTION = [0, 0, 0, 0, 1, 0, 1, 0]

function clampVariation(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0
}
