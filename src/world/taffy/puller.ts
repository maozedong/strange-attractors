/**
 * The taffy puller's mathematics, shared by the GPU step (shaders.ts mirrors `rodField`,
 * `guardTerm` and `velocity` line for line) and the CPU checks in verify.ts. No three.js here.
 *
 * Rods and braid
 *   Three rods of radius ROD_RADIUS sit on the slots of a triangle with circumradius ARM_RADIUS:
 *   slot 0 lower left, slot 1 at the top, slot 2 lower right. Seen along y (projected on the x
 *   axis) the slots are ordered 0, 1, 2, so a swap of slots 0 and 1 is σ1^±1 and a swap of slots
 *   1 and 2 is σ2^±1 (clockwise = positive here). A pull is two half-turns, each easing in and out
 *   (smoothstep in angle) so rods start and stop without a jolt:
 *     σ1 σ2⁻¹   slots 0 and 1 swap clockwise about their midpoint, then 1 and 2 counter-clockwise
 *     σ1⁻¹ σ2   the same swaps with both turns reversed
 *   PULL_PROTOCOL 'repeat' runs σ1 σ2⁻¹ every pull (Boyland, Aref & Stremler 2000): pseudo-Anosov,
 *   dilatation (3 + √5) / 2, topological entropy 0.962 per pull. On this triangle both of its
 *   moving rods come down through the middle, so every pull carries the same mean drift (down the
 *   middle, out between the lower rods, up the sides). In an open fluid that drift extrudes a
 *   drip of taffy below the blob within two pulls and lets a dark ring of empty fluid in around
 *   the mixed core. 'alternating' (the default) alternates σ1 σ2⁻¹ with σ1⁻¹ σ2, whose drift is
 *   the reverse, so it cancels pull to pull and the blob stays a blob. Its braid σ1 σ2⁻¹ σ1⁻¹ σ2
 *   is also pseudo-Anosov (SL(2,Z) trace 3: dilatation (3 + √5) / 2 per two pulls, entropy 0.481
 *   per pull). The flow itself stretches faster than either bound (verify.ts measures it); the
 *   braid is the floor no stirring of this kind can go below. verify.ts recovers both words from
 *   the kinematics. (Cycling the roles round the triangle instead would be periodic: zero
 *   entropy.)
 *
 * Fluid (a visual model, not Navier–Stokes, but exactly incompressible)
 *   Everything is derived from a stream function ψ, u = (∂ψ/∂y, −∂ψ/∂x), so the flow preserves
 *   area exactly and the 262,144 points never clump or thin out. Per rod k (centre p, velocity v,
 *   spin w, offset r = x − p, d = |r|):
 *     drag   ψ = g(d) (v_x r_y − v_y r_x),  g = 1 inside the rod, exp(−((d − a) / DRAG_WIDTH)²)
 *            outside: the fluid moves with the rod at its surface and the drag falls to 1/e at
 *            a + DRAG_WIDTH = 0.25 from the centre. Being a stream function, it also carries the
 *            return flow an incompressible fluid needs around a moving body.
 *     swirl  solid-body spin w inside the rod, |u| = w a³ / d² outside (a Rankine-like swirl
 *            whose surface speed matches the rod's own spin).
 *   Inside a rod that sum is the rod's rigid motion. A rod would still be leaky to the other
 *   rods' flow (a static rod has no field of its own at all), so each rod also gets a guard
 *   zone: within GUARD_WIDTH of its surface the other rods' stream function Φ is blended to a
 *   constant, ψ += (m(d) − 1)(Φ − Φ(p)), m = smoothstep(a, a + GUARD_WIDTH, d). The rod's surface
 *   is then a streamline moving with the rod (no penetration, no slip), so the rods are real
 *   obstacles and the braid is enforced on the fluid. A guard never reaches another rod's
 *   surface (closest approach of two rod centres is 0.317, and a + GUARD_WIDTH = 0.22 <
 *   0.317 − a), which is what keeps the construction exact.
 *
 * Units: domain half-width 1; time in pulls, so velocities are domain units per pull.
 */

export const ROD_RADIUS = 0.07
/** circumradius of the rod triangle */
export const ARM_RADIUS = 0.5
export const BLOB_RADIUS = 0.8
export const BOUNDARY_RADIUS = 1.2
/** a point with |x| or |y| beyond this respawns */
export const RESPAWN_BOUND = 1.4
/** drag falls to 1/e this far outside the rod surface (0.25 from the centre) */
export const DRAG_WIDTH = 0.18
/** no-penetration blend zone outside each rod surface */
export const GUARD_WIDTH = 0.15
/**
 * Midpoint substeps per pull; even, so no substep straddles the switch between half-turns.
 * 96 rather than 48: with MIDPOINT_ITERATIONS = 4 the one-pull map keeps area to |det J − 1|
 * ≈ 1e-5 (median; 1e-3 at the 99th percentile), where 48 explicit RK2 steps drift 2 % (median,
 * 16 % at the 99th percentile) and the taffy would slowly clump. verify.ts measures it.
 */
export const SUBSTEPS_PER_PULL = 96
export type PullProtocol = 'alternating' | 'repeat'
/** see the header: 'alternating' keeps the blob together; 'repeat' is plain σ1 σ2⁻¹ */
export const PULL_PROTOCOL: PullProtocol = 'alternating'
/** ln((3 + √5) / 2): topological entropy of σ1 σ2⁻¹ */
const LN_PHI2 = Math.log((3 + Math.sqrt(5)) / 2)
/** topological entropy per pull of each protocol's braid */
export const BRAID_ENTROPY: Record<PullProtocol, number> = { repeat: LN_PHI2, alternating: LN_PHI2 / 2 }

const COS30 = Math.sqrt(3) / 2
/** slot centres: lower left, top, lower right */
export const SLOT_X = [-ARM_RADIUS * COS30, 0, ARM_RADIUS * COS30] as const
export const SLOT_Y = [-ARM_RADIUS / 2, ARM_RADIUS, -ARM_RADIUS / 2] as const

/** per-rod record in a packed rod frame: x, y, vx, vy, spin, C (others' ψ at this centre) */
export const ROD_STRIDE = 6
export const ROD_FRAME = 3 * ROD_STRIDE

function ease(u: number): number {
  return u * u * (3 - 2 * u)
}
function easeSlope(u: number): number {
  return 6 * u * (1 - u)
}

/**
 * Rod kinematics at pull time `tau`: writes x, y, vx, vy, spin of the three rods into `out`
 * (ROD_STRIDE apart; C is left alone). Order: the two rods swapping in this half (from the
 * lower-numbered slot first), then the one at rest. Rods are identical, so the order only has
 * to be consistent within one time.
 */
export function rodKinematics(tau: number, out: Float64Array, protocol: PullProtocol = PULL_PROTOCOL): void {
  const f = tau - Math.floor(tau)
  const second = f >= 0.5
  const u = second ? 2 * f - 1 : 2 * f
  const a = second ? 1 : 0
  const b = second ? 2 : 1
  const rest = second ? 0 : 2
  // σ1 σ2⁻¹: clockwise (negative) in the first half, counter-clockwise in the second;
  // σ1⁻¹ σ2 (odd pulls when alternating) the other way round
  const reversed = protocol === 'alternating' && (Math.floor(tau) & 1) === 1
  const dir = second === reversed ? -1 : 1
  const theta = dir * Math.PI * ease(u)
  // dθ/dτ, with du/dτ = 2
  const omega = dir * Math.PI * easeSlope(u) * 2
  const mx = 0.5 * (SLOT_X[a] + SLOT_X[b])
  const my = 0.5 * (SLOT_Y[a] + SLOT_Y[b])
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  for (let k = 0; k < 2; k++) {
    const slot = k === 0 ? a : b
    const rx = SLOT_X[slot] - mx
    const ry = SLOT_Y[slot] - my
    const qx = c * rx - s * ry
    const qy = s * rx + c * ry
    const o = k * ROD_STRIDE
    out[o] = mx + qx
    out[o + 1] = my + qy
    out[o + 2] = -omega * qy
    out[o + 3] = omega * qx
    out[o + 4] = omega
  }
  const o = 2 * ROD_STRIDE
  out[o] = SLOT_X[rest]
  out[o + 1] = SLOT_Y[rest]
  out[o + 2] = 0
  out[o + 3] = 0
  out[o + 4] = 0
}

// one rod's own field, written here by rodField (module scratch: no allocation per call)
let fPsi = 0
let fUx = 0
let fUy = 0

/** Stream function and velocity of one rod's drag and swirl at offset (rx, ry) from its centre. */
function rodField(rx: number, ry: number, vx: number, vy: number, w: number): void {
  const a = ROD_RADIUS
  const d2 = rx * rx + ry * ry
  const d = Math.sqrt(d2)
  const outside = d > a
  // drag: ψ = g s, s = v × r
  const s = vx * ry - vy * rx
  const e = outside ? (d - a) / DRAG_WIDTH : 0
  const g = Math.exp(-e * e)
  // g'(d) / d, so that ∇g = gpd · r
  const gpd = outside ? ((-2 * e) / DRAG_WIDTH) * (g / d) : 0
  let ux = gpd * ry * s + g * vx
  let uy = -gpd * rx * s + g * vy
  let psi = g * s
  // swirl: u = w h(d) / d · (−r_y, r_x), h = d inside, a³ / d² outside
  const hod = outside ? (a * a * a) / (d2 * d) : 1
  ux -= w * hod * ry
  uy += w * hod * rx
  psi += outside ? w * ((a * a * a) / d - 1.5 * a * a) : -0.5 * w * d2
  fPsi = psi
  fUx = ux
  fUy = uy
}

/** Stream function of one rod alone at (x, y). */
function rodPsi(rods: Float64Array, k: number, x: number, y: number): number {
  const o = k * ROD_STRIDE
  rodField(x - rods[o], y - rods[o + 1], rods[o + 2], rods[o + 3], rods[o + 4])
  return fPsi
}

/**
 * Rod frame at pull time `tau`: kinematics plus, per rod k, C_k = Σ_{i≠k} ψ_i(p_k), the value
 * the guard zone pins the other rods' stream function to. `out` needs ROD_FRAME entries.
 */
export function rodFrame(tau: number, out: Float64Array, protocol: PullProtocol = PULL_PROTOCOL): Float64Array {
  rodKinematics(tau, out, protocol)
  for (let k = 0; k < 3; k++) {
    const o = k * ROD_STRIDE
    let c = 0
    for (let i = 0; i < 3; i++) if (i !== k) c += rodPsi(out, i, out[o], out[o + 1])
    out[o + 5] = c
  }
  return out
}

let gUx = 0
let gUy = 0
/**
 * Guard-zone correction for one rod: (m − 1) · (velocity of the others) + (Φ − C) · ∇⊥m,
 * the velocity of ψ = (m − 1)(Φ − C). Zero outside the zone.
 */
function guardTerm(rx: number, ry: number, oux: number, ouy: number, psiRel: number): void {
  const d = Math.sqrt(rx * rx + ry * ry)
  const t = Math.min(Math.max((d - ROD_RADIUS) / GUARD_WIDTH, 0), 1)
  const m = t * t * (3 - 2 * t)
  // m'(d) / d
  const mpd = d > 0 ? (6 * t * (1 - t)) / (GUARD_WIDTH * d) : 0
  gUx = (m - 1) * oux + psiRel * mpd * ry
  gUy = (m - 1) * ouy - psiRel * mpd * rx
}

/** Fluid velocity at (x, y) for a rod frame; writes [ux, uy] into `out`. */
export function velocity(x: number, y: number, rods: Float64Array, out: Float64Array): void {
  // own fields of the three rods
  rodField(x - rods[0], y - rods[1], rods[2], rods[3], rods[4])
  const p0 = fPsi, u0x = fUx, u0y = fUy
  rodField(x - rods[6], y - rods[7], rods[8], rods[9], rods[10])
  const p1 = fPsi, u1x = fUx, u1y = fUy
  rodField(x - rods[12], y - rods[13], rods[14], rods[15], rods[16])
  const p2 = fPsi, u2x = fUx, u2y = fUy
  let ux = u0x + u1x + u2x
  let uy = u0y + u1y + u2y
  guardTerm(x - rods[0], y - rods[1], u1x + u2x, u1y + u2y, p1 + p2 - rods[5])
  ux += gUx
  uy += gUy
  guardTerm(x - rods[6], y - rods[7], u0x + u2x, u0y + u2y, p0 + p2 - rods[11])
  ux += gUx
  uy += gUy
  guardTerm(x - rods[12], y - rods[13], u0x + u1x, u0y + u1y, p0 + p1 - rods[17])
  ux += gUx
  uy += gUy
  out[0] = ux
  out[1] = uy
}

/** Stream function at (x, y) for a rod frame (for checks: u must equal ∇⊥ψ). */
export function streamFunction(x: number, y: number, rods: Float64Array): number {
  const p0 = rodPsi(rods, 0, x, y)
  const p1 = rodPsi(rods, 1, x, y)
  const p2 = rodPsi(rods, 2, x, y)
  let psi = p0 + p1 + p2
  for (let k = 0; k < 3; k++) {
    const o = k * ROD_STRIDE
    const rx = x - rods[o]
    const ry = y - rods[o + 1]
    const d = Math.sqrt(rx * rx + ry * ry)
    const t = Math.min(Math.max((d - ROD_RADIUS) / GUARD_WIDTH, 0), 1)
    const m = t * t * (3 - 2 * t)
    const others = k === 0 ? p1 + p2 : k === 1 ? p0 + p2 : p0 + p1
    psi += (m - 1) * (others - rods[o + 5])
  }
  return psi
}

/**
 * Field evaluations at the midpoint time per substep. 1 is the explicit RK2 midpoint method;
 * each further one is a fixed-point iteration towards the implicit midpoint rule, which is
 * symplectic: for a stream-function flow it preserves area exactly, so the points keep their
 * density however long the taffy is pulled (verify.ts measures det J).
 */
export const MIDPOINT_ITERATIONS = 4

const k1 = new Float64Array(2)
const k2 = new Float64Array(2)
/**
 * One midpoint substep of length `dt` pulls, as the GPU runs it: the RK2 predictor with the
 * velocity at the start (`rods0`), then `iterations` evaluations at the midpoint (`rodsMid`),
 * x_mid ← x + dt/2 · u(x_mid). Then a point that ended up inside a rod of `rodsEnd` (only
 * integration error can put it there) is put back on that rod's surface. Writes [x, y] into
 * `out`; returns true if the point had to be pushed out of a rod.
 */
export function midpointStep(
  x: number,
  y: number,
  dt: number,
  rods0: Float64Array,
  rodsMid: Float64Array,
  rodsEnd: Float64Array,
  out: Float64Array,
  iterations = MIDPOINT_ITERATIONS,
): boolean {
  velocity(x, y, rods0, k1)
  let mx = x + 0.5 * dt * k1[0]
  let my = y + 0.5 * dt * k1[1]
  for (let i = 0; i < iterations; i++) {
    velocity(mx, my, rodsMid, k2)
    mx = x + 0.5 * dt * k2[0]
    my = y + 0.5 * dt * k2[1]
  }
  let nx = 2 * mx - x
  let ny = 2 * my - y
  let pushed = false
  for (let k = 0; k < 3; k++) {
    const o = k * ROD_STRIDE
    const rx = nx - rodsEnd[o]
    const ry = ny - rodsEnd[o + 1]
    const d = Math.sqrt(rx * rx + ry * ry)
    if (d < ROD_RADIUS) {
      const sc = d > 1e-9 ? ROD_RADIUS / d : 0
      nx = rodsEnd[o] + (d > 1e-9 ? rx * sc : ROD_RADIUS)
      ny = rodsEnd[o + 1] + ry * sc
      pushed = true
    }
  }
  out[0] = nx
  out[1] = ny
  return pushed
}

/** true if (x, y) is inside (or on) one of the rods at their slots (the state at a pull boundary) */
export function insideRestingRod(x: number, y: number, margin = 0): boolean {
  const r = ROD_RADIUS + margin
  for (let i = 0; i < 3; i++) {
    const dx = x - SLOT_X[i]
    const dy = y - SLOT_Y[i]
    if (dx * dx + dy * dy <= r * r) return true
  }
  return false
}

/** Seed of the fresh-taffy PRNG: every reset lays the same taffy. */
const TAFFY_SEED = 0x7aff1e5

/** the fresh-taffy grid is turned by atan(1/φ) (31.7°), far from any low-order pixel direction */
const GRID_TURN = Math.atan(0.6180339887498949)

/**
 * Fresh taffy: `count` points filling the blob (disc of BLOB_RADIUS minus the resting rods) as
 * a fully jittered grid (one uniform point per cell, then a fixed random `count` of the cells
 * kept), turned by GRID_TURN.
 *   Jittered rather than random, so the fresh blob is smooth instead of speckled.
 *   Fully jittered rather than a low-discrepancy lattice, which the flow would shear into
 *   visible hatching.
 *   Turned, because a cell is about one pixel at the stage's framing: an axis-aligned grid's
 *   cell-periodic grain beats against the pixel grid into a coarse checker, while a grid at
 *   31.7° can only alias to fine grain at any practical scale.
 * Colour id 0 (warm) for x < 0, 1 (cool) otherwise. Writes vec4(x, y, colour, 0) per point into
 * `out` (count * 4 floats).
 */
export function freshTaffy(count: number, out: Float32Array): void {
  const rand = mulberry32(TAFFY_SEED)
  const area = Math.PI * BLOB_RADIUS * BLOB_RADIUS - 3 * Math.PI * ROD_RADIUS * ROD_RADIUS
  const c = Math.cos(GRID_TURN)
  const sn = Math.sin(GRID_TURN)
  let h = Math.sqrt(area / count) * 0.997
  for (;;) {
    // a turned square of half-side BLOB_RADIUS still covers the disc
    const cells = Math.ceil((2 * BLOB_RADIUS) / h)
    const xs = new Float64Array(cells * cells)
    const ys = new Float64Array(cells * cells)
    let n = 0
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        const u = -BLOB_RADIUS + (gx + rand()) * h
        const v = -BLOB_RADIUS + (gy + rand()) * h
        const x = c * u - sn * v
        const y = sn * u + c * v
        if (x * x + y * y > BLOB_RADIUS * BLOB_RADIUS || insideRestingRod(x, y)) continue
        xs[n] = x
        ys[n] = y
        n++
      }
    }
    if (n < count) {
      h *= 0.995
      continue
    }
    // partial Fisher–Yates: a fixed random `count` of the n cells
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rand() * (n - i))
      const tx = xs[i]
      xs[i] = xs[j]
      xs[j] = tx
      const ty = ys[i]
      ys[i] = ys[j]
      ys[j] = ty
      const o = i * 4
      out[o] = xs[i]
      out[o + 1] = ys[i]
      out[o + 2] = xs[i] < 0 ? 0 : 1
      out[o + 3] = 0
    }
    return
  }
}

/** Small, fast, seedable PRNG (Tommy Ettinger's mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
