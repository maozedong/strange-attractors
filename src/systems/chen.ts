import type { AttractorSystem } from '../types'

/** Chen (1999). a = 35, b = 3, c = 28. */
export const chen: AttractorSystem = {
  id: 'chen',
  name: 'Chen',
  year: 1999,
  credit: 'Guanrong Chen & Tetsushi Ueta',
  tagline: "Lorenz's dual, found by trying to make chaos on purpose.",
  blurb:
    "In 1999 Guanrong Chen and Tetsushi Ueta added one feedback term to Lorenz's equations to push a system into chaos deliberately, and got this. It keeps the two wings and the mirror symmetry, but it is not the same shape bent about; mathematicians call it Lorenz's dual.",
  params: [
    { key: 'a', label: 'a', default: 35, min: 31, max: 45, step: 0.01 },
    { key: 'b', label: 'b', default: 3, min: 1, max: 4.5, step: 0.01 },
    { key: 'c', label: 'c', default: 28, min: 20, max: 32, step: 0.01 },
  ],
  dt: 0.0025,
  rate: 1,
  glsl: 'd = vec3(P[0] * (v.y - v.x), (P[2] - P[0]) * v.x - v.x * v.z + P[2] * v.y, v.x * v.y - P[1] * v.z);',
  f(out, x, y, z, P) {
    out[0] = P[0] * (y - x)
    out[1] = (P[2] - P[0]) * x - x * z + P[2] * y
    out[2] = x * y - P[1] * z
  },
  frame: () => ({ center: [0, 0, 28.029], scale: 0.03069 }),
  seed: () => [11.1749, 10.3597, 29.262],
  bound: () => 140,
  speedNorm: () => 400,
  fixedPoints(P) {
    const [a, b, c] = P
    const k = b * (2 * c - a)
    if (k <= 0) return [[0, 0, 0]]
    const r = Math.sqrt(k)
    return [
      [0, 0, 0],
      [r, r, 2 * c - a],
      [-r, -r, 2 * c - a],
    ]
  },
}
