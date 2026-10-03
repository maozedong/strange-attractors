import type { AttractorSystem, Vec3 } from '../types'

/** Dadras (2009). a = 3, b = 2.7, c = 1.7, d = 2, e = 9. */
export const dadras: AttractorSystem = {
  id: 'dadras',
  name: 'Dadras',
  year: 2009,
  credit: 'Sara Dadras & Hamid Reza Momeni',
  tagline: 'One family of equations, two to four scrolls.',
  blurb:
    'Sara Dadras and Hamid Reza Momeni published this in 2009 as a single system that grows two, three or four scrolls depending on how you set the dials. At these settings it winds around four still points, and its speed varies wildly from one part of the shape to another.',
  params: [
    { key: 'a', label: 'a', default: 3, min: 1.5, max: 4.5, step: 0.01 },
    { key: 'b', label: 'b', default: 2.7, min: 1.5, max: 3.5, step: 0.01 },
    { key: 'c', label: 'c', default: 1.7, min: 1.2, max: 2.3, step: 0.01 },
    { key: 'd', label: 'd', default: 2, min: 1, max: 3, step: 0.01 },
    { key: 'e', label: 'e', default: 9, min: 6, max: 12, step: 0.01 },
  ],
  dt: 0.005,
  rate: 2,
  glsl: 'd = vec3(v.y - P[0] * v.x + P[1] * v.y * v.z, P[2] * v.y - v.x * v.z + v.z, P[3] * v.x * v.y - P[4] * v.z);',
  f(out, x, y, z, P) {
    out[0] = y - P[0] * x + P[1] * y * z
    out[1] = P[2] * y - x * z + z
    out[2] = P[3] * x * y - P[4] * z
  },
  frame: () => ({ center: [0.542, -2.075, -0.664], scale: 0.03898 }),
  seed: () => [0.7793, 2.6493, 0.3016],
  bound: () => 93,
  speedNorm: () => 44,
  fixedPoints(P) {
    const [a, b, c, d, e] = P
    const pts: Vec3[] = [[0, 0, 0]]
    // y ≠ 0: z = d·x·y/e and d·x² − d·x − c·e = 0; then (b·d·x/e)·y² + y − a·x = 0
    if (d === 0 || e === 0) return pts
    const disc = d * d + 4 * d * c * e
    if (disc < 0) return pts
    for (const x of [(d - Math.sqrt(disc)) / (2 * d), (d + Math.sqrt(disc)) / (2 * d)]) {
      const k = (b * d * x) / e
      let ys: number[]
      if (Math.abs(k) < 1e-12) ys = [a * x]
      else {
        const D = 1 + 4 * k * a * x
        if (D < 0) continue
        const q = -0.5 * (1 + Math.sqrt(D))
        ys = [q / k, (-a * x) / q]
      }
      for (const y of ys) if (y !== 0) pts.push([x, y, (d * x * y) / e])
    }
    return pts
  },
}
