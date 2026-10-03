import { MAX_FIREFLIES } from './sim'

/**
 * The tree the fireflies sit in: a trunk and three levels of branches grown recursively (each
 * branch a gently curving polyline that sprouts children along its upper part, the last one
 * continuing it), then firefly perches scattered around the twigs and their tips so the cloud
 * reads as a crown. Deterministic, built once; no three.js, so it can be checked in Node.
 *
 * Local frame: the trunk's foot at (0, TREE_BASE_Y, 0), +Y up; the crown (flies included)
 * tops out at TREE_BASE_Y + TREE_HEIGHT. The crown is roughly round in plan, so it reads from
 * any azimuth (the chapter orbits the camera).
 */

export const TREE_BASE_Y = -1.3
export const TREE_HEIGHT = 2.6
const TREE_SEED = 0x7ee5

/** per level: trunk, limbs, branches, twigs */
const SEGMENTS = [6, 5, 4, 3]
/** pull toward +Y per sub-segment (branches curve up toward the light) */
const UPTURN = [0.0, 0.05, 0.08, 0.1]
/** random bend per sub-segment */
const WOBBLE = [0.03, 0.05, 0.1, 0.14]
/** children per branch of this level (the last continues the parent) */
const CHILDREN = [5, 4, 4]
/** angle of the side children from their parent, radians (min, max) */
const SPREAD: [number, number][] = [
  [0.85, 1.0],
  [0.55, 0.8],
  [0.5, 0.75],
]
/** angle of the continuing child */
const LEAD_ANGLE: [number, number][] = [
  [0.05, 0.18],
  [0.15, 0.3],
  [0.15, 0.3],
]
/** child length relative to the parent (min, max) */
const LENGTH_RATIO: [number, number][] = [
  [0.85, 0.95],
  [0.55, 0.66],
  [0.5, 0.6],
]
/** where along the parent the side children sprout */
const SPROUT: [number, number] = [0.5, 0.92]
const TRUNK_LENGTH = 1.0

/** firefly scatter: share around twig ends, along twigs, along branches; jitter (unit lengths) */
const PERCH_TIP_SHARE = 0.45
const PERCH_TWIG_SHARE = 0.4
const PERCH_TIP_JITTER = 0.15
const PERCH_TWIG_JITTER = 0.09
const PERCH_BRANCH_JITTER = 0.06
/** perch jitter is a normal draw clipped at this many standard deviations */
const JITTER_CLIP = 2.2
/** no perches below this fraction of the trunk */
const PERCH_FLOOR = 0.9
/** the crown top is this quantile of the perch heights (a few strays may sit above it) */
const TOP_QUANTILE = 0.995

export interface Tree {
  /** segment endpoints per level (trunk, limbs, branches, twigs), 6 floats per segment */
  segments: Float32Array[]
  /** firefly perches, xyz; any prefix is an even sample of the crown */
  perches: Float32Array
  /** extent of the skeleton and the perches */
  min: [number, number, number]
  max: [number, number, number]
}

type V3 = [number, number, number]

interface Polyline {
  pts: V3[]
  level: number
}

export function buildTree(perchCount = MAX_FIREFLIES, seed = TREE_SEED): Tree {
  const rnd = mulberry32(seed)
  const range = (r: [number, number]) => r[0] + (r[1] - r[0]) * rnd()
  const branches: Polyline[] = []

  const grow = (origin: V3, dir: V3, length: number, level: number) => {
    const n = SEGMENTS[level]
    const pts: V3[] = [origin]
    let p = origin
    let d = dir
    for (let k = 0; k < n; k++) {
      d = normalize([
        d[0] + WOBBLE[level] * gauss(rnd),
        d[1] + UPTURN[level] + WOBBLE[level] * gauss(rnd),
        d[2] + WOBBLE[level] * gauss(rnd),
      ])
      p = [p[0] + (d[0] * length) / n, p[1] + (d[1] * length) / n, p[2] + (d[2] * length) / n]
      pts.push(p)
    }
    branches.push({ pts, level })
    if (level >= CHILDREN.length) return
    const kids = CHILDREN[level]
    const phi0 = rnd() * Math.PI * 2
    for (let c = 0; c < kids; c++) {
      const lead = c === kids - 1
      const at = lead ? 1 : range(SPROUT)
      const [q, local] = along(pts, at)
      const angle = range(lead ? LEAD_ANGLE[level] : SPREAD[level])
      // side children spread evenly around the parent, the lead leans a random way
      const phi = lead ? rnd() * Math.PI * 2 : phi0 + (c / (kids - 1)) * Math.PI * 2 + 0.4 * (rnd() - 0.5)
      grow(q, turn(local, angle, phi), length * range(LENGTH_RATIO[level]), level + 1)
    }
  }
  const lean = 0.06
  grow([0, 0, 0], normalize([lean * gauss(rnd), 1, lean * gauss(rnd)]), TRUNK_LENGTH, 0)

  // ---------------------------------------------------------------- perches
  const twigs = branches.filter((b) => b.level === 3)
  const limbs = branches.filter((b) => b.level === 2)
  const twigPick = lengthSampler(twigs)
  const limbPick = lengthSampler(limbs)
  const floor = PERCH_FLOOR * TRUNK_LENGTH
  const perches = new Float32Array(perchCount * 3)
  for (let i = 0; i < perchCount; i++) {
    let x = 0
    let y = -Infinity
    let z = 0
    while (y < floor) {
      const mode = rnd()
      let base: V3
      let jitter: number
      if (mode < PERCH_TIP_SHARE) {
        const t = twigs[Math.floor(rnd() * twigs.length)]
        base = t.pts[t.pts.length - 1]
        jitter = PERCH_TIP_JITTER
      } else if (mode < PERCH_TIP_SHARE + PERCH_TWIG_SHARE) {
        base = twigPick(rnd)
        jitter = PERCH_TWIG_JITTER
      } else {
        base = limbPick(rnd)
        jitter = PERCH_BRANCH_JITTER
      }
      x = base[0] + jitter * truncGauss(rnd)
      y = base[1] + jitter * truncGauss(rnd)
      z = base[2] + jitter * truncGauss(rnd)
    }
    perches[i * 3] = x
    perches[i * 3 + 1] = y
    perches[i * 3 + 2] = z
  }

  // ---------------------------------------------------------------- scale to TREE_HEIGHT
  let skeletonTop = 0
  for (const b of branches) for (const p of b.pts) skeletonTop = Math.max(skeletonTop, p[1])
  const ys = new Float64Array(perchCount)
  for (let i = 0; i < perchCount; i++) ys[i] = perches[i * 3 + 1]
  ys.sort()
  const perchTop = perchCount > 0 ? ys[Math.min(perchCount - 1, Math.floor(TOP_QUANTILE * perchCount))] : 0
  const scale = TREE_HEIGHT / Math.max(skeletonTop, perchTop)

  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  const place = (arr: Float32Array, o: number, x: number, y: number, z: number) => {
    arr[o] = x * scale
    arr[o + 1] = TREE_BASE_Y + y * scale
    arr[o + 2] = z * scale
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], arr[o + k])
      max[k] = Math.max(max[k], arr[o + k])
    }
  }
  for (let i = 0; i < perchCount; i++) place(perches, i * 3, perches[i * 3], perches[i * 3 + 1], perches[i * 3 + 2])

  const segments: Float32Array[] = []
  for (let level = 0; level < SEGMENTS.length; level++) {
    const own = branches.filter((b) => b.level === level)
    const arr = new Float32Array(own.reduce((s, b) => s + (b.pts.length - 1) * 6, 0))
    let o = 0
    for (const b of own) {
      for (let k = 0; k + 1 < b.pts.length; k++) {
        place(arr, o, ...b.pts[k])
        place(arr, o + 3, ...b.pts[k + 1])
        o += 6
      }
    }
    segments.push(arr)
  }
  return { segments, perches, min, max }
}

// ---------------------------------------------------------------- helpers

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rnd: () => number) {
  const u = Math.max(rnd(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}

/** a normal draw clipped to ±JITTER_CLIP: no stray sparks far off the crown */
function truncGauss(rnd: () => number) {
  for (;;) {
    const g = gauss(rnd)
    if (Math.abs(g) <= JITTER_CLIP) return g
  }
}

function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** `d` tilted by `angle` toward azimuth `phi` around it */
function turn(d: V3, angle: number, phi: number): V3 {
  // a basis perpendicular to d; for a near-vertical d, u and v are horizontal (+X, +Z)
  const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const u = normalize(cross(ref, d))
  const v = cross(d, u)
  const cp = Math.cos(phi)
  const sp = Math.sin(phi)
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  return normalize([
    d[0] * ca + (u[0] * cp + v[0] * sp) * sa,
    d[1] * ca + (u[1] * cp + v[1] * sp) * sa,
    d[2] * ca + (u[2] * cp + v[2] * sp) * sa,
  ])
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** point and local direction at fraction `t` of the way along a polyline (by vertex index) */
function along(pts: V3[], t: number): [V3, V3] {
  const f = Math.min(Math.max(t, 0), 1) * (pts.length - 1)
  const k = Math.min(Math.floor(f), pts.length - 2)
  const a = pts[k]
  const b = pts[k + 1]
  const w = f - k
  const p: V3 = [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]
  return [p, normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]])]
}

/** uniform point on a set of polylines, by length */
function lengthSampler(lines: Polyline[]) {
  const segs: [V3, V3][] = []
  const cdf: number[] = []
  let total = 0
  for (const l of lines) {
    for (let k = 0; k + 1 < l.pts.length; k++) {
      const a = l.pts[k]
      const b = l.pts[k + 1]
      total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      segs.push([a, b])
      cdf.push(total)
    }
  }
  return (rnd: () => number): V3 => {
    const x = rnd() * total
    let lo = 0
    let hi = cdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < x) lo = mid + 1
      else hi = mid
    }
    const [a, b] = segs[lo]
    const w = rnd()
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]
  }
}
