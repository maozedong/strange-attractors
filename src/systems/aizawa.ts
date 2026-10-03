import type { AttractorSystem, Vec3 } from '../types'

/** Real roots of t³ + p·t + q = 0. */
function depressedCubicRoots(p: number, q: number): number[] {
  if (Math.abs(p) < 1e-14) return [Math.cbrt(-q)]
  const disc = (q * q) / 4 + (p * p * p) / 27
  if (disc > 0) {
    const s = Math.sqrt(disc)
    return [Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s)]
  }
  const m = 2 * Math.sqrt(-p / 3)
  const th = Math.acos(Math.max(-1, Math.min(1, (3 * q) / (p * m)))) / 3
  return [0, 1, 2].map((k) => m * Math.cos(th - (2 * Math.PI * k) / 3))
}

/**
 * "Aizawa" (Langford, 1984). a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1. The popular
 * name is a misattribution; the system comes from W. F. Langford's work on torus bifurcations.
 */
export const aizawa: AttractorSystem = {
  id: 'aizawa',
  name: 'Aizawa',
  year: 1984,
  credit: 'William F. Langford',
  tagline: 'A sphere with a tube drilled through its axis.',
  blurb:
    "Paths climb a narrow tube up the middle, spill out over the top and fall back down the outside of a sphere-like shell, then do it again. Everyone calls it the Aizawa attractor; it actually comes from William Langford's 1984 study of what happens when a doughnut-shaped orbit breaks apart.",
  params: [
    { key: 'a', label: 'a', default: 0.95, min: 0.6, max: 1, step: 0.001 },
    { key: 'b', label: 'b', default: 0.7, min: 0.55, max: 0.95, step: 0.001 },
    { key: 'c', label: 'c', default: 0.6, min: 0.45, max: 0.9, step: 0.001 },
    { key: 'd', label: 'd', default: 3.5, min: 2, max: 5, step: 0.01 },
    { key: 'e', label: 'e', default: 0.25, min: 0.08, max: 0.5, step: 0.001 },
    { key: 'f', label: 'f', default: 0.1, min: 0, max: 0.3, step: 0.001 },
  ],
  dt: 0.01,
  rate: 2,
  glsl:
    'd = vec3((v.z - P[1]) * v.x - P[3] * v.y, P[3] * v.x + (v.z - P[1]) * v.y, P[2] + P[0] * v.z - v.z * v.z * v.z / 3.0 - (v.x * v.x + v.y * v.y) * (1.0 + P[4] * v.z) + P[5] * v.z * v.x * v.x * v.x);',
  f(out, x, y, z, P) {
    out[0] = (z - P[1]) * x - P[3] * y
    out[1] = P[3] * x + (z - P[1]) * y
    out[2] = P[2] + P[0] * z - (z * z * z) / 3 - (x * x + y * y) * (1 + P[4] * z) + P[5] * z * x * x * x
  },
  frame: () => ({ center: [-0.006, 0.037, 0.741], scale: 0.6374 }),
  seed: () => [0.4023, -0.3773, -0.2256],
  bound: () => 7.2,
  speedNorm: () => 5.2,
  fixedPoints(P) {
    const [a, , c] = P
    // for d ≠ 0 the x, y equations force x = y = 0; then z³ − 3a·z − 3c = 0
    return depressedCubicRoots(-3 * a, -3 * c).map((z): Vec3 => [0, 0, z])
  },
}
