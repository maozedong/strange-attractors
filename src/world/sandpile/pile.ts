/**
 * The Bak–Tang–Wiesenfeld sandpile on an n x n square grid with open edges, shared by the stage,
 * the worker and `verify.ts`. No three.js here.
 *
 * Layout: heights live in a padded (n + 2) x (n + 2) Int32Array. Site (x, y), 0 ≤ x, y < n, is
 * index (y + 1)·W + (x + 1) with W = n + 2, row y = 0 at the bottom. The one-cell frame around
 * the grid is the sink: its cells start at SINK (about −2^30) so they never reach 4 and never
 * topple, and toppling needs no bounds checks. Grains that land there are lost.
 *
 * Toppling is a stack, not recursion: a site is pushed only when it crosses from < 4 to ≥ 4, so it
 * is on the stack at most once and n² slots always suffice. A popped site topples floor(h/4)
 * times at once (the abelian property makes the order irrelevant to the final grid and the
 * number of topplings). The stack lives on the pile, so an avalanche can be relaxed a budget at a
 * time and resumed later.
 */

export const SINK = -(2 ** 30)

/** Sites per side of the stage's grid (odd, so there is a true centre). */
export const SAND_N = 255

/**
 * Grains poured on the centre for the single-source pattern. The largest round number whose pile
 * stays clear of a 255 grid's edge (half-width 116 of 127 sites, nothing falls off), so it is the
 * same pattern as on an infinite plane. 2^17 already spills 4.7k grains over the edge; 2^18 loses
 * 45% of its grains and the edge, not the fractal, sets the picture.
 */
export const IDENTITY_GRAINS = 100_000

/**
 * The live pile's start is poured one grain at a time up to this density (still below the
 * critical 2.125, so the avalanches are tiny and pouring is cheap), then made exactly recurrent
 * (see buildCriticalPile).
 */
export const FILL_DENSITY = 2.11

export interface Pile {
  /** sites per side */
  n: number
  /** padded row stride, n + 2 */
  w: number
  /** grains per site, padded; interior values are 0..3 when stable */
  h: Int32Array
  /** unstable sites awaiting toppling: stack[0 .. top) */
  stack: Int32Array
  /** entries on the stack; > 0 means an avalanche is in progress */
  top: number
}

export function createPile(n: number): Pile {
  const w = n + 2
  const pile: Pile = { n, w, h: new Int32Array(w * w), stack: new Int32Array(n * n), top: 0 }
  clearPile(pile)
  return pile
}

/** Empty grid, sink frame reset. */
export function clearPile(p: Pile): void {
  const { n, w, h } = p
  h.fill(0)
  p.top = 0
  for (let i = 0; i < w; i++) {
    h[i] = SINK // bottom frame row
    h[(n + 1) * w + i] = SINK // top
    h[i * w] = SINK // left
    h[i * w + n + 1] = SINK // right
  }
}

/** Padded index of interior site (x, y). */
export function siteIndex(p: Pile, x: number, y: number): number {
  return (y + 1) * p.w + x + 1
}

/** Padded index of the centre site (n odd: the exact centre). */
export function centreIndex(p: Pile): number {
  const c = (p.n - 1) >> 1
  return siteIndex(p, c, c)
}

/** mulberry32: a small, fast, well-mixed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Every site 0..3 independently and uniformly. */
export function seedUniform(p: Pile, rand: () => number): void {
  clearPile(p)
  const { n, w, h } = p
  for (let y = 0; y < n; y++) {
    const row = (y + 1) * w + 1
    for (let x = 0; x < n; x++) h[row + x] = (rand() * 4) | 0
  }
}

/**
 * Topple unstable sites from the pile's stack until it is empty (the grid is stable) or at least
 * `budget` topplings have run; a later call resumes where this one stopped. Marks each site that
 * topples with `heat[i] = 1` when `heat` is given. Returns the number of topplings done.
 */
export function relaxStack(p: Pile, heat: Float32Array | null, budget = Infinity): number {
  const h = p.h
  const stack = p.stack
  const w = p.w
  let top = p.top
  let topplings = 0
  while (top > 0 && topplings < budget) {
    const i = stack[--top]
    const v = h[i]
    const t = v >> 2
    h[i] = v & 3
    topplings += t
    if (heat !== null) heat[i] = 1
    let j = i - 1
    let u = h[j] + t
    h[j] = u
    if (u >= 4 && u - t < 4) stack[top++] = j
    j = i + 1
    u = h[j] + t
    h[j] = u
    if (u >= 4 && u - t < 4) stack[top++] = j
    j = i - w
    u = h[j] + t
    h[j] = u
    if (u >= 4 && u - t < 4) stack[top++] = j
    j = i + w
    u = h[j] + t
    h[j] = u
    if (u >= 4 && u - t < 4) stack[top++] = j
  }
  p.top = top
  return topplings
}

/**
 * Add one grain at padded index `i` of a stable grid. Returns true if the site became unstable
 * (it is then on the stack: an avalanche has started).
 */
export function addGrain(p: Pile, i: number): boolean {
  const v = p.h[i] + 1
  p.h[i] = v
  if (v !== 4) return false
  p.stack[p.top++] = i
  return true
}

/**
 * Add one grain at padded index `i` and relax completely. Returns the avalanche size
 * (topplings, 0 when the site stays stable). The grid must be stable on entry.
 */
export function dropGrain(p: Pile, i: number, heat: Float32Array | null): number {
  return addGrain(p, i) ? relaxStack(p, heat) : 0
}

/** Add `grains` at padded index `i` all at once and relax with the stack. */
export function dropMany(p: Pile, i: number, grains: number): number {
  const before = p.h[i]
  p.h[i] = before + grains
  if (p.h[i] < 4 || before >= 4) return 0
  p.stack[p.top++] = i
  return relaxStack(p, null)
}

/**
 * Relax an arbitrary (possibly very unstable) grid by repeated sweeps that topple every site with
 * h ≥ 4 by floor(h/4) at once, in place, until a sweep finds nothing to topple. Each sweep covers
 * only the box around last sweep's topplings, grown by one cell, and alternates direction.
 * Returns the number of sweeps (including the final, idle one) and of topplings.
 */
export function relaxSweeps(p: Pile): { sweeps: number; topplings: number } {
  const { n, w, h } = p
  // start from the bounding box of the unstable sites
  let x0 = n
  let x1 = -1
  let y0 = n
  let y1 = -1
  for (let y = 0; y < n; y++) {
    const row = (y + 1) * w + 1
    for (let x = 0; x < n; x++) {
      if (h[row + x] < 4) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  let sweeps = 1
  let topplings = 0
  while (x1 >= 0) {
    sweeps++
    const forward = (sweeps & 1) === 0
    let nx0 = n
    let nx1 = -1
    let ny0 = n
    let ny1 = -1
    for (let k = y0; k <= y1; k++) {
      const y = forward ? k : y0 + y1 - k
      const row = (y + 1) * w + 1
      let rowActive = false
      for (let m = x0; m <= x1; m++) {
        const x = forward ? m : x0 + x1 - m
        const i = row + x
        const v = h[i]
        if (v < 4) continue
        const t = v >> 2
        h[i] = v & 3
        h[i - 1] += t
        h[i + 1] += t
        h[i - w] += t
        h[i + w] += t
        topplings += t
        rowActive = true
        if (x < nx0) nx0 = x
        if (x > nx1) nx1 = x
      }
      if (rowActive) {
        if (y < ny0) ny0 = y
        if (y > ny1) ny1 = y
      }
    }
    if (nx1 < 0) break
    // anything unstable now is a toppled site or one of its neighbours
    x0 = Math.max(0, nx0 - 1)
    x1 = Math.min(n - 1, nx1 + 1)
    y0 = Math.max(0, ny0 - 1)
    y1 = Math.min(n - 1, ny1 + 1)
  }
  return { sweeps, topplings }
}

/** Interior heights as a compact n x n Uint8Array (row y = 0 first). */
export function interior(p: Pile, out = new Uint8Array(p.n * p.n)): Uint8Array {
  const { n, w, h } = p
  for (let y = 0; y < n; y++) {
    const row = (y + 1) * w + 1
    for (let x = 0; x < n; x++) out[y * n + x] = h[row + x]
  }
  return out
}

/** Total grains on the interior. */
export function grainsOn(p: Pile): number {
  const { n, w, h } = p
  let s = 0
  for (let y = 0; y < n; y++) {
    const row = (y + 1) * w + 1
    for (let x = 0; x < n; x++) s += h[row + x]
  }
  return s
}

/** Copy a compact n x n grid (as from `interior`) into the pile; the sink frame is reset. */
export function loadInterior(p: Pile, grid: ArrayLike<number>): void {
  clearPile(p)
  const { n, w, h } = p
  for (let y = 0; y < n; y++) {
    const row = (y + 1) * w + 1
    for (let x = 0; x < n; x++) h[row + x] = grid[y * n + x]
  }
}

/** Padded index of a uniformly random interior site (one draw). */
export function randomSite(p: Pile, rand: () => number): number {
  const n = p.n
  const k = (rand() * n * n) | 0
  const y = (k / n) | 0
  return (y + 1) * p.w + (k - y * n) + 1
}

/**
 * Add the burning vector (one grain per edge a site shares with the sink: 1 along the sides, 2 at
 * the corners) and relax. On a stable grid every site topples at most once, and exactly once,
 * leaving the grid unchanged, iff the grid is recurrent (Dhar's burning test). Returns the
 * number of topplings, so a return of n² means "was recurrent".
 */
export function addBurningVector(p: Pile): number {
  const { n, w, h, stack } = p
  let top = p.top
  // walk each side of the grid; corners are visited twice and get their two grains
  const first = w + 1
  const sides = [
    [first, 1], // bottom row, left to right
    [first + (n - 1) * w, 1], // top row
    [first, w], // left column, bottom to top
    [first + n - 1, w], // right column
  ]
  for (const [start, stride] of sides) {
    for (let k = 0, i = start; k < n; k++, i += stride) {
      const v = h[i] + 1
      h[i] = v
      if (v === 4) stack[top++] = i
    }
  }
  p.top = top
  return relaxStack(p, null)
}

/** Dhar's burning test on a copy (the pile is not changed). */
export function isRecurrent(p: Pile): boolean {
  const copy: Pile = { n: p.n, w: p.w, h: p.h.slice(), stack: new Int32Array(p.n * p.n), top: 0 }
  return addBurningVector(copy) === p.n * p.n
}

/**
 * A critical pile: every site 0..3 uniformly at random (mulberry32 from `seed`), then poured one
 * random grain at a time up to FILL_DENSITY, then the burning vector added until the grid is
 * recurrent. Adding the burning vector is the same as adding nothing (it is the Laplacian of the
 * all-ones toppling vector), so this only moves the grid to the one recurrent configuration
 * equivalent to it: no further grains are involved. The result is a recurrent grid whose height
 * statistics match the stationary state of the slowly driven pile (P(0..3) ≈ 0.074, 0.174,
 * 0.306, 0.446, density ≈ 2.125), so avalanches have their critical sizes from the first grain.
 *
 * A uniform 0..3 start alone has density 1.5: it takes ~42k grains (3.5 minutes at 200 grains/s)
 * before the first sizeable avalanche. About 40 ms for 255 x 255 on a desktop.
 */
export function buildCriticalPile(n: number, seed: number): { grid: Uint8Array; poured: number; rounds: number } {
  const p = createPile(n)
  const rand = mulberry32(seed)
  seedUniform(p, rand)
  const target = FILL_DENSITY * n * n
  let poured = 0
  while (grainsOn(p) < target) {
    for (let k = 0; k < 256; k++) dropGrain(p, randomSite(p, rand), null)
    poured += 256
  }
  let rounds = 0
  while (addBurningVector(p) !== n * n) {
    if (++rounds > 1_000_000) throw new Error('[sandpile] burning test did not converge')
  }
  return { grid: interior(p), poured, rounds }
}

/**
 * `grains` grains placed on the centre of an empty n x n grid at once, relaxed by sweeps.
 * Returns the stable grid, the grains that fell off the edge, sweeps and topplings.
 */
export function buildSingleSource(
  n: number,
  grains: number,
): { grid: Uint8Array; lost: number; sweeps: number; topplings: number } {
  const p = createPile(n)
  p.h[centreIndex(p)] = grains
  const { sweeps, topplings } = relaxSweeps(p)
  return { grid: interior(p), lost: grains - grainsOn(p), sweeps, topplings }
}

// ---------------------------------------------------------------- worker jobs

export type SandJob = { kind: 'critical'; n: number; seed: number } | { kind: 'identity'; n: number; grains: number }

export interface SandJobResult {
  kind: SandJob['kind']
  /** compact n x n heights, row y = 0 first */
  grid: Uint8Array
  /** wall time of the computation */
  ms: number
}

/** Run a job where it is called (the worker, or the main thread as a fallback). */
export function runSandJob(job: SandJob): SandJobResult {
  const t0 = performance.now()
  const grid = job.kind === 'critical' ? buildCriticalPile(job.n, job.seed).grid : buildSingleSource(job.n, job.grains).grid
  return { kind: job.kind, grid, ms: performance.now() - t0 }
}
