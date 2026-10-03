import type { AttractorSystem } from '../types'

/** Arnéodo–Coullet–Tresser, cubic form. a = -5.5, b = 3.5, d = -1. */
export const arneodo: AttractorSystem = {
  id: 'arneodo',
  name: 'Arnéodo',
  year: 1981,
  credit: 'Alain Arnéodo, Pierre Coullet & Charles Tresser',
  tagline: 'One third-order equation, spiralling in and out.',
  blurb:
    'Alain Arnéodo, Pierre Coullet and Charles Tresser showed in 1981 how a path that leaves a still point, loops round and spirals back into it can carry chaos with it. These three equations are a single third-order equation in disguise; the cubic version came in 1985, with Edward Spiegel.',
  params: [
    { key: 'a', label: 'a', default: -5.5, min: -5.6, max: -3.5, step: 0.01 },
    { key: 'b', label: 'b', default: 3.5, min: 3.4, max: 5, step: 0.01 },
    { key: 'd', label: 'd', default: -1, min: -1.6, max: -0.6, step: 0.01 },
  ],
  dt: 0.01,
  rate: 2,
  glsl: 'd = vec3(v.y, v.z, -P[0] * v.x - P[1] * v.y - v.z + P[2] * v.x * v.x * v.x);',
  f(out, x, y, z, P) {
    out[0] = y
    out[1] = z
    out[2] = -P[0] * x - P[1] * y - z + P[2] * x * x * x
  },
  frame: () => ({ center: [0, 0, 0], scale: 0.08355 }),
  seed: () => [2.6613, 0.9774, -6.5477],
  bound: () => 41,
  speedNorm: () => 19,
  fixedPoints(P) {
    const [a, , d] = P
    // y = z = 0 and x·(d·x² − a) = 0
    if (d === 0 || a / d <= 0) return [[0, 0, 0]]
    const r = Math.sqrt(a / d)
    return [
      [0, 0, 0],
      [r, 0, 0],
      [-r, 0, 0],
    ]
  },
}
