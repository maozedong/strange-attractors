import type { AttractorSystem } from '../types'

/** Lorenz-84. a = 0.25, b = 4, F = 8, G = 1. Equilibria have no closed form, so none are listed. */
export const lorenz84: AttractorSystem = {
  id: 'lorenz84',
  name: 'Lorenz-84',
  year: 1984,
  credit: 'Edward Lorenz',
  tagline: 'The jet stream and its eddies, in three numbers.',
  blurb:
    "Lorenz again, in 1984, with the smallest model he could make of the whole atmosphere's circulation: x is the strength of the westerly wind, y and z are a chain of big eddies carrying heat toward the pole, F and G are how hard the sun drives it. Even this behaves irregularly, which was his point.",
  params: [
    { key: 'a', label: 'a', default: 0.25, min: 0.15, max: 0.5, step: 0.001 },
    { key: 'b', label: 'b', default: 4, min: 2, max: 8, step: 0.01 },
    { key: 'F', label: 'F', default: 8, min: 5, max: 12, step: 0.01 },
    { key: 'G', label: 'G', default: 1, min: 0, max: 1.3, step: 0.01 },
  ],
  dt: 0.01,
  rate: 3,
  glsl:
    'd = vec3(-P[0] * v.x - v.y * v.y - v.z * v.z + P[0] * P[2], -v.y + v.x * v.y - P[1] * v.x * v.z + P[3], -v.z + P[1] * v.x * v.y + v.x * v.z);',
  f(out, x, y, z, P) {
    out[0] = -P[0] * x - y * y - z * z + P[0] * P[2]
    out[1] = -y + x * y - P[1] * x * z + P[3]
    out[2] = -z + P[1] * x * y + x * z
  },
  frame: () => ({ center: [0.9, 0.11, 0.028], scale: 0.4363 }),
  seed: () => [1.7728, 0.4635, 0.477],
  bound: () => 11,
  speedNorm: () => 11,
}
