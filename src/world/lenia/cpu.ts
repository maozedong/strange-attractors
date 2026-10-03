/**
 * CPU reference of the Lenia update on a periodic N × N grid (N a power of two), the same
 * rule and kernel as the GPU step. For verify.ts and searches; not used by the stage.
 * State is stored in float32 like the GPU's render targets; sums run in float64.
 */
import { KERNEL_DIAMETER, KERNEL_RADIUS, buildKernel, growth } from './core'
import type { LeniaSpecies } from './species'

export class CpuLenia {
  readonly N: number
  A: Float32Array
  private B: Float32Array
  private readonly U: Float64Array
  private readonly tapDx: Int32Array
  private readonly tapDy: Int32Array
  private readonly tapW: Float64Array
  private readonly taps: number
  readonly species: LeniaSpecies

  constructor(N: number, species: LeniaSpecies) {
    if ((N & (N - 1)) !== 0 || N < KERNEL_DIAMETER) throw new Error(`CpuLenia: N = ${N} must be a power of two ≥ ${KERNEL_DIAMETER}`)
    this.N = N
    this.species = species
    this.A = new Float32Array(N * N)
    this.B = new Float32Array(N * N)
    this.U = new Float64Array(N * N)
    const k = buildKernel(species)
    const dx: number[] = []
    const dy: number[] = []
    const w: number[] = []
    for (let row = 0; row < KERNEL_DIAMETER; row++) {
      for (let col = 0; col < KERNEL_DIAMETER; col++) {
        const v = k[row * KERNEL_DIAMETER + col]
        if (v === 0) continue
        dx.push(col - KERNEL_RADIUS)
        dy.push(row - KERNEL_RADIUS)
        w.push(v)
      }
    }
    this.tapDx = Int32Array.from(dx)
    this.tapDy = Int32Array.from(dy)
    this.tapW = Float64Array.from(w)
    this.taps = w.length
  }

  /** U = K ∗ A (periodic), into this.U. */
  potential(): Float64Array {
    const { N, A, U } = this
    const mask = N - 1
    U.fill(0)
    for (let t = 0; t < this.taps; t++) {
      const dx = this.tapDx[t]
      const dy = this.tapDy[t]
      const w = this.tapW[t]
      for (let y = 0; y < N; y++) {
        const src = ((y + dy) & mask) * N
        const dst = y * N
        for (let x = 0; x < N; x++) U[dst + x] += w * A[src + ((x + dx) & mask)]
      }
    }
    return U
  }

  step(): void {
    const { m, s, T } = this.species
    const dt = 1 / T
    const U = this.potential()
    const A = this.A
    const B = this.B
    for (let i = 0; i < A.length; i++) {
      const v = A[i] + dt * growth(U[i], m, s)
      B[i] = v < 0 ? 0 : v > 1 ? 1 : v
    }
    this.B = A
    this.A = B
  }

  mass(): number {
    let sum = 0
    for (let i = 0; i < this.A.length; i++) sum += this.A[i]
    return sum
  }

  /** Mass-weighted circular mean position (x, y) in cells; meaningful for one compact creature. */
  centroid(out: [number, number]): [number, number] {
    const { N, A } = this
    let cx = 0
    let sx = 0
    let cy = 0
    let sy = 0
    const k = (2 * Math.PI) / N
    for (let y = 0; y < N; y++) {
      const cyy = Math.cos(k * y)
      const syy = Math.sin(k * y)
      for (let x = 0; x < N; x++) {
        const v = A[y * N + x]
        if (v === 0) continue
        cx += v * Math.cos(k * x)
        sx += v * Math.sin(k * x)
        cy += v * cyy
        sy += v * syy
      }
    }
    out[0] = ((Math.atan2(sx, cx) / k) % N + N) % N
    out[1] = ((Math.atan2(sy, cy) / k) % N + N) % N
    return out
  }
}
