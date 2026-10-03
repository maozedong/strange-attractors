import type { AttractorSystem, Vec3 } from '../types'

/** Chua's circuit (1983), dimensionless double scroll. α = 15.6, β = 28, m0 = -8/7, m1 = -5/7. */
export const chua: AttractorSystem = {
  id: 'chua',
  name: 'Chua’s circuit',
  year: 1983,
  credit: 'Leon Chua',
  tagline: 'Chaos you can solder: the double scroll.',
  blurb:
    'Leon Chua built this in 1983 from two capacitors, an inductor, a resistor and one home-made nonlinear part, the simplest circuit that can behave chaotically. It was the first chaos confirmed three ways at once: on a computer, on a bench, and in a proof. The path winds around one of two still points and switches between them without warning.',
  params: [
    { key: 'alpha', label: 'α', default: 15.6, min: 10, max: 17.5, step: 0.01 },
    { key: 'beta', label: 'β', default: 28, min: 24, max: 40, step: 0.01 },
    { key: 'm0', label: 'm₀', default: -8 / 7, min: -1.25, max: -1.05, step: 0.001 },
    { key: 'm1', label: 'm₁', default: -5 / 7, min: -0.85, max: -0.5, step: 0.001 },
  ],
  dt: 0.0075,
  rate: 3,
  // h(x) = m1·x + ½(m0 − m1)(|x + 1| − |x − 1|), inlined so the GLSL stays a single expression
  glsl:
    'd = vec3(P[0] * (v.y - v.x - (P[3] * v.x + 0.5 * (P[2] - P[3]) * (abs(v.x + 1.0) - abs(v.x - 1.0)))), v.x - v.y + v.z, -P[1] * v.y);',
  f(out, x, y, z, P) {
    const h = P[3] * x + 0.5 * (P[2] - P[3]) * (Math.abs(x + 1) - Math.abs(x - 1))
    out[0] = P[0] * (y - x - h)
    out[1] = x - y + z
    out[2] = -P[1] * y
  },
  frame: () => ({ center: [0, 0, 0], scale: 0.2619 }),
  seed: () => [1.5245, -0.1288, -2.3741],
  bound: () => 13,
  speedNorm: () => 9.6,
  fixedPoints(P) {
    const [, , m0, m1] = P
    const pts: Vec3[] = [[0, 0, 0]]
    // outer segments |x| ≥ 1: y = 0, z = −x and −x − m1·x ∓ (m0 − m1) = 0
    if (1 + m1 !== 0) {
      const x = (m1 - m0) / (1 + m1)
      if (x >= 1) pts.push([x, 0, -x], [-x, 0, x])
    }
    return pts
  },
}
