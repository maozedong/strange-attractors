import type { AttractorSystem } from '../types'

/** Burke–Shaw (1981). s = 10, v = 4.272. */
export const burkeShaw: AttractorSystem = {
  id: 'burkeShaw',
  name: 'Burke–Shaw',
  year: 1981,
  credit: 'Bill Burke & Robert Shaw',
  tagline: 'A Lorenz cousin from the Santa Cruz chaos collective.',
  blurb:
    'Bill Burke and Robert Shaw found it around 1981 at Santa Cruz, where Shaw was treating chaotic systems as machines that manufacture information. Flip x and y together and nothing changes, so the two halves are mirror images chasing each other.',
  params: [
    { key: 's', label: 's', default: 10, min: 9, max: 14, step: 0.01 },
    { key: 'v', label: 'v', default: 4.272, min: 2.5, max: 4.3, step: 0.001 },
  ],
  dt: 0.003,
  rate: 1,
  glsl: 'd = vec3(-P[0] * (v.x + v.y), -v.y - P[0] * v.x * v.z, P[0] * v.x * v.y + P[1]);',
  f(out, x, y, z, P) {
    out[0] = -P[0] * (x + y)
    out[1] = -y - P[0] * x * z
    out[2] = P[0] * x * y + P[1]
  },
  frame: () => ({ center: [0, 0, -0.009], scale: 0.3785 }),
  seed: () => [0.4759, -0.7153, 1.016],
  bound: () => 12,
  speedNorm: () => 23,
  fixedPoints(P) {
    const [s, v] = P
    // y = −x, x² = v/s, z = 1/s
    if (s === 0 || v / s <= 0) return []
    const r = Math.sqrt(v / s)
    return [
      [r, -r, 1 / s],
      [-r, r, 1 / s],
    ]
  },
}
