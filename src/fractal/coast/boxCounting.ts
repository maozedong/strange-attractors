/**
 * Box counting on the Lorenz attractor. A single long trajectory, sampled once per page load,
 * in the swarm's render units ((p − frame.center) × frame.scale at the default parameters), and
 * the number of cubic grid cells of a given edge it touches. The grid is aligned to the
 * render-space origin: cell (i, j, k) spans [i·edge, (i+1)·edge) × … No three.js here.
 */
import { sampleTrajectory } from '../../sim/cpu'
import { defaultParams } from '../../systems'
import { lorenz } from '../../systems/lorenz'

/** trajectory points in the sample (dt = 0.005, so 1000 time units) */
export const BOX_SAMPLE_COUNT = 200_000
/** most cubes <BoxCount /> draws; below roughly this many the lattice is still legible */
export const MAX_BOXES = 60_000

/** occupancy is a bitset over the sample's bounding grid up to this many cells (8 MB) */
const DENSE_CELLS = 1 << 26

export interface BoxTally {
  /** cube edge, render units */
  edge: number
  /** cells holding at least one sample point */
  count: number
}

/** Occupied cells of one edge, ready to draw: what <BoxCount /> uploads per layer. */
export interface BoxLattice {
  edge: number
  /** true number of occupied cells */
  count: number
  /** cells actually listed: min(count, MAX_BOXES) */
  drawn: number
  /** integer cell coordinates (i, j, k) per listed cell, as floats */
  cells: Float32Array
  /**
   * 12-bit mask per listed cell of the cube edges it draws. Every lattice edge of the union is
   * owned by exactly one of the (up to four) occupied cells around it, so additive blending
   * never stacks a shared edge. Bit e = axis·4 + ou·2 + ov (see unitCubeEdges()). When the
   * lattice is capped every bit is set, because ownership no longer partitions the edges.
   */
  masks: Float32Array
}

interface Sample {
  xyz: Float32Array
  min: [number, number, number]
  max: [number, number, number]
}

let sample: Sample | null = null

function getSample(): Sample {
  if (sample) return sample
  const P = defaultParams(lorenz)
  const xyz = sampleTrajectory(lorenz, P, lorenz.seed(P), BOX_SAMPLE_COUNT, { transient: 2000 })
  const { center, scale } = lorenz.frame(P)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < xyz.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = (xyz[i + a] - center[a]) * scale
      xyz[i + a] = v
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
  }
  sample = { xyz, min, max }
  return sample
}

/**
 * The Lorenz sample in render units, xyz per point (BOX_SAMPLE_COUNT points). Computed on the
 * first call (~200k RK4 steps, tens of ms), then shared.
 */
export function lorenzSample(): Float32Array {
  return getSample().xyz
}

// ---------------------------------------------------------------- occupancy

interface Grid {
  i0: number
  j0: number
  k0: number
  nx: number
  ny: number
  nz: number
}

function gridFor(s: Sample, edge: number): Grid {
  const i0 = Math.floor(s.min[0] / edge)
  const j0 = Math.floor(s.min[1] / edge)
  const k0 = Math.floor(s.min[2] / edge)
  return {
    i0,
    j0,
    k0,
    nx: Math.floor(s.max[0] / edge) - i0 + 1,
    ny: Math.floor(s.max[1] / edge) - j0 + 1,
    nz: Math.floor(s.max[2] / edge) - k0 + 1,
  }
}

/** reused across calls: occupancy bits, and (i, j, k) of each newly found cell */
let bits = new Uint32Array(0)
let found = new Int32Array(0)

/**
 * Mark the occupied cells of `edge` in `bits` and list them in `found` in first-visit order.
 * Returns the count, or −1 if the grid is too large for the bitset.
 */
function markDense(s: Sample, edge: number, g: Grid): number {
  const cells = g.nx * g.ny * g.nz
  if (cells > DENSE_CELLS) return -1
  const words = (cells + 31) >>> 5
  if (bits.length < words) bits = new Uint32Array(words)
  else bits.fill(0, 0, words)
  if (found.length < BOX_SAMPLE_COUNT * 3) found = new Int32Array(BOX_SAMPLE_COUNT * 3)
  const inv = 1 / edge
  const xyz = s.xyz
  const nyz = g.ny * g.nz
  let count = 0
  for (let p = 0; p < xyz.length; p += 3) {
    const i = Math.floor(xyz[p] * inv)
    const j = Math.floor(xyz[p + 1] * inv)
    const k = Math.floor(xyz[p + 2] * inv)
    const idx = (i - g.i0) * nyz + (j - g.j0) * g.nz + (k - g.k0)
    const w = idx >>> 5
    const m = 1 << (idx & 31)
    if ((bits[w] & m) === 0) {
      bits[w] |= m
      found[count * 3] = i
      found[count * 3 + 1] = j
      found[count * 3 + 2] = k
      count++
    }
  }
  return count
}

/** Unique-cell count by sorting linear indices, for grids too fine for the bitset. */
function countSorted(s: Sample, edge: number, g: Grid): number {
  const n = s.xyz.length / 3
  const keys = new Float64Array(n)
  const inv = 1 / edge
  const nyz = g.ny * g.nz
  for (let p = 0, q = 0; q < n; p += 3, q++) {
    const i = Math.floor(s.xyz[p] * inv) - g.i0
    const j = Math.floor(s.xyz[p + 1] * inv) - g.j0
    const k = Math.floor(s.xyz[p + 2] * inv) - g.k0
    keys[q] = i * nyz + j * g.nz + k
  }
  keys.sort()
  let count = n > 0 ? 1 : 0
  for (let q = 1; q < n; q++) if (keys[q] !== keys[q - 1]) count++
  return count
}

const COUNT_CACHE_MAX = 256
const countCache = new Map<number, number>()

function countFor(edge: number): number {
  const hit = countCache.get(edge)
  if (hit !== undefined) return hit
  const s = getSample()
  const g = gridFor(s, edge)
  let count = markDense(s, edge, g)
  if (count < 0) count = countSorted(s, edge, g)
  if (countCache.size >= COUNT_CACHE_MAX) countCache.delete(countCache.keys().next().value as number)
  countCache.set(edge, count)
  return count
}

function assertEdge(edge: number): void {
  if (!(edge > 0) || !Number.isFinite(edge)) throw new RangeError(`box edge must be a positive number, got ${edge}`)
}

/** Occupied-cell counts of the Lorenz sample for each edge (render units). Cached per edge. */
export function boxCounts(edges: readonly number[]): BoxTally[] {
  return edges.map((edge) => {
    assertEdge(edge)
    return { edge, count: countFor(edge) }
  })
}

/**
 * Box-counting dimension of the Lorenz sample: least-squares slope of log(count) against
 * log(1/edge) over `edges` (at least two distinct). For the halving ladder 0.25 … 0.03125 it is
 * ≈ 1.87: the 200k-point sample misses rarely visited cells at the finer edges, and at these
 * coarse scales the sheet's rim still counts, so it sits below the asymptotic ≈ 2.06.
 */
export function boxDimension(edges: readonly number[]): number {
  const counts = boxCounts(edges)
  return fitLine(
    counts.map((c) => -Math.log(c.edge)),
    counts.map((c) => Math.log(c.count)),
  ).slope
}

/** Ordinary least squares y = a + slope·x. */
export function fitLine(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN }
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += xs[i]
    my += ys[i]
  }
  mx /= n
  my /= n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  const slope = sxy / sxx
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1
  return { slope, intercept: my - slope * mx, r2 }
}

// ---------------------------------------------------------------- the lattice to draw

/**
 * Corner pairs of the 12 edges of the unit cube [0,1]³, edge e = axis·4 + ou·2 + ov: an edge
 * along `axis` at offsets (ou, ov) on the other two axes in order (x: y,z; y: x,z; z: x,y).
 * 24 vertices × xyz, two per edge, in edge order.
 */
export function unitCubeEdges(): Float32Array {
  const out = new Float32Array(24 * 3)
  for (let e = 0; e < 12; e++) {
    const axis = e >> 2
    const ou = (e >> 1) & 1
    const ov = e & 1
    for (let end = 0; end < 2; end++) {
      const o = (e * 2 + end) * 3
      const c = axis === 0 ? [end, ou, ov] : axis === 1 ? [ou, end, ov] : [ou, ov, end]
      out[o] = c[0]
      out[o + 1] = c[1]
      out[o + 2] = c[2]
    }
  }
  return out
}

/** the four cells around a lattice line at (U, V), in ownership order: offsets (du, dv) */
const OWN_DU = [-1, -1, 0, 0]
const OWN_DV = [-1, 0, -1, 0]

function occupied(g: Grid, i: number, j: number, k: number): boolean {
  const a = i - g.i0
  const b = j - g.j0
  const c = k - g.k0
  if (a < 0 || b < 0 || c < 0 || a >= g.nx || b >= g.ny || c >= g.nz) return false
  const idx = (a * g.ny + b) * g.nz + c
  return (bits[idx >>> 5] & (1 << (idx & 31))) !== 0
}

/** Edge mask of cell (ci, cj, ck): bit e set iff this cell is the first occupied cell around that edge. */
function ownedEdges(g: Grid, ci: number, cj: number, ck: number): number {
  let mask = 0
  for (let e = 0; e < 12; e++) {
    const axis = e >> 2
    const ou = (e >> 1) & 1
    const ov = e & 1
    // this cell's place among the four around the edge's lattice line
    const self = (1 - ou) * 2 + (1 - ov)
    const cu = axis === 0 ? cj : ci
    const cv = axis === 2 ? cj : ck
    const U = cu + ou
    const V = cv + ov
    let own = true
    for (let q = 0; q < self; q++) {
      const u = U + OWN_DU[q]
      const v = V + OWN_DV[q]
      const hit =
        axis === 0 ? occupied(g, ci, u, v) : axis === 1 ? occupied(g, u, cj, v) : occupied(g, u, v, ck)
      if (hit) {
        own = false
        break
      }
    }
    if (own) mask |= 1 << e
  }
  return mask
}

const LATTICE_CACHE_MAX = 8
const latticeCache = new Map<number, BoxLattice | null>()

/**
 * The occupied cells of `edge` and their edge masks, capped at MAX_BOXES (an even stride
 * through the first-visit order when capped). Null if the edge is too fine to grid at all
 * (below ≈ 0.0045). Cached for the last few edges.
 */
export function boxLattice(edge: number): BoxLattice | null {
  assertEdge(edge)
  const hit = latticeCache.get(edge)
  if (hit !== undefined) {
    // refresh its place in the LRU order
    latticeCache.delete(edge)
    latticeCache.set(edge, hit)
    return hit
  }
  const s = getSample()
  const g = gridFor(s, edge)
  const count = markDense(s, edge, g)
  let lattice: BoxLattice | null = null
  if (count >= 0) {
    if (!countCache.has(edge)) countCache.set(edge, count)
    const drawn = Math.min(count, MAX_BOXES)
    const cells = new Float32Array(drawn * 3)
    const masks = new Float32Array(drawn)
    if (count <= MAX_BOXES) {
      for (let c = 0; c < count; c++) {
        const i = found[c * 3]
        const j = found[c * 3 + 1]
        const k = found[c * 3 + 2]
        cells[c * 3] = i
        cells[c * 3 + 1] = j
        cells[c * 3 + 2] = k
        masks[c] = ownedEdges(g, i, j, k)
      }
    } else {
      const stride = count / drawn
      for (let c = 0; c < drawn; c++) {
        const src = Math.floor(c * stride) * 3
        cells[c * 3] = found[src]
        cells[c * 3 + 1] = found[src + 1]
        cells[c * 3 + 2] = found[src + 2]
        masks[c] = 0xfff
      }
    }
    lattice = { edge, count, drawn, cells, masks }
  }
  if (latticeCache.size >= LATTICE_CACHE_MAX) latticeCache.delete(latticeCache.keys().next().value as number)
  latticeCache.set(edge, lattice)
  return lattice
}
