import type { AttractorSystem, Vec3 } from '../types'

/**
 * Four-wing (Wang, Sun, van Wyk, Qi & van Wyk, 2009). a = 0.2, b = 0.01, c = -0.4. The paper uses
 * b = −0.01; b = +0.01 is its exact mirror image under (x, y, z) → (x, −y, −z).
 */
export const fourwing: AttractorSystem = {
  id: 'fourwing',
  name: 'Four-wing',
  year: 2009,
  credit: 'Zenghui Wang, Yanxia Sun, Barend van Wyk, Guoyuan Qi & Michael van Wyk',
  tagline: "Four wings instead of a butterfly's two.",
  blurb:
    'Zenghui Wang and colleagues published it in 2009. Where Lorenz has two wings, the path here spreads itself over four. They proved the tiny cross term b is the whole trick: set it to zero and the fourth wing never appears.',
  params: [
    { key: 'a', label: 'a', default: 0.2, min: 0.1, max: 0.3, step: 0.001 },
    { key: 'b', label: 'b', default: 0.01, min: 0.005, max: 0.1, step: 0.0005 },
    { key: 'c', label: 'c', default: -0.4, min: -0.7, max: -0.2, step: 0.001 },
  ],
  dt: 0.02,
  rate: 4,
  glsl: 'd = vec3(P[0] * v.x + v.y * v.z, P[1] * v.x + P[2] * v.y - v.x * v.z, -v.z - v.x * v.y);',
  f(out, x, y, z, P) {
    out[0] = P[0] * x + y * z
    out[1] = P[1] * x + P[2] * y - x * z
    out[2] = -z - x * y
  },
  // Nearly symmetric (exactly so at b = 0), and its rare outward excursions keep growing with sample
  // size: over 8M steps the bbox centre wanders by ±0.3 and the farthest point reaches ≈ 5.6. So the
  // centre is the symmetry centre and the scale keeps a radius of 5.7 inside the view.
  frame: () => ({ center: [0, 0, 0], scale: 0.21 }),
  seed: () => [0.6602, -0.0562, 0.0361],
  bound: () => 17,
  speedNorm: () => 1.3,
  fixedPoints(P) {
    const [a, b, c] = P
    const pts: Vec3[] = [[0, 0, 0]]
    // x ≠ 0: y² = a, z = −x·y, and y·x² + b·x + c·y = 0
    const disc = b * b - 4 * a * c
    if (a <= 0 || disc < 0) return pts
    for (const y of [Math.sqrt(a), -Math.sqrt(a)])
      for (const s of [Math.sqrt(disc), -Math.sqrt(disc)]) {
        const x = (-b + s) / (2 * y)
        pts.push([x, y, -x * y])
      }
    return pts
  },
}
