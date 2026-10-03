/**
 * The Mandelbulb distance estimator on the CPU, a line-for-line twin of `bulbDE` in
 * shaders.ts (same names, same order of operations). verify.ts checks it; the component uses
 * it to know how far the camera is from the surface.
 *
 * White & Nylander's spherical power map, for a point z = (x, y, z) with r = |z|:
 *   θ = atan2(√(x² + y²), z)  (polar angle from the +z pole, = acos(z / r))
 *   φ = atan2(y, x)
 *   zⁿ = rⁿ · (sin nθ cos nφ, sin nθ sin nφ, cos nθ)
 * iterated as z ← zⁿ + c from z = c. The distance estimate is ½ · ln r · r / dr with the running
 * derivative dr ← n · rⁿ⁻¹ · dr + 1. A non-integer n is allowed (the narration morphs it); it
 * cuts the shape along the half-plane φ = ±π, where nφ jumps.
 *
 * Fractal space has the pole on +z; the component turns it so the pole points up (+y), see
 * toFractal().
 */

/** escape radius |z| */
export const BAILOUT = 4
/** iteration budget; points that have not escaped by then count as inside */
export const MAX_ITER = 12

export interface BulbSample {
  /** distance estimate (≤ 0 or ~0 inside, > 0 outside), in fractal units */
  de: number
  /** orbit trap: the smallest |z| along the orbit (|c| included) */
  trap: number
  /** iterations done before escape (MAX_ITER if it never escaped) */
  iterations: number
}

/**
 * The same estimator in GLSL (the shaders include this verbatim). Read it against bulbDE()
 * below: same variables, same order of operations. uPower is the only uniform.
 */
export const bulbDEGlsl = /* glsl */ `
#define MAX_ITER ${MAX_ITER}
#define BAILOUT ${BAILOUT.toFixed(1)}
uniform float uPower;

// x: distance estimate (<= 0 or ~0 inside), y: orbit trap, the smallest |z| on the orbit
vec2 bulbDE(vec3 c) {
  vec3 z = c;
  float dr = 1.0;
  float r = 0.0;
  float trap = 1e10;
  for (int i = 0; i < MAX_ITER; i++) {
    r = length(z);
    trap = min(trap, r);
    if (r > BAILOUT) break;
    float theta = atan(length(z.xy), z.z);
    float phi = atan(z.y, z.x);
    float rp = pow(r, uPower - 1.0);
    dr = rp * uPower * dr + 1.0;
    float zr = rp * r;
    float st = sin(theta * uPower);
    z = vec3(zr * st * cos(phi * uPower), zr * st * sin(phi * uPower), zr * cos(theta * uPower)) + c;
  }
  // r = 0 only at c = 0, whose orbit never leaves 0: deep inside
  return vec2(r > 0.0 ? 0.5 * log(r) * r / dr : -1.0, trap);
}
`

/**
 * Distance estimate at the fractal-space point c. `round` emulates float32 when given
 * Math.fround (verify.ts uses that to find where GPU precision breaks); default is doubles.
 */
export function bulbDE(
  cx: number,
  cy: number,
  cz: number,
  power: number,
  out?: BulbSample,
  round: (v: number) => number = identity,
): number {
  const f = round
  let zx = cx
  let zy = cy
  let zz = cz
  let dr = 1
  let r = 0
  let trap = 1e10
  let i = 0
  for (; i < MAX_ITER; i++) {
    r = f(Math.sqrt(f(f(f(zx * zx) + f(zy * zy)) + f(zz * zz))))
    trap = Math.min(trap, r)
    if (r > BAILOUT) break
    const theta = f(Math.atan2(f(Math.sqrt(f(f(zx * zx) + f(zy * zy)))), zz))
    const phi = f(Math.atan2(zy, zx))
    const rp = f(Math.pow(r, f(power - 1)))
    dr = f(f(f(rp * power) * dr) + 1)
    const zr = f(rp * r)
    const st = f(Math.sin(f(theta * power)))
    zx = f(f(f(zr * st) * f(Math.cos(f(phi * power)))) + cx)
    zy = f(f(f(zr * st) * f(Math.sin(f(phi * power)))) + cy)
    zz = f(f(zr * f(Math.cos(f(theta * power)))) + cz)
  }
  // r = 0 only at c = 0 itself (the orbit of 0 stays at 0): deep inside
  const de = r > 0 ? f(f(f(0.5 * f(Math.log(r))) * r) / dr) : -1
  if (out) {
    out.de = de
    out.trap = trap
    out.iterations = i
  }
  return de
}

function identity(v: number): number {
  return v
}

/**
 * World radius of the sphere around the classic power-8 bulb in a default <Mandelbulb />
 * (its surface reaches 1.10; below n ≈ 4 the shape reaches past this, see bulbBound()). The
 * component draws the fractal at radius / BULB_RADIUS times its natural size, so by default one
 * fractal unit is one world unit.
 */
export const BULB_RADIUS = 1.25

/**
 * Fractal space (pole on +z) from the component's frame (pole up on +y): fractal (x, −z, y).
 * The mesh is turned by −90° about x, which is the inverse of this.
 */
export function toFractal(x: number, y: number, z: number, out: [number, number, number]): [number, number, number] {
  out[0] = x
  out[1] = -z
  out[2] = y
  return out
}

const scratch: [number, number, number] = [0, 0, 0]

/**
 * Distance from a point to the bulb's surface, in the frame the component is placed in (world
 * units for a <Mandelbulb radius={radius} /> at the origin). A lower bound (verify.ts checks
 * it against marched distances; it reads short by up to ~2x close in); ≤ 0 inside. Use it to keep
 * the camera out of the solid on a dive: see the dive limits in index.ts.
 */
export function bulbDistance(x: number, y: number, z: number, power = 8, radius = BULB_RADIUS): number {
  const k = radius / BULB_RADIUS
  const q = toFractal(x / k, y / k, z / k, scratch)
  const r = Math.hypot(q[0], q[1], q[2])
  // past the escape radius the orbit stops at once and ½ r ln r overshoots the true distance
  // (11.5 for 8.9 at r = 10); the distance to the bounding sphere is a safe lower bound there.
  // The shaders never sample out there: their rays start inside the bound.
  if (r > BAILOUT) return (r - bulbBound(power)) * k
  return bulbDE(q[0], q[1], q[2], power) * k
}

/**
 * Largest surface radius of the 12-iteration set, by power (fractal units), measured by
 * marching thousands of directions plus a local refinement around the farthest hit, taking the
 * larger of two independent measurements. Low powers reach much farther than the classic n = 8
 * (1.10): the n = 2 bulb contains the Mandelbrot set's antenna and reaches radius 2. verify.ts
 * re-measures this at every 0.1 in power and checks bulbBound() stays above it.
 */
const EXTENT: ReadonlyArray<readonly [power: number, radius: number]> = [
  [2, 2.0000],
  [2.1, 1.8720],
  [2.2, 1.7735],
  [2.25, 1.7020],
  [2.3, 1.6777],
  [2.4, 1.6074],
  [2.5, 1.5348],
  [2.6, 1.4506],
  [2.7, 1.4554],
  [2.75, 1.4088],
  [2.8, 1.3865],
  [2.9, 1.3904],
  [3, 1.3705],
  [3.1, 1.3510],
  [3.2, 1.3442],
  [3.3, 1.3262],
  [3.4, 1.3253],
  [3.5, 1.3143],
  [3.6, 1.3026],
  [3.7, 1.2906],
  [3.8, 1.2632],
  [3.9, 1.2604],
  [4, 1.2526],
  [4.5, 1.2125],
  [5, 1.1817],
  [6, 1.1479],
  [7, 1.1195],
  [8, 1.1038],
  [9, 1.0891],
  [10, 1.0800],
  [12, 1.0650],
  [16, 1.0472],
]

/** relative and absolute slack on top of the measured extent */
const BOUND_MARGIN = 1.04
const BOUND_PAD = 0.01

/** Radius of a sphere (fractal units) that contains the whole set for this power. */
export function bulbBound(power: number): number {
  return lookup(EXTENT, power) * BOUND_MARGIN + BOUND_PAD
}

/** The largest bulbBound() over the powers in EXTENT (the bound of the n = 2 bulb). */
export const MAX_BOUND = EXTENT[0][1] * BOUND_MARGIN + BOUND_PAD

/**
 * The orbit trap's spread over the visible surface, by power: its 5th and 98th percentiles,
 * measured from six views. The shader maps the trap through this range so the colouring keeps
 * the same balance (mostly blue and violet, warm on the outermost buds) through the morph.
 */
const TRAP_LO: ReadonlyArray<readonly [number, number]> = [
  [2, 0.314],
  [2.5, 0.379],
  [3, 0.448],
  [3.5, 0.496],
  [4, 0.557],
  [5, 0.621],
  [6, 0.666],
  [7, 0.705],
  [8, 0.729],
  [10, 0.773],
  [12, 0.809],
  [16, 0.857],
]
const TRAP_HI: ReadonlyArray<readonly [number, number]> = [
  [2, 1.024],
  [2.5, 1.045],
  [3, 1.136],
  [3.5, 1.181],
  [4, 1.158],
  [5, 1.119],
  [6, 1.12],
  [7, 1.095],
  [8, 1.089],
  [10, 1.071],
  [12, 1.06],
  [16, 1.046],
]

/** [low, high] of the orbit trap for this power (see TRAP_LO / TRAP_HI). */
export function trapRange(power: number, out: [number, number]): [number, number] {
  out[0] = lookup(TRAP_LO, power)
  out[1] = lookup(TRAP_HI, power)
  return out
}

/** piecewise-linear in power, held constant outside the table */
function lookup(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (!(x > table[0][0])) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]
    if (x <= x1) {
      const [x0, y0] = table[i - 1]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return table[table.length - 1][1]
}
