import type { AttractorSystem } from '../types'

/**
 * Halvorsen. a = 1.27 (Sprott's value, largest Lyapunov exponent ≈ 0.79). The a = 1.89 seen in
 * some galleries is a symmetric limit cycle, not a strange attractor (measured λ1 ≈ 0).
 */
export const halvorsen: AttractorSystem = {
  id: 'halvorsen',
  name: 'Halvorsen',
  year: 1997,
  credit: 'Arne Dehli Halvorsen',
  tagline: 'Three identical lobes around one diagonal.',
  blurb:
    'Arne Dehli Halvorsen posted this system to a 1990s newsgroup and J. C. Sprott wrote it up in 1997. Swap the roles of x, y and z and the equations are unchanged, so the attractor has three identical lobes arranged around the line where all three are equal.',
  params: [{ key: 'a', label: 'a', default: 1.27, min: 1.25, max: 2.4, step: 0.001 }],
  dt: 0.005,
  rate: 1.5,
  glsl:
    'd = vec3(-P[0] * v.x - 4.0 * v.y - 4.0 * v.z - v.y * v.y, -P[0] * v.y - 4.0 * v.z - 4.0 * v.x - v.z * v.z, -P[0] * v.z - 4.0 * v.x - 4.0 * v.y - v.x * v.x);',
  f(out, x, y, z, P) {
    out[0] = -P[0] * x - 4 * y - 4 * z - y * y
    out[1] = -P[0] * y - 4 * z - 4 * x - z * z
    out[2] = -P[0] * z - 4 * x - 4 * y - x * x
  },
  frame: () => ({ center: [-3.54, -3.54, -3.54], scale: 0.09291 }),
  seed: () => [1.5367, -4.8632, -6.8266],
  bound: () => 51,
  speedNorm: () => 84,
  fixedPoints(P) {
    // on the diagonal x = y = z = s: −s·(a + 8 + s) = 0
    const s = -(P[0] + 8)
    return [
      [0, 0, 0],
      [s, s, s],
    ]
  },
}
