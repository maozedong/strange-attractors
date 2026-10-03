import type { AttractorSystem } from '../types'

/** Sprott case B (1994). a = 1 (the constant term in dz; the paper's system has a = 1). */
export const sprottB: AttractorSystem = {
  id: 'sprottB',
  name: 'Sprott B',
  year: 1994,
  credit: 'Julien Clinton Sprott',
  tagline: 'Five terms, found by a computer searching for chaos.',
  blurb:
    'In 1994 Julien Clinton Sprott had a computer try thousands of the simplest possible equation sets and keep the ones that went chaotic. Nineteen survived, labelled A to S. Case B has five terms, two of them products, and a half-turn symmetry about the vertical axis.',
  params: [{ key: 'a', label: 'a', default: 1, min: 0.4, max: 1.5, step: 0.001 }],
  dt: 0.01,
  rate: 2,
  glsl: 'd = vec3(v.y * v.z, v.x - v.y, P[0] - v.x * v.y);',
  f(out, x, y, z, P) {
    out[0] = y * z
    out[1] = x - y
    out[2] = P[0] - x * y
  },
  frame: () => ({ center: [0, 0, -0.287], scale: 0.1625 }),
  seed: () => [-1.5216, -1.0685, 0.5726],
  bound: () => 26,
  speedNorm: () => 4.9,
  fixedPoints(P) {
    if (P[0] <= 0) return []
    const r = Math.sqrt(P[0])
    return [
      [r, r, 0],
      [-r, -r, 0],
    ]
  },
}
