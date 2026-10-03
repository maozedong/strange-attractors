/**
 * The Gray–Scott model on the unit sphere, discretised on an equirectangular texel grid.
 * Shared by the GPU simulation (TuringSim), the CPU reference (cpu.ts) and verify.ts, so all
 * three agree on the grid, the constants and the seeding.
 *
 * Parametrisation: texel (i, j) of a GRID_W × GRID_H texture has its centre at
 *   s = (i + ½) / W,  t = (j + ½) / H,   φ = 2π s,  θ = π t   (θ = 0 is the north pole, +Y).
 * dφ = 2π / 1024 and dθ = π / 512 are equal, so at the equator the texels are square. Lengths
 * are measured in that texel spacing h = dθ, which makes the Laplacian below the standard
 * 5-point stencil at the equator.
 *
 * Laplace–Beltrami operator on the unit sphere, in finite-volume (conservative) form:
 *   ∇²u = (1 / sin²θ) ∂²u/∂φ² + (1 / sinθ) ∂/∂θ (sinθ ∂u/∂θ)
 *   h²∇²u ≈ cPhi (u_E + u_W − 2u) + cN (u_N − u) + cS (u_S − u)
 *   cN = sin θ_{j−½} / sin θ_j,   cS = sin θ_{j+½} / sin θ_j,   cPhi = 1 / (m_j sin θ_j)²
 *
 * Reduced grid (the pole problem). With dt = 1 the explicit update is stable only while
 * Du · λmax ≤ 2, and the φ term alone has λ = 4 / sin²θ: at full φ resolution every row with
 * sin θ < 0.69 (within ~43° of either pole) blows up, not just the pole rows. So row j is split
 * into cells of m_j texels (m_j a power of two, so cells tile the row exactly), chosen as the
 * smallest with m_j sin θ_j ≥ MIN_PHI_SPACING: the φ spacing of a cell stays within
 * [0.8, 1.6) equator texels on every row but the poles. Every texel of a cell holds the cell's
 * value (the step computes it from the cell's first texel only, so this is re-imposed exactly
 * every step). Moving away from a pole m at most halves per row, so a cell's neighbour across a
 * θ face is two cells (finer: their mean over our span), one cell of the same size, or one coarser
 * cell. A coarser cell's centre is a quarter of its width away in φ, so it is read linearly
 * reconstructed at our centre, u_C ± (u_E − u_W) / 8; otherwise ∂u/∂φ leaks into the θ difference
 * (a first-order error: verify.ts measured 13 % at the pattern's wavelength near the poles before
 * this). The two halves of a coarse cell get opposite corrections, so the coarse cell still sees
 * exactly its own value.
 *
 * The poles. Each pole row is a single cell (m = W): the polar cap of radius dθ. Its φ term is
 * zero (there is no φ neighbour) and its value is by construction the mean of its row, every
 * step, with no extra pass. Its one face is the ring of row 1 (or H − 2), and it reads the exact
 * mean of that ring: POLE_TAPS = W / m_1 taps (8), in a branch only the two pole rows take.
 *
 * The flux through every face is the same seen from both sides, so Σ sin θ_j m_j u is conserved
 * exactly by diffusion; verify.ts checks this and the stability bound on the CPU reference.
 */

export const GRID_W = 1024
export const GRID_H = 512
/** diffusion rates in equator-texel² per step (Pearson's ratio Du / Dv = 2) */
export const DU = 0.16
export const DV = 0.08
export const DT = 1
/** smallest φ spacing of a reduced-grid cell, in equator texels (see the header) */
export const MIN_PHI_SPACING = 0.8

export interface RowTable {
  W: number
  H: number
  /** texels per cell in row j (a power of two; W at the pole rows) */
  m: Int32Array
  /** sin θ_j at the row centre (floored at sin(dθ / 2)) */
  sin: Float64Array
  cN: Float64Array
  cS: Float64Array
  cPhi: Float64Array
  /** cells in the row next to each pole, whose mean the cap reads (m[0] / m[1]) */
  poleTaps: number
}

/**
 * The reduced-grid row table. `naive` gives the scheme the cell sizes replace: full φ resolution
 * on every row, the pole rows averaged and their φ term zeroed. verify.ts shows it blows up.
 */
export function buildRows(W = GRID_W, H = GRID_H, { naive = false, minSpacing = MIN_PHI_SPACING } = {}): RowTable {
  if (!isPow2(W) || H % 2 !== 0 || H < 4) throw new Error(`buildRows: need W a power of two and H even ≥ 4, got ${W} × ${H}`)
  const m = new Int32Array(H)
  const sin = new Float64Array(H)
  const cN = new Float64Array(H)
  const cS = new Float64Array(H)
  const cPhi = new Float64Array(H)
  const dTheta = Math.PI / H
  const sinFloor = Math.sin(dTheta / 2)
  for (let j = 0; j < H; j++) {
    sin[j] = Math.max(Math.sin(dTheta * (j + 0.5)), sinFloor)
    let p = 1
    while (!naive && p < W && p * sin[j] < minSpacing) p *= 2
    m[j] = p
  }
  // the shader compiles the north ring's cell count in for both caps: make the south
  // hemisphere the exact mirror of the north rather than trusting floating-point symmetry
  for (let j = 0; j < H / 2; j++) {
    sin[H - 1 - j] = sin[j]
    m[H - 1 - j] = m[j]
  }
  // the poles are one cell each (the caps read the whole next ring); beyond them a row may at
  // most halve its cell size, so every other face needs only two taps
  m[0] = W
  m[H - 1] = W
  if (!naive) {
    for (let j = 2; j < H / 2; j++) m[j] = Math.max(m[j], m[j - 1] >> 1)
    for (let j = H - 3; j >= H / 2; j--) m[j] = Math.max(m[j], m[j + 1] >> 1)
  }
  for (let j = 0; j < H; j++) {
    // face sines; the faces at θ = 0 and θ = π have zero length (nothing flows through a pole)
    const sNorth = j === 0 ? 0 : Math.sin(dTheta * j)
    const sSouth = j === H - 1 ? 0 : Math.sin(dTheta * (j + 1))
    cN[j] = sNorth / sin[j]
    cS[j] = sSouth / sin[j]
    cPhi[j] = m[j] >= W ? 0 : 1 / (m[j] * sin[j]) ** 2
  }
  return { W, H, m, sin, cN, cS, cPhi, poleTaps: W / m[1] }
}

/** The row table as an RGBA float texture column (1 × H): (m, cN, cS, cPhi) per row. */
export function rowTexels(rows: RowTable): Float32Array {
  const out = new Float32Array(rows.H * 4)
  for (let j = 0; j < rows.H; j++) {
    out[j * 4] = rows.m[j]
    out[j * 4 + 1] = rows.cN[j]
    out[j * 4 + 2] = rows.cS[j]
    out[j * 4 + 3] = rows.cPhi[j]
  }
  return out
}

/** Largest Du·λ of the diffusion operator over the rows (Gershgorin); explicit Euler needs ≤ 2. */
export function diffusionCfl(rows: RowTable, D = DU): number {
  let worst = 0
  for (let j = 0; j < rows.H; j++) worst = Math.max(worst, D * (4 * rows.cPhi[j] + 2 * (rows.cN[j] + rows.cS[j])))
  return worst
}

// ---------------------------------------------------------------- seeding

/** Seed of the initial-state PRNG: every reset grows from the same seeds. */
export const SEED = 0x7a11e5
/** how many discs of V = 0.5 start the pattern on the sphere */
export const SEED_DISCS = 40
/** disc radius in equator texels */
export const SEED_RADIUS = 4
/** u starts in [1 − NOISE, 1], v in [0, NOISE] (plus 0.5 inside the discs) */
export const SEED_NOISE = 0.02

export interface SeedOptions {
  seed?: number
  discs?: number
  radius?: number
  noise?: number
}

/**
 * Initial state on the sphere: u ≈ 1, v ≈ 0 with uniform noise, v += 0.5 in `discs` discs of
 * geodesic radius `radius` (equator texels) centred uniformly on the sphere (overlaps do not stack),
 * then each reduced-grid
 * cell set to the mean of its texels. Writes W × H values into `u` and `v` (row-major, j rows).
 */
export function seedSphere(u: Float32Array, v: Float32Array, rows: RowTable, opts: SeedOptions = {}): void {
  const { W, H } = rows
  const rand = mulberry32(opts.seed ?? SEED)
  const noise = opts.noise ?? SEED_NOISE
  const discs = opts.discs ?? SEED_DISCS
  const rad = (opts.radius ?? SEED_RADIUS) * (Math.PI / H)
  for (let p = 0; p < W * H; p++) {
    u[p] = 1 - noise * rand()
    v[p] = noise * rand()
  }
  const cosRad = Math.cos(rad)
  for (let d = 0; d < discs; d++) {
    const z = 2 * rand() - 1 // uniform on the sphere: cos θ uniform, φ uniform
    const phi = 2 * Math.PI * rand()
    const st = Math.sqrt(1 - z * z)
    const cx = st * Math.cos(phi)
    const cy = z
    const cz = st * Math.sin(phi)
    const thetaC = Math.acos(z)
    const j0 = Math.max(0, Math.floor(((thetaC - rad) / Math.PI) * H) - 1)
    const j1 = Math.min(H - 1, Math.ceil(((thetaC + rad) / Math.PI) * H) + 1)
    for (let j = j0; j <= j1; j++) {
      const th = (Math.PI * (j + 0.5)) / H
      const sy = Math.cos(th)
      const sr = Math.sin(th)
      for (let i = 0; i < W; i++) {
        const ph = (2 * Math.PI * (i + 0.5)) / W
        const p = j * W + i
        // overlapping discs stay at 0.5 (plus the noise), they do not stack
        if (v[p] < 0.5 && sr * Math.cos(ph) * cx + sy * cy + sr * Math.sin(ph) * cz >= cosRad) v[p] += 0.5
      }
    }
  }
  // one value per cell: the mean of its texels
  for (let j = 0; j < H; j++) {
    const m = rows.m[j]
    if (m === 1) continue
    for (let g = 0; g < W; g += m) {
      let su = 0
      let sv = 0
      for (let q = 0; q < m; q++) {
        su += u[j * W + g + q]
        sv += v[j * W + g + q]
      }
      for (let q = 0; q < m; q++) {
        u[j * W + g + q] = su / m
        v[j * W + g + q] = sv / m
      }
    }
  }
}

/** The same seeding on a flat N × N periodic grid (discs of `radius` texels, uniform centres). */
export function seedFlat(u: Float32Array | Float64Array, v: Float32Array | Float64Array, N: number, opts: SeedOptions = {}): void {
  const rand = mulberry32(opts.seed ?? SEED)
  const noise = opts.noise ?? SEED_NOISE
  const discs = opts.discs ?? SEED_DISCS
  const r = opts.radius ?? SEED_RADIUS
  for (let p = 0; p < N * N; p++) {
    u[p] = 1 - noise * rand()
    v[p] = noise * rand()
  }
  for (let d = 0; d < discs; d++) {
    const cx = N * rand()
    const cy = N * rand()
    for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) {
      for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy > r * r) continue
        const p = (((y % N) + N) % N) * N + (((x % N) + N) % N)
        if (v[p] < 0.5) v[p] += 0.5
      }
    }
  }
}

/** Small, fast, seedable PRNG (Tommy Ettinger's mulberry32). Returns floats in [0, 1). */
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

function isPow2(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}
