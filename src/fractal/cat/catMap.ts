/**
 * Arnold's cat map on an N x N pixel grid, the integer arithmetic behind the GPU stage.
 *
 *   forward  (x, y) -> (2x + y,  x + y)  mod N        matrix M    = [[2, 1], [1, 1]]
 *   inverse  (x, y) -> ( x - y, -x + 2y) mod N        matrix M^-1 = [[1, -1], [-1, 2]]
 *
 * Coordinates are texel coordinates with the origin at the bottom-left of the picture and
 * y pointing up (texture space, the usual mathematical orientation). det M = 1, so the map
 * is a permutation of the N^2 pixels: every pixel lands on exactly one pixel, and repeating
 * it must eventually bring the picture back. The step pass works backwards (each destination
 * pixel reads the one source pixel that lands on it), so it is a pure gather with no
 * collisions or holes.
 *
 * The recurrence period is the order of M in GL(2, Z/N): the smallest k > 0 with
 * M^k = I (mod N). Because the map is linear, M^k fixes every pixel exactly when it fixes
 * (1, 0) and (0, 1), so this is also the period of the pixel permutation. M is the square
 * of the Fibonacci matrix [[1, 1], [1, 0]], hence period = pisano(N) / gcd(pisano(N), 2).
 */

/** Largest N for which the matrix products below stay exact in doubles (N^2 < 2^53 / 2). */
const MAX_N = 1 << 26

/** Positive remainder: mod(-1, 5) = 4. Exact for integers. */
export function mod(a: number, n: number): number {
  const r = a % n
  return r < 0 ? r + n : r
}

/**
 * Recurrence period of the cat map on an N x N grid: the smallest k > 0 with M^k = I (mod N).
 * Exact; at most 3N iterations of a 2 x 2 matrix product (Dyson and Falk: period <= 3N).
 */
export function catPeriod(N: number): number {
  if (!Number.isInteger(N) || N < 1 || N > MAX_N) {
    throw new Error(`catPeriod: N must be an integer between 1 and ${MAX_N}, got ${N}.`)
  }
  if (N === 1) return 1
  // P = M^k mod N, starting at k = 1
  let a = 2 % N
  let b = 1 % N
  let c = 1 % N
  let d = 1 % N
  for (let k = 1; k <= 3 * N; k++) {
    if (a === 1 && b === 0 && c === 0 && d === 1) return k
    // P <- P * M,  M = [[2, 1], [1, 1]]
    const na = (2 * a + b) % N
    const nb = (a + b) % N
    const nc = (2 * c + d) % N
    const nd = (c + d) % N
    a = na
    b = nb
    c = nc
    d = nd
  }
  throw new Error(`catPeriod: no return within 3N steps for N = ${N}; this cannot happen for an invertible map.`)
}

/** M^k mod N as [a, b, c, d] = [[a, b], [c, d]]. For analysis scripts, not the frame loop. */
export function catMatrixPower(k: number, N: number): [number, number, number, number] {
  let a = 1 % N
  let b = 0
  let c = 0
  let d = 1 % N
  for (let i = 0; i < k; i++) {
    const na = (2 * a + b) % N
    const nb = (a + b) % N
    const nc = (2 * c + d) % N
    const nd = (c + d) % N
    a = na
    b = nb
    c = nc
    d = nd
  }
  return [a, b, c, d]
}

/** Index (y * N + x) of the pixel that the forward map sends (x, y) to. */
export function catForwardIndex(x: number, y: number, N: number): number {
  return mod(x + y, N) * N + mod(2 * x + y, N)
}

/**
 * Index (y * N + x) of the source pixel that lands on destination (x, y): the gather the
 * step shader performs, dest(x, y) <- src((x - y) mod N, (-x + 2y) mod N).
 */
export function catSourceIndex(x: number, y: number, N: number): number {
  return mod(2 * y - x, N) * N + mod(x - y, N)
}

/** The grid size the stage uses. 256 returns after 192 steps (12 x 16). */
export const CAT_N = 256

/** Steps until the picture on the CAT_N grid comes back bit-identical. */
export const CAT_PERIOD = catPeriod(CAT_N)
