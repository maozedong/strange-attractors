/**
 * Lenia's rule, shared by the GPU stage (kernel upload, stamping) and the CPU reference in
 * verify.ts. Nothing here touches WebGL.
 *
 *   A ← clip(A + dt · G(K ∗ A), 0, 1),  dt = 1 / T
 *   G(u) = 2 · exp(−((u − m) / s)² / 2) − 1
 *   K(d) = shell(|d| / R),  shell(r) = β[⌊B r⌋] · core(B r mod 1)  for r < 1,  ΣK = 1
 *   core(r) = exp(4 − 1 / (r (1 − r)))  on (0, 1)   (Chan's "exponential bump", peak 1 at ½)
 *
 * The kernel is sampled at integer cell offsets (dx, dy) ∈ [−KERNEL_RADIUS, KERNEL_RADIUS]²,
 * row-major with dy outermost, dx = col − KERNEL_RADIUS, dy = row − KERNEL_RADIUS. The grid
 * is periodic in both directions.
 */
import type { LeniaSpecies } from './species'

/** Largest kernel radius the shader supports, in cells. */
export const KERNEL_RADIUS = 13
/** Kernel texture edge: 2 · KERNEL_RADIUS + 1 taps. */
export const KERNEL_DIAMETER = 2 * KERNEL_RADIUS + 1

/** Chan's exponential kernel core on (0, 1); 0 outside. */
export function kernelCore(r: number): number {
  if (!(r > 0 && r < 1)) return 0
  return Math.exp(4 - 1 / (r * (1 - r)))
}

/** The multi-ring shell at normalised distance r = |d| / R (unnormalised). */
export function kernelShell(r: number, peaks: readonly number[]): number {
  if (!(r >= 0 && r < 1)) return 0
  const b = peaks.length
  const br = b * r
  const ring = Math.min(Math.floor(br), b - 1)
  return peaks[ring] * kernelCore(br - ring)
}

/**
 * The species' kernel as KERNEL_DIAMETER² weights summing to 1, float32 (what the GPU sees).
 * Writes into `out` when given (length ≥ KERNEL_DIAMETER²) so a species switch allocates nothing.
 */
export function buildKernel(species: LeniaSpecies, out?: Float32Array): Float32Array {
  const { R, T, m, s, peaks } = species
  if (!(R > 1 && R <= KERNEL_RADIUS) || !(T > 0) || !Number.isFinite(m) || !(s > 0) || peaks.length === 0) {
    throw new Error(
      `Lenia species '${species.id}': need 1 < R ≤ ${KERNEL_RADIUS}, T > 0, finite m, s > 0 and at least one peak (R ${R}, T ${T}, m ${m}, s ${s}, ${peaks.length} peaks).`,
    )
  }
  const n = KERNEL_DIAMETER * KERNEL_DIAMETER
  const k = out ?? new Float32Array(n)
  let sum = 0
  for (let row = 0; row < KERNEL_DIAMETER; row++) {
    for (let col = 0; col < KERNEL_DIAMETER; col++) {
      const dx = col - KERNEL_RADIUS
      const dy = row - KERNEL_RADIUS
      const w = kernelShell(Math.sqrt(dx * dx + dy * dy) / species.R, species.peaks)
      sum += w
    }
  }
  if (!(sum > 0 && Number.isFinite(sum))) {
    throw new Error(`Lenia species '${species.id}': the kernel has no positive weight (Σ = ${sum}); check R and peaks.`)
  }
  for (let row = 0; row < KERNEL_DIAMETER; row++) {
    for (let col = 0; col < KERNEL_DIAMETER; col++) {
      const dx = col - KERNEL_RADIUS
      const dy = row - KERNEL_RADIUS
      k[row * KERNEL_DIAMETER + col] = kernelShell(Math.sqrt(dx * dx + dy * dy) / species.R, species.peaks) / sum
    }
  }
  return k
}

/** Lenia's growth mapping, in [−1, 1]. */
export function growth(u: number, m: number, s: number): number {
  const z = (u - m) / s
  return 2 * Math.exp(-0.5 * z * z) - 1
}

/** Quarter turns applied to a stamped pattern, counter-clockwise in grid (x right, y up). */
export type QuarterTurns = 0 | 1 | 2 | 3

/**
 * Write the species' cell pattern into a periodic N × N field (row-major, y = row), its
 * centre at (cx, cy), rotated by `turns` quarter turns. Overwrites with max(existing, cell).
 * `stride` and `offset` address one channel of an interleaved array (e.g. 4 and 0 for the R
 * channel of an RGBA upload); defaults 1 and 0.
 */
export function stampPattern(
  field: Float32Array,
  N: number,
  cells: readonly (readonly number[])[],
  cx: number,
  cy: number,
  turns: QuarterTurns,
  stride = 1,
  offset = 0,
): void {
  const h = cells.length
  for (let r = 0; r < h; r++) {
    const row = cells[r]
    const w = row.length
    for (let c = 0; c < w; c++) {
      const v = row[c]
      if (!(v > 0)) continue
      // pattern coords centred on the pattern's middle; row 0 is the top (+y)
      const px = c - (w - 1) / 2
      const py = (h - 1) / 2 - r
      let qx = px
      let qy = py
      for (let t = 0; t < turns; t++) {
        const tx = qx
        qx = -qy
        qy = tx
      }
      const x = mod(Math.round(cx + qx), N)
      const y = mod(Math.round(cy + qy), N)
      const i = (y * N + x) * stride + offset
      if (v > field[i]) field[i] = Math.min(1, v)
    }
  }
}

/**
 * Where the creatures go at a reset, as fractions of the grid edge (cell-exact on 256²): one
 * in the centre, two offset and turned 90°. The two turned ones travel in parallel, so only
 * their paths across the centre one's can meet; the offsets were chosen (from Orbium's
 * measured velocity) to put the first close encounter as late as possible, ≈ 1350
 * generations, and every stamp at least 10 cells inside the edge. verify.ts reports the real
 * first encounter.
 */
export const SEED_LAYOUT: readonly { x: number; y: number; turns: QuarterTurns }[] = [
  { x: 128 / 256, y: 128 / 256, turns: 0 },
  { x: 148 / 256, y: 196 / 256, turns: 1 },
  { x: 180 / 256, y: 28 / 256, turns: 1 },
]

export function mod(a: number, n: number): number {
  const r = a % n
  return r < 0 ? r + n : r
}

/**
 * Number of 8-connected components of cells with value > threshold on a periodic n × n grid
 * (row-major). `labels` and `queue` are caller-owned scratch of length ≥ n², so a per-frame
 * caller allocates nothing. `stride`/`offset` pick one channel of an interleaved array.
 */
export function countBlobs(
  values: ArrayLike<number>,
  n: number,
  threshold: number,
  labels: Int32Array,
  queue: Int32Array,
  stride = 1,
  offset = 0,
): number {
  const cells = n * n
  labels.fill(0, 0, cells)
  let count = 0
  for (let start = 0; start < cells; start++) {
    if (labels[start] !== 0 || !(values[start * stride + offset] > threshold)) continue
    count++
    labels[start] = count
    let head = 0
    let tail = 0
    queue[tail++] = start
    while (head < tail) {
      const c = queue[head++]
      const cx = c % n
      const cy = (c - cx) / n
      for (let oy = -1; oy <= 1; oy++) {
        const y = (cy + oy + n) % n
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue
          const x = (cx + ox + n) % n
          const k = y * n + x
          if (labels[k] !== 0 || !(values[k * stride + offset] > threshold)) continue
          labels[k] = count
          queue[tail++] = k
        }
      }
    }
  }
  return count
}
