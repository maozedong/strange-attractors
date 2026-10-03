import type { AttractorSystem } from '../types'

/**
 * Thomas (1999). b = 0.185, inside the chaotic band b ∈ [0.180, 0.188] (measured). The often
 * quoted b ≈ 0.208186 is the onset of chaos: there the largest Lyapunov exponent is only ≈ 0.007
 * and the orbit settles on one of two mirror-image copies, so it is a slider position, not the default.
 */
export const thomas: AttractorSystem = {
  id: 'thomas',
  name: 'Thomas',
  year: 1999,
  credit: 'René Thomas',
  tagline: 'One rule on every axis: a cyclically symmetric maze.',
  blurb:
    'René Thomas proposed it in 1999 while thinking about feedback loops in gene networks. Each coordinate is pushed by the sine of the next and slowed by a friction b. Lower the friction and the path roams an ever larger lattice of still points; at zero friction it wanders that lattice forever, which Sprott named labyrinth chaos.',
  params: [{ key: 'b', label: 'b', default: 0.185, min: 0.12, max: 0.33, step: 0.0001 }],
  dt: 0.05,
  rate: 8,
  glsl: 'd = vec3(sin(v.y) - P[0] * v.x, sin(v.z) - P[0] * v.y, sin(v.x) - P[0] * v.z);',
  f(out, x, y, z, P) {
    out[0] = Math.sin(y) - P[0] * x
    out[1] = Math.sin(z) - P[0] * y
    out[2] = Math.sin(x) - P[0] * z
  },
  frame: () => ({ center: [0, 0, 0], scale: 0.2291 }),
  seed: () => [-1.93, 0.1491, -3.5037],
  bound: () => 22,
  speedNorm: () => 1.5,
}
