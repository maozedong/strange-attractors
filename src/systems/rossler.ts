import type { AttractorSystem, Vec3 } from '../types'

/** Rössler (1976). a = 0.2, b = 0.2, c = 5.7. */
export const rossler: AttractorSystem = {
  id: 'rossler',
  name: 'Rössler',
  year: 1976,
  credit: 'Otto Rössler',
  tagline: 'A spiral band that lifts, folds, and drops.',
  blurb:
    'Otto Rössler built it in 1976 to be the simplest thing that could still be chaotic: one nonlinear term, inspired by watching a taffy-pulling machine. Paths spiral outward on a flat disc until one equation lifts them, folds them over and drops them back near the middle. Turn up c and you can watch order double, and double again, into chaos.',
  params: [
    { key: 'a', label: 'a', default: 0.2, min: 0.05, max: 0.22, step: 0.001 },
    { key: 'b', label: 'b', default: 0.2, min: 0.12, max: 1, step: 0.001 },
    { key: 'c', label: 'c', default: 5.7, min: 2, max: 6.5, step: 0.01 },
  ],
  dt: 0.01,
  rate: 3,
  glsl: 'd = vec3(-v.y - v.z, v.x + P[0] * v.y, P[1] + v.z * (v.x - P[2]));',
  f(out, x, y, z, P) {
    out[0] = -y - z
    out[1] = x + P[0] * y
    out[2] = P[1] + z * (x - P[2])
  },
  frame: () => ({ center: [1.164, -1.475, 11.431], scale: 0.07643 }),
  seed: () => [-6.0281, -2.2101, 0.0169],
  bound: () => 54,
  speedNorm: () => 21,
  fixedPoints(P) {
    const [a, b, c] = P
    // y = −z, x = a·z, with a·z² − c·z + b = 0 (stable quadratic form)
    if (Math.abs(a) < 1e-12) return Math.abs(c) < 1e-12 ? [] : [[0, -b / c, b / c]]
    const disc = c * c - 4 * a * b
    if (disc < 0) return []
    const q = 0.5 * (c + (c < 0 ? -1 : 1) * Math.sqrt(disc))
    if (q === 0) return [[0, 0, 0]]
    return [b / q, q / a].map((z): Vec3 => [a * z, -z, z])
  },
}
