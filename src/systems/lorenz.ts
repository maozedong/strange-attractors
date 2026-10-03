import type { AttractorSystem } from '../types'

/**
 * Half-size of the view for a given ρ: 0.5 × largest bbox extent (y) × 1.05. Fitted to
 * measurements at σ = 10, β = 8/3 (scripts/measure.ts): the y extent grows like ρ^0.88.
 */
const half = (rho: number) => Math.max(12, 27.1 * Math.pow(Math.max(rho, 0) / 28, 0.88))

/**
 * Lorenz (1963). σ = 10, ρ = 28, β = 8/3. Reference entry: every other system follows
 * this shape. Frame/seed/bound depend on ρ because the attractor grows with it.
 */
export const lorenz: AttractorSystem = {
  id: 'lorenz',
  name: 'Lorenz',
  year: 1963,
  credit: 'Edward Lorenz',
  tagline: 'Warm air rising. The original butterfly.',
  blurb:
    'Three equations for a layer of fluid heated from below, boiled down from a weather model. Lorenz found that two runs started a hair apart went their own ways, and that the paths traced this shape forever without repeating.',
  params: [
    { key: 'sigma', label: 'σ', default: 10, min: 0, max: 30, step: 0.1 },
    { key: 'rho', label: 'ρ', default: 28, min: 0, max: 170, step: 0.01 },
    { key: 'beta', label: 'β', default: 8 / 3, min: 0, max: 8, step: 0.01 },
  ],
  dt: 0.005,
  rate: 2,
  glsl: 'd = vec3(P[0] * (v.y - v.x), v.x * (P[1] - v.z) - v.y, v.x * v.y - P[2] * v.z);',
  f(out, x, y, z, P) {
    out[0] = P[0] * (y - x)
    out[1] = x * (P[1] - z) - y
    out[2] = x * y - P[2] * z
  },
  frame(P) {
    const rho = P[1]
    // bbox centre sits at z ≈ ρ − 3.2 (24.8 at ρ=28, 47.0 at 50, 166 at 170)
    return { center: [0, 0, Math.max(rho - 3.2, 1)], scale: 1 / half(rho) }
  },
  seed(P) {
    const rho = P[1]
    // a point on the attractor for the canonical parameters; for other ρ it is close enough to fall on quickly
    if (Math.abs(rho - 28) < 1e-6) return [5.2644, 8.9105, 14.331]
    return [1, 1, Math.max(rho - 1, 1)]
  },
  bound(P) {
    return 6 * half(P[1])
  },
  speedNorm(P) {
    // measured p95 of |v|: 174 at ρ=24, 214 at 28, 436 at 50, 728 at 75, 2700 at 170 (≈ ρ^1.3)
    return 210 * Math.pow(Math.max(P[1], 5) / 28, 1.3)
  },
  fixedPoints(P) {
    const [, rho, beta] = P
    if (rho <= 1) return [[0, 0, 0]]
    const r = Math.sqrt(beta * (rho - 1))
    return [
      [0, 0, 0],
      [r, r, rho - 1],
      [-r, -r, rho - 1],
    ]
  },
}
