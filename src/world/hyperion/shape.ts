/**
 * Hyperion's body: an icosphere (level 5: 10242 vertices) pushed out to the triaxial ellipsoid,
 * lumped by three octaves of value noise (peak 12 % of the radius) and dented by a few craters,
 * one of them giant (Hyperion's largest crater is ~120 km across on a ~270 km body). Pure
 * arrays, no three.js; the stage wraps them in a BufferGeometry, verify.ts measures them.
 *
 * Body axes: x long, y middle, z short, matching dynamics.ts.
 */
import { HYPERION_SEMI_AXES } from './dynamics'

export interface MoonShape {
  positions: Float32Array
  /** per-vertex albedo factor 0..1: mottling, dark crater floors */
  shade: Float32Array
  index: Uint16Array
  /** the lumps' peak radial displacement, as a fraction of the radius */
  lumpRange: number
}

/** peak relative height of the noise lumps */
const LUMP = 0.12
const SUBDIVISIONS = 5

interface Crater {
  dir: [number, number, number]
  /** angular radius on the unit sphere, radians */
  radius: number
  /** bowl depth as a fraction of the radius */
  depth: number
}

// ---------------------------------------------------------------- icosphere

function icosphere(levels: number): { verts: number[]; faces: number[] } {
  const t = (1 + Math.sqrt(5)) / 2
  const verts: number[] = []
  const add = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z)
    verts.push(x / l, y / l, z / l)
    return verts.length / 3 - 1
  }
  for (const [x, y, z] of [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]) add(x, y, z)
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ]
  for (let l = 0; l < levels; l++) {
    const cache = new Map<number, number>()
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      const i = add(
        verts[a * 3] + verts[b * 3],
        verts[a * 3 + 1] + verts[b * 3 + 1],
        verts[a * 3 + 2] + verts[b * 3 + 2],
      )
      cache.set(key, i)
      return i
    }
    const next: number[] = []
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f]
      const b = faces[f + 1]
      const c = faces[f + 2]
      const ab = mid(a, b)
      const bc = mid(b, c)
      const ca = mid(c, a)
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
    }
    faces = next
  }
  return { verts, faces }
}

// ---------------------------------------------------------------- value noise

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ seed
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return ((h >>> 0) / 4294967295) * 2 - 1
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** smooth lattice noise in [−1, 1] */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const u = fade(x - ix)
  const v = fade(y - iy)
  const w = fade(z - iz)
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed)
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  )
}

/** three octaves, low frequency first: the lumps of a rubble-pile potato */
function lumps(x: number, y: number, z: number): number {
  return (
    valueNoise(x * 1.35 + 11.3, y * 1.35 - 4.1, z * 1.35 + 7.7, 0x51ed27) +
    0.5 * valueNoise(x * 2.8 - 3.9, y * 2.8 + 9.2, z * 2.8 + 1.6, 0x2b9a01) +
    0.25 * valueNoise(x * 5.9 + 6.4, y * 5.9 + 2.3, z * 5.9 - 8.8, 0x7f3c55)
  )
}

/** fine albedo mottling, independent of the lumps */
function mottle(x: number, y: number, z: number): number {
  return valueNoise(x * 7.0 + 3.1, y * 7.0 - 5.3, z * 7.0 + 2.2, 0x1d4f3b) + 0.5 * valueNoise(x * 15 - 1.7, y * 15 + 4.4, z * 15 + 9.9, 0x6a09e6)
}

// ---------------------------------------------------------------- craters

function makeCraters(): Crater[] {
  const unit = (x: number, y: number, z: number): [number, number, number] => {
    const l = Math.hypot(x, y, z)
    return [x / l, y / l, z / l]
  }
  // the giant one, on a broad face so it shows as the body turns
  const craters: Crater[] = [{ dir: unit(0.35, 0.15, 1), radius: 0.62, depth: 0.15 }]
  let seed = 19840101
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  for (let i = 0; i < 11; i++) {
    const u = rnd() * 2 - 1
    const a = rnd() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const radius = 0.16 + 0.22 * rnd()
    craters.push({ dir: [Math.cos(a) * s, Math.sin(a) * s, u], radius, depth: 0.05 + 0.12 * radius })
  }
  return craters
}

// ---------------------------------------------------------------- the body

export function buildMoonShape(scale = 1, semiAxes: readonly [number, number, number] = HYPERION_SEMI_AXES): MoonShape {
  const { verts, faces } = icosphere(SUBDIVISIONS)
  const n = verts.length / 3
  const craters = makeCraters()

  const lump = new Float64Array(n)
  let peak = 0
  for (let i = 0; i < n; i++) {
    lump[i] = lumps(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2])
    peak = Math.max(peak, Math.abs(lump[i]))
  }

  const positions = new Float32Array(n * 3)
  const shade = new Float32Array(n)
  const [a, b, c] = semiAxes
  let lumpRange = 0
  for (let i = 0; i < n; i++) {
    const x = verts[i * 3]
    const y = verts[i * 3 + 1]
    const z = verts[i * 3 + 2]
    const l = (LUMP * lump[i]) / peak
    lumpRange = Math.max(lumpRange, Math.abs(l))
    let dent = 0
    let floor = 0
    for (const k of craters) {
      const d = Math.acos(Math.min(1, x * k.dir[0] + y * k.dir[1] + z * k.dir[2])) / k.radius
      if (d > 1.6) continue
      // a bowl that meets the surface at d = 1, with a low raised rim just outside
      if (d < 1) {
        const bowl = 1 - d * d
        dent -= k.depth * bowl
        floor = Math.max(floor, bowl)
      }
      const r = (d - 1) / 0.22
      dent += 0.22 * k.depth * Math.exp(-r * r)
    }
    const f = scale * (1 + l + dent)
    positions[i * 3] = a * x * f
    positions[i * 3 + 1] = b * y * f
    positions[i * 3 + 2] = c * z * f
    // dark-floored craters on a mottled grey-brown: what makes Hyperion read even when lit head-on
    const m = 0.88 + 0.08 * mottle(x, y, z)
    shade[i] = Math.max(0.3, Math.min(1, m * (1 - 0.42 * floor * floor) + 0.06 * Math.max(0, l / LUMP)))
  }

  const index = new Uint16Array(faces)
  // the base icosahedron's winding is not guaranteed outward: check the signed volume and flip
  if (meshInertia(positions, index).volume < 0) {
    for (let f = 0; f < index.length; f += 3) {
      const t = index[f + 1]
      index[f + 1] = index[f + 2]
      index[f + 2] = t
    }
  }
  return { positions, shade, index, lumpRange }
}

export interface MeshInertia {
  volume: number
  /** inertia tensor diagonal about the centroid, body axes, for unit mass and uniform density */
  diagonal: [number, number, number]
  /** largest |product of inertia| (same normalisation) */
  offDiagonal: number
  /** distance of the centroid from the origin */
  centroidOffset: number
}

/** volume, centroid and inertia tensor of a closed triangle mesh (signed tetrahedra from the origin) */
export function meshInertia(positions: ArrayLike<number>, index: ArrayLike<number>): MeshInertia {
  let vol = 0
  const cm = [0, 0, 0]
  // second moments ∫ x_i x_j dV
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let f = 0; f < index.length; f += 3) {
    const p = index[f] * 3
    const q = index[f + 1] * 3
    const r = index[f + 2] * 3
    const ax = positions[p], ay = positions[p + 1], az = positions[p + 2]
    const bx = positions[q], by = positions[q + 1], bz = positions[q + 2]
    const cx = positions[r], cy = positions[r + 1], cz = positions[r + 2]
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    vol += det / 6
    const sx = ax + bx + cx
    const sy = ay + by + cy
    const sz = az + bz + cz
    cm[0] += (det / 24) * sx
    cm[1] += (det / 24) * sy
    cm[2] += (det / 24) * sz
    const v = [ax, ay, az, bx, by, bz, cx, cy, cz]
    const s = [sx, sy, sz]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        S[i * 3 + j] += (det / 120) * (v[i] * v[j] + v[3 + i] * v[3 + j] + v[6 + i] * v[6 + j] + s[i] * s[j])
      }
    }
  }
  const c = [cm[0] / vol, cm[1] / vol, cm[2] / vol]
  // about the centroid, per unit mass
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] = S[i * 3 + j] / vol - c[i] * c[j]
  const tr = S[0] + S[4] + S[8]
  return {
    volume: vol,
    diagonal: [tr - S[0], tr - S[4], tr - S[8]],
    offDiagonal: Math.max(Math.abs(S[1]), Math.abs(S[2]), Math.abs(S[5])),
    centroidOffset: Math.hypot(c[0], c[1], c[2]),
  }
}
