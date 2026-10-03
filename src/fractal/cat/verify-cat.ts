/**
 * Checks the cat-map arithmetic:  pnpm tsx src/fractal/cat/verify-cat.ts
 *
 * 1. catPeriod matches known values (256 -> 192, 512 -> 384, 101 -> 25) and, for every N up
 *    to 128 plus a few larger ones, the order of the pixel permutation itself (lcm of its
 *    cycle lengths), computed independently by walking the cycles.
 * 2. catSourceIndex is the exact inverse of the forward map (x, y) -> (2x + y, x + y).
 * 3. The step shader's float arithmetic (gatherFrag), emulated in float32 with both true
 *    division and the reciprocal a GPU may use, picks the same source texel as the integer
 *    reference for every texel, at CAT_N and some awkward sizes.
 * 4. Simulating the gather on byte arrays (N = 32 and CAT_N) returns the picture bit-identical
 *    first at exactly catPeriod(N) steps, and again at twice that.
 * 5. Prints a table of periods for candidate sizes and, for CAT_N, the steps where the
 *    picture partly comes back (many pixels at home, or M^k = -I: upside down).
 *
 * Exits non-zero if any check fails. Nothing here is bundled into the app.
 */
import { CAT_N, CAT_PERIOD, catForwardIndex, catMatrixPower, catPeriod, catSourceIndex, mod } from './catMap'

let failures = 0
function check(ok: boolean, what: string): void {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`)
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/** Order of the gather permutation on N x N, by walking every cycle. */
function permutationOrder(N: number): number {
  const seen = new Uint8Array(N * N)
  let order = 1
  for (let start = 0; start < N * N; start++) {
    if (seen[start]) continue
    let len = 0
    let i = start
    while (!seen[i]) {
      seen[i] = 1
      len++
      i = catSourceIndex(i % N, Math.floor(i / N), N)
    }
    order = (order / gcd(order, len)) * len
  }
  return order
}

/** gatherFrag's source texel for destination (x, y), in float32. */
function shaderSource(x: number, y: number, N: number, reciprocal: boolean): number {
  const f = Math.fround
  const n = f(N)
  const inv = f(1 / n)
  const div = (a: number) => (reciprocal ? f(a * inv) : f(a / n))
  // vec2 p = floor(gl_FragCoord.xy), gl_FragCoord = texel centre
  const px = Math.floor(f(x + 0.5))
  const py = Math.floor(f(y + 0.5))
  // vec2 q = vec2(p.x - p.y, 2.0 * p.y - p.x); q -= uN * floor((q + 0.5) / uN);
  let qx = f(px - py)
  let qy = f(f(2 * py) - px)
  qx = f(qx - f(n * Math.floor(div(f(qx + 0.5)))))
  qy = f(qy - f(n * Math.floor(div(f(qy + 0.5)))))
  // texture2D(uSrc, (q + 0.5) / uN), NearestFilter: texel = floor(uv * size)
  const tx = Math.floor(f(div(f(qx + 0.5)) * n))
  const ty = Math.floor(f(div(f(qy + 0.5)) * n))
  if (tx < 0 || tx >= N || ty < 0 || ty >= N) return -1
  return ty * N + tx
}

/** Run the gather on random bytes; returns the steps at which the array equals the original. */
function simulate(N: number, steps: number): number[] {
  const size = N * N
  const src = new Int32Array(size)
  for (let i = 0; i < size; i++) src[i] = i
  const from = new Int32Array(size)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) from[y * N + x] = catSourceIndex(x, y, N)
  const original = new Uint8Array(size * 4)
  let seed = 0x9e3779b9
  for (let i = 0; i < original.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    original[i] = seed >>> 24
  }
  let a = original.slice()
  let b = new Uint8Array(size * 4)
  const hits: number[] = []
  for (let s = 1; s <= steps; s++) {
    for (let i = 0; i < size; i++) {
      const j = from[i] * 4
      const k = i * 4
      b[k] = a[j]
      b[k + 1] = a[j + 1]
      b[k + 2] = a[j + 2]
      b[k + 3] = a[j + 3]
    }
    ;[a, b] = [b, a]
    let same = true
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== original[i]) {
        same = false
        break
      }
    }
    if (same) hits.push(s)
  }
  return hits
}

console.log('1. periods')
check(catPeriod(256) === 192, `catPeriod(256) = ${catPeriod(256)} (expect 192)`)
check(catPeriod(512) === 384, `catPeriod(512) = ${catPeriod(512)} (expect 384)`)
check(catPeriod(101) === 25, `catPeriod(101) = ${catPeriod(101)} (expect 25)`)
check(CAT_N === 256 && CAT_PERIOD === 192, `CAT_N = ${CAT_N}, CAT_PERIOD = ${CAT_PERIOD}`)
const crossSizes = [...Array.from({ length: 128 }, (_, i) => i + 1), 101, 250, 255, 256]
const mismatched = crossSizes.filter((N) => catPeriod(N) !== permutationOrder(N))
check(mismatched.length === 0, `catPeriod(N) = permutation order for N = 1..128, 250, 255, 256${mismatched.length ? ` (differs at ${mismatched.join(', ')})` : ''}`)

console.log('\n2. inverse')
for (const N of [CAT_N, 101, 32]) {
  let ok = true
  const hit = new Uint8Array(N * N)
  for (let y = 0; y < N && ok; y++) {
    for (let x = 0; x < N; x++) {
      const s = catSourceIndex(x, y, N)
      if (catForwardIndex(s % N, Math.floor(s / N), N) !== y * N + x || hit[s]) {
        ok = false
        break
      }
      hit[s] = 1
    }
  }
  check(ok, `N = ${N}: forward(source(x, y)) = (x, y) for every pixel, and source() is a bijection`)
}
check(catSourceIndex(0, 1, 7) === mod(2, 7) * 7 + mod(-1, 7), 'negative coordinates wrap to positive: (0, 1) <- (6, 2) on N = 7')

console.log('\n3. shader arithmetic in float32')
for (const N of [CAT_N, 512, 101, 250, 255, 1000]) {
  let bad = 0
  for (const reciprocal of [false, true]) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) if (shaderSource(x, y, N, reciprocal) !== catSourceIndex(x, y, N)) bad++
    }
  }
  check(bad === 0, `N = ${N}: gatherFrag picks the reference texel for all ${N * N} texels (true division and reciprocal)${bad ? `; ${bad} wrong` : ''}`)
}

console.log('\n4. simulated permutation')
for (const N of [32, CAT_N]) {
  const P = catPeriod(N)
  const hits = simulate(N, 2 * P)
  check(
    hits.length === 2 && hits[0] === P && hits[1] === 2 * P,
    `N = ${N}: random bytes come back bit-identical at steps [${hits.join(', ')}] within ${2 * P} (expect [${P}, ${2 * P}])`,
  )
}

console.log('\n5. periods for candidate sizes')
console.log('     N  period  period/N  M^(P/2) = -I')
for (const N of [64, 100, 101, 125, 128, 192, 200, 240, 250, 255, 256, 300, 320, 384, 400, 480, 500, 512, 1000, 1024]) {
  const P = catPeriod(N)
  let half = '-'
  if (P % 2 === 0) {
    const [a, b, c, d] = catMatrixPower(P / 2, N)
    half = a === N - 1 && d === N - 1 && b === 0 && c === 0 ? 'yes' : 'no'
  }
  console.log(`${String(N).padStart(6)}  ${String(P).padStart(6)}  ${(P / N).toFixed(3).padStart(8)}  ${half}`)
}

console.log(`\n   partial returns on the ${CAT_N} x ${CAT_N} grid (pixels exactly at home after k steps)`)
const notable: string[] = []
for (let k = 1; k < CAT_PERIOD; k++) {
  const [a, b, c, d] = catMatrixPower(k, CAT_N)
  let home = 0
  for (let y = 0; y < CAT_N; y++) {
    for (let x = 0; x < CAT_N; x++) {
      if (mod(a * x + b * y, CAT_N) === x && mod(c * x + d * y, CAT_N) === y) home++
    }
  }
  const minusI = a === CAT_N - 1 && d === CAT_N - 1 && b === 0 && c === 0
  if (home >= (CAT_N * CAT_N) / 64 || minusI) {
    notable.push(
      `   k = ${String(k).padStart(3)}: M^k = [[${a}, ${b}], [${c}, ${d}]]  ${((100 * home) / (CAT_N * CAT_N)).toFixed(2)}% at home${minusI ? '  (= -I: the picture, rotated 180 degrees)' : ''}`,
    )
  }
}
console.log(notable.length ? notable.join('\n') : '   none above 1/64 of the pixels')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
