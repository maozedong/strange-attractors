import type { FlockState } from '../../fractal/types'

/**
 * Craig Reynolds's boids ("Flocks, herds, and schools: a distributed behavioral model",
 * SIGGRAPH 1987; the model dates from 1986), without three, so it runs and is checked in Node.
 *
 * Every bird looks at its NEIGHBOURS nearest flockmates within PERCEPTION (a topological
 * neighbourhood, as real starlings use: Ballerini et al. 2008) and follows three rules:
 *   separation  steer away from flockmates closer than SEPARATION_DISTANCE
 *   alignment   steer toward their mean heading
 *   cohesion    steer toward them, if they are all to one side (the flock's edge)
 * Each rule asks for an acceleration, in the forms of Reynolds's paper: separation (collision
 * avoidance) pushes away from each close flockmate, harder the closer; alignment (velocity
 * matching) relaxes the velocity toward the mean heading at CRUISE_SPEED over ALIGN_TIME;
 * cohesion (flock centring) pulls toward the flockmates only birds whose flockmates are mostly
 * to one side, i.e. birds on the flock's surface, so it holds the flock together without
 * stirring its interior. Each request is at most MAX_STEER before
 * its weight. They are granted in priority order out of a budget of MAX_STEER (Reynolds's
 * "prioritized acceleration allocation"): separation first, then alignment, cohesion, and a
 * little per-bird wander noise last. So a bird about to collide spends everything on not
 * colliding.
 * Outside that budget come the world's forces: beyond BOUND_RADIUS a gentle steer back toward
 * the origin (a turn, so the flock wheels round at the edge of its sky instead of piling
 * against a wall), and the hawk's repulsion (HAWK_WEIGHT × a full steering request), because
 * panic is faster than manoeuvring.
 *
 * Neighbour search: a uniform grid rebuilt each frame by counting sort into flat Int32 arrays;
 * positions and headings are copied into cell order so the search reads memory contiguously.
 * Cells are PERCEPTION / 2 wide, so the 5 × 5 × 5 block round a bird holds everything within
 * PERCEPTION; it is scanned as 25 contiguous x-runs, nearest first, each trimmed to the cells
 * whose nearest point is closer than the 12th-nearest bird found so far. (Cells a full
 * PERCEPTION wide scan ~2× more birds; a third of it costs more in grid upkeep than it saves.) The search starts from last frame's
 * neighbours: the farthest of them, where it is now, bounds this frame's 12th-nearest
 * distance (at least 12 birds are that close), so only cells inside that bound are scanned and
 * the result is still the exact 12 nearest.
 *
 * Semi-implicit Euler at the frame rate (dt capped at MAX_DT; slower frames run in slow
 * motion), speeds clamped to [MIN_SPEED, MAX_SPEED]. Nothing is allocated after createFlock.
 */

export type FlockRules = FlockState['rules']

export const MAX_BOIDS = 20000
/** render units; the flock lives in a ball of about BOUND_RADIUS + 0.4 */
export const PERCEPTION = 0.35
export const NEIGHBOURS = 12
/** each bird searches for its neighbours every NEIGHBOUR_REFRESH frames, half the flock on
 *  alternate frames; in between it keeps the same flockmates, measured where they are now.
 *  (A bird moves ~0.015 a frame against ~0.065 between birds, so the 12 nearest rarely change
 *  in one frame; a starling reacts in ~80 ms anyway.) Isolated birds search every frame. */
export const NEIGHBOUR_REFRESH = 2
export const SEPARATION_DISTANCE = 0.09
export const SEPARATION_WEIGHT = 1.6
export const ALIGNMENT_WEIGHT = 0.9
export const COHESION_WEIGHT = 0.5
/** render units per second */
export const MAX_SPEED = 0.9
export const MIN_SPEED = 0.45
/** the speed alignment asks for; the hawk's victims flee at MAX_SPEED */
export const CRUISE_SPEED = 0.7
/** seconds: velocity matching closes the gap to the neighbours' heading at this rate */
export const ALIGN_TIME = 0.25
/** steering budget, render units per second² */
export const MAX_STEER = 2.2
export const MAX_DT = 1 / 30
/** beyond this radius birds are steered back toward the origin */
export const BOUND_RADIUS = 1.8
/** the wall's pull grows linearly over this depth beyond BOUND_RADIUS, then holds */
export const BOUND_DEPTH = 0.3
/** seconds: at full depth the velocity relaxes toward "inward at cruise speed" this fast */
export const BOUND_TIME = 0.35
/** cohesion acts on birds whose neighbours lie mostly to one side: on none while the mean of
 *  the unit vectors toward them is shorter than COHESION_EDGE_LOW, fully above ..._HIGH */
export const COHESION_EDGE_LOW = 0.2
export const COHESION_EDGE_HIGH = 0.45
/** a reset scatters the birds uniformly through a ball this big */
export const SPAWN_RADIUS = 1.4
/** wander noise: Ornstein–Uhlenbeck per bird, this correlation time and per-axis std dev (/s²) */
export const WANDER_TIME = 0.6
export const WANDER_ACCEL = 0.2

/** the hawk's figure-eight: half-width, period, and the tilt of its plane from horizontal */
export const HAWK_RADIUS = 1.4
export const HAWK_PERIOD = 14
export const HAWK_TILT = 0.45
/** birds closer than this flee */
export const HAWK_REACH = 0.5
export const HAWK_WEIGHT = 6
/** seconds for the hawk to fade in or out after `flock.hawk` changes */
export const HAWK_FADE = 0.6
/** when the hawk appears it starts at the far end of its path, (HAWK_RADIUS, 0, 0), and
 *  reaches the centre of the flock HAWK_PERIOD / 4 = 3.5 s later */
export const HAWK_ENTRY_TIME = HAWK_PERIOD / 4

/** two birds' centres closer than this would overlap: a collision, for the diagnostics */
export const COLLISION_DISTANCE = 0.03

// ---------------------------------------------------------------- grid

/** cells half the perception radius wide: ±2 cells on each axis hold everything within it */
const CELL = PERCEPTION / 2
const INV_CELL = 1 / CELL
/** the grid covers [−GRID_HALF, GRID_HALF]³; birds outside clamp into the edge cells, which
 *  keeps every pair within PERCEPTION at most two cells apart on each axis */
const GRID_HALF = 2.8
const INNER = Math.ceil((2 * GRID_HALF) / CELL)
/** two empty cells of padding on every side, so the whole 5 × 5 × 5 block always exists */
const PAD = 2
const NX = INNER + 2 * PAD
const NXY = NX * NX
const NCELL = NXY * NX

/**
 * The 25 (dy, dz) rows of the 5 × 5 × 5 block round a bird's cell. Cells along x are adjacent
 * in cell order, so each row is one contiguous run of birds, trimmed at both ends to the cells
 * that can still hold a nearer bird. Ordered by the least squared distance any point of the row
 * can be from the bird's own cell (then by Manhattan length): once that passes the current
 * 12th-nearest distance, no later row can hold a nearer bird. ROW_GY/GZ index the per-bird gap
 * table [x: −2..2, y: −2..2, z: −2..2].
 */
const NROW = 25
const ROW_D = new Int32Array(NROW)
const ROW_LOW = new Float64Array(NROW)
const ROW_GY = new Uint8Array(NROW)
const ROW_GZ = new Uint8Array(NROW)
{
  const rows: [number, number, number][] = []
  for (let z = -2; z <= 2; z++)
    for (let y = -2; y <= 2; y++) {
      const lo = (a: number) => Math.max(Math.abs(a) - 1, 0) * CELL
      rows.push([y, z, lo(y) ** 2 + lo(z) ** 2])
    }
  rows.sort((a, b) => a[2] - b[2] || Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]))
  rows.forEach(([y, z, low], r) => {
    ROW_D[r] = NX * y + NXY * z
    ROW_LOW[r] = low * (1 - 1e-9)
    ROW_GY[r] = 5 + y + 2
    ROW_GZ[r] = 10 + z + 2
  })
}

// ---------------------------------------------------------------- state

export interface Flock {
  readonly capacity: number
  /** birds alive, 0..capacity */
  n: number
  /** xyz per bird, render units and render units per second */
  pos: Float32Array
  vel: Float32Array
  /** the acceleration applied in the last step (for banking) */
  acc: Float32Array
  wander: Float32Array
  /** simulated seconds since the last spawn */
  time: number
  /** frames stepped since the last spawn */
  frame: number
  /** bumps on every spawn, so views can drop per-bird smoothing */
  generation: number
  /** mean over birds with neighbours of û · (mean û of its neighbours), clamped to 0..1 */
  alignment: number
  /** diagnostics from the last step */
  meanNeighbours: number
  /** mean distance to the nearest flockmate */
  meanNearest: number
  /** fraction of birds whose nearest flockmate is closer than COLLISION_DISTANCE */
  collisions: number
  /** mean position of the birds after the last step */
  centroid: Float64Array
  /** the hawk: position, velocity, acceleration on its path; presence 0..1 fades it */
  hawk: Float64Array
  hawkTime: number
  hawkPresence: number
  seed: number
  // scratch
  readonly cellOf: Int32Array
  readonly cellStart: Int32Array
  readonly cellFill: Int32Array
  readonly order: Int32Array
  readonly sortedPos: Float32Array
  readonly sortedDir: Float32Array
  /** each bird's place in cell order this frame */
  readonly rank: Int32Array
  /** last frame's neighbours (bird indices), NEIGHBOURS per bird, and how many there were */
  readonly prevNear: Int32Array
  readonly prevCount: Uint8Array
  readonly nearD: Float64Array
  readonly nearI: Int32Array
  /** squared gaps from a bird to the cells two either side, per axis */
  readonly gap: Float64Array
}

export function createFlock(capacity = MAX_BOIDS, seed = 0x9e3779b9): Flock {
  return {
    capacity,
    n: 0,
    pos: new Float32Array(capacity * 3),
    vel: new Float32Array(capacity * 3),
    acc: new Float32Array(capacity * 3),
    wander: new Float32Array(capacity * 3),
    time: 0,
    frame: 0,
    generation: 0,
    alignment: 0,
    meanNeighbours: 0,
    meanNearest: 0,
    collisions: 0,
    centroid: new Float64Array(3),
    hawk: new Float64Array(9),
    hawkTime: HAWK_ENTRY_TIME,
    hawkPresence: 0,
    seed: seed | 0 || 1,
    cellOf: new Int32Array(capacity),
    cellStart: new Int32Array(NCELL + 1),
    cellFill: new Int32Array(NCELL),
    order: new Int32Array(capacity),
    sortedPos: new Float32Array(capacity * 3),
    sortedDir: new Float32Array(capacity * 3),
    rank: new Int32Array(capacity),
    prevNear: new Int32Array(capacity * NEIGHBOURS),
    prevCount: new Uint8Array(capacity),
    nearD: new Float64Array(NEIGHBOURS),
    nearI: new Int32Array(NEIGHBOURS),
    gap: new Float64Array(15),
  }
}

/** xorshift32 on the flock's seed: a float in [−1, 1) */
function rand(f: Flock): number {
  let s = f.seed
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  f.seed = s
  return s * 4.656612873077393e-10
}

/** `n` birds (clamped to the capacity) uniformly through a ball of SPAWN_RADIUS, flying in
 *  random directions at random speeds between MIN_SPEED and MAX_SPEED. */
export function spawnFlock(f: Flock, n: number) {
  f.n = Math.max(0, Math.min(f.capacity, Math.floor(Number.isFinite(n) ? n : 0)))
  const { pos, vel, acc, wander } = f
  for (let i = 0; i < f.n; i++) {
    let x = 0, y = 0, z = 0, r2 = 2
    while (r2 > 1) {
      x = rand(f)
      y = rand(f)
      z = rand(f)
      r2 = x * x + y * y + z * z
    }
    pos[i * 3] = x * SPAWN_RADIUS
    pos[i * 3 + 1] = y * SPAWN_RADIUS
    pos[i * 3 + 2] = z * SPAWN_RADIUS
    let dx = 0, dy = 0, dz = 0, d2 = 0
    while (d2 < 1e-4 || d2 > 1) {
      dx = rand(f)
      dy = rand(f)
      dz = rand(f)
      d2 = dx * dx + dy * dy + dz * dz
    }
    const s = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * (0.5 + 0.5 * rand(f))) / Math.sqrt(d2)
    vel[i * 3] = dx * s
    vel[i * 3 + 1] = dy * s
    vel[i * 3 + 2] = dz * s
    acc[i * 3] = acc[i * 3 + 1] = acc[i * 3 + 2] = 0
    wander[i * 3] = rand(f) * 1.7
    wander[i * 3 + 1] = rand(f) * 1.7
    wander[i * 3 + 2] = rand(f) * 1.7
  }
  f.prevCount.fill(0)
  f.time = 0
  f.frame = 0
  f.generation++
  f.alignment = 0
  f.meanNeighbours = 0
  f.meanNearest = 0
  f.collisions = 0
  f.centroid.fill(0)
}

/**
 * The hawk's path at time t: a figure-eight (1:2 Lissajous) through the origin, HAWK_RADIUS
 * along x and half that across, in a plane tilted HAWK_TILT from horizontal. Writes position,
 * velocity, acceleration into out[0..8].
 */
export function hawkAt(t: number, out: Float64Array | Float32Array | number[]) {
  const w = (2 * Math.PI) / HAWK_PERIOD
  const a = HAWK_RADIUS
  const s1 = Math.sin(w * t), c1 = Math.cos(w * t)
  const s2 = Math.sin(2 * w * t), c2 = Math.cos(2 * w * t)
  const ty = Math.sin(HAWK_TILT), tz = Math.cos(HAWK_TILT)
  const u = 0.5 * a * s2
  const du = a * w * c2
  const ddu = -2 * a * w * w * s2
  out[0] = a * s1
  out[1] = u * ty
  out[2] = u * tz
  out[3] = a * w * c1
  out[4] = du * ty
  out[5] = du * tz
  out[6] = -a * w * w * s1
  out[7] = ddu * ty
  out[8] = ddu * tz
}

/** Fade the hawk in or out by dt and place it on its path (also while the flock is paused).
 *  A hawk that appears from nothing starts at HAWK_ENTRY_TIME. */
export function rampHawk(f: Flock, dt: number, on: boolean) {
  if (on && f.hawkPresence <= 0) f.hawkTime = HAWK_ENTRY_TIME
  f.hawkPresence = Math.max(0, Math.min(1, f.hawkPresence + ((on ? 1 : -1) * dt) / HAWK_FADE))
  hawkAt(f.hawkTime, f.hawk)
}

/**
 * One frame: rebuild the grid, find every bird's neighbours, steer every bird from the same
 * snapshot, integrate. Four passes that hand their results over in typed arrays: one big loop
 * doing all of it boxes doubles (allocates) in V8's optimised code, these do not.
 */
export function stepFlock(f: Flock, dtIn: number, rules: FlockRules, hawkOn: boolean) {
  const dt = Math.min(Math.max(Number.isFinite(dtIn) ? dtIn : 0, 0), MAX_DT)
  rampHawk(f, dt, hawkOn)
  if (dt <= 0 || f.n === 0) return
  if (f.hawkPresence > 0) {
    f.hawkTime += dt
    hawkAt(f.hawkTime, f.hawk)
  }
  f.time += dt
  const frame = f.frame++
  bucket(f)
  findNeighbours(f, frame)
  steer(f, dt, rules)
  integrate(f, dt)
}

/** Counting sort into the grid; copy positions and unit headings into cell order. */
function bucket(f: Flock) {
  const { n, pos, vel, cellOf, cellStart, cellFill, order, rank, sortedPos: sp, sortedDir: sd } = f
  cellStart.fill(0)
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    let cx = ((pos[i3] + GRID_HALF) * INV_CELL) | 0
    let cy = ((pos[i3 + 1] + GRID_HALF) * INV_CELL) | 0
    let cz = ((pos[i3 + 2] + GRID_HALF) * INV_CELL) | 0
    cx = (cx < 0 ? 0 : cx >= INNER ? INNER - 1 : cx) + PAD
    cy = (cy < 0 ? 0 : cy >= INNER ? INNER - 1 : cy) + PAD
    cz = (cz < 0 ? 0 : cz >= INNER ? INNER - 1 : cz) + PAD
    const c = cx + NX * cy + NXY * cz
    cellOf[i] = c
    cellStart[c + 1]++
  }
  for (let c = 0; c < NCELL; c++) {
    cellStart[c + 1] += cellStart[c]
    cellFill[c] = cellStart[c]
  }
  for (let i = 0; i < n; i++) {
    const j = cellFill[cellOf[i]]++
    order[j] = i
    rank[i] = j
    const i3 = i * 3, j3 = j * 3
    sp[j3] = pos[i3]
    sp[j3 + 1] = pos[i3 + 1]
    sp[j3 + 2] = pos[i3 + 2]
    const vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2]
    const inv = 1 / Math.max(Math.sqrt(vx * vx + vy * vy + vz * vz), 1e-9)
    sd[j3] = vx * inv
    sd[j3 + 1] = vy * inv
    sd[j3 + 2] = vz * inv
  }
}

/**
 * Each bird's NEIGHBOURS nearest flockmates within PERCEPTION, into prevNear / prevCount (bird
 * indices). Half the flock searches each frame; the other half keeps last frame's flockmates
 * (dropping any now out of range).
 */
function findNeighbours(f: Flock, frame: number) {
  const { n, cellOf, cellStart, order, rank, prevNear, prevCount, sortedPos: sp, nearD, nearI, gap } = f
  const R2 = PERCEPTION * PERCEPTION
  const K = NEIGHBOURS
  for (let j = 0; j < n; j++) {
    const i = order[j]
    const j3 = j * 3
    const px = sp[j3], py = sp[j3 + 1], pz = sp[j3 + 2]
    const pk = i * K
    const pc = prevCount[i]
    let m = 0
    if (pc > 0 && (i + frame) % NEIGHBOUR_REFRESH !== 0) {
      for (let t = 0; t < pc; t++) {
        const q3 = rank[prevNear[pk + t]] * 3
        const dx = sp[q3] - px, dy = sp[q3 + 1] - py, dz = sp[q3 + 2] - pz
        if (dx * dx + dy * dy + dz * dz < R2) prevNear[pk + m++] = prevNear[pk + t]
      }
      prevCount[i] = m
      continue
    }

    // squared gaps from the bird to the cells one and two either side of its own, per axis
    // (birds clamped in from outside the grid get conservative gaps: never a wrong skip)
    let gx = ((px + GRID_HALF) * INV_CELL) | 0
    let gy = ((py + GRID_HALF) * INV_CELL) | 0
    let gz = ((pz + GRID_HALF) * INV_CELL) | 0
    gx = gx < 0 ? 0 : gx >= INNER ? INNER - 1 : gx
    gy = gy < 0 ? 0 : gy >= INNER ? INNER - 1 : gy
    gz = gz < 0 ? 0 : gz >= INNER ? INNER - 1 : gz
    for (let a = 0; a < 3; a++) {
      const l = a === 0 ? px - (gx * CELL - GRID_HALF) : a === 1 ? py - (gy * CELL - GRID_HALF) : pz - (gz * CELL - GRID_HALF)
      const lo = l > 0 ? l : 0
      const hiRaw = CELL - l
      const hi = hiRaw > 0 ? hiRaw : 0
      const o = a * 5
      gap[o] = (lo + CELL) * (lo + CELL)
      gap[o + 1] = lo * lo
      gap[o + 2] = 0
      gap[o + 3] = hi * hi
      gap[o + 4] = (hi + CELL) * (hi + CELL)
    }

    // start the bound at the farthest of last frame's K neighbours, measured now: at least K
    // birds lie inside it, so the search never has to look past it
    let lim2 = R2
    if (pc === K) {
      let b = 0
      for (let t = 0; t < K; t++) {
        const q3 = rank[prevNear[pk + t]] * 3
        const dx = sp[q3] - px, dy = sp[q3 + 1] - py, dz = sp[q3 + 2] - pz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > b) b = d2
      }
      b = b * (1 + 1e-7) + 1e-12
      if (b < lim2) lim2 = b
    }

    // the K nearest, unordered; `far` is the slot of the farthest once the set is full
    const c = cellOf[i]
    let far = 0
    const g0 = gap[0], g1 = gap[1], g3 = gap[3], g4 = gap[4]
    for (let r = 0; r < NROW; r++) {
      if (ROW_LOW[r] >= lim2) break
      const gyz = gap[ROW_GY[r]] + gap[ROW_GZ[r]]
      if (gyz >= lim2) continue
      const lo = g1 + gyz < lim2 ? (g0 + gyz < lim2 ? -2 : -1) : 0
      const hi = g3 + gyz < lim2 ? (g4 + gyz < lim2 ? 3 : 2) : 1
      const cc = c + ROW_D[r]
      const end = cellStart[cc + hi]
      for (let q = cellStart[cc + lo]; q < end; q++) {
        const q3 = q * 3
        const dx = sp[q3] - px, dy = sp[q3 + 1] - py, dz = sp[q3 + 2] - pz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 >= lim2 || q === j) continue
        if (m < K) {
          nearD[m] = d2
          nearI[m] = q
          if (++m < K) continue
        } else {
          nearD[far] = d2
          nearI[far] = q
        }
        far = 0
        let fd = nearD[0]
        for (let t = 1; t < K; t++) {
          const e = nearD[t]
          if (e > fd) {
            fd = e
            far = t
          }
        }
        lim2 = fd
      }
    }
    for (let t = 0; t < m; t++) prevNear[pk + t] = order[nearI[t]]
    prevCount[i] = m
  }
}

/** The three rules and the wander noise, granted in priority order out of MAX_STEER, into
 *  acc; and the flock statistics. */
function steer(f: Flock, dt: number, rules: FlockRules) {
  const { n, vel, acc, wander, order, rank, prevNear, prevCount, sortedPos: sp, sortedDir: sd } = f
  const K = NEIGHBOURS
  const SEP = SEPARATION_DISTANCE
  const COLL2 = COLLISION_DISTANCE * COLLISION_DISTANCE
  const wSep = rules === 'noSeparation' ? 0 : SEPARATION_WEIGHT
  const wAli = rules === 'noAlignment' ? 0 : ALIGNMENT_WEIGHT
  const wCoh = rules === 'noCohesion' ? 0 : COHESION_WEIGHT
  const INV_ALIGN_TIME = 1 / ALIGN_TIME
  const INV_EDGE_SPAN = 1 / (COHESION_EDGE_HIGH - COHESION_EDGE_LOW)
  const wDecay = dt / WANDER_TIME
  const wKick = Math.sqrt(6 * wDecay) // uniform [−1, 1) has variance 1/3: unit stationary variance
  let seed = f.seed
  let alignSum = 0, alignCount = 0, neighbourSum = 0, nearestSum = 0, collisions = 0

  for (let j = 0; j < n; j++) {
    const i = order[j]
    const i3 = i * 3, j3 = j * 3
    const px = sp[j3], py = sp[j3 + 1], pz = sp[j3 + 2]
    const vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2]
    const m = prevCount[i]
    const pk = i * K
    let ax = 0, ay = 0, az = 0
    let budget = MAX_STEER

    if (m > 0) {
      let cohX = 0, cohY = 0, cohZ = 0, aliX = 0, aliY = 0, aliZ = 0, sepX = 0, sepY = 0, sepZ = 0, sepS = 0
      let nearest = PERCEPTION
      for (let t = 0; t < m; t++) {
        const q3 = rank[prevNear[pk + t]] * 3
        const dx = sp[q3] - px, dy = sp[q3 + 1] - py, dz = sp[q3 + 2] - pz
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d < nearest) nearest = d
        const inv = d > 1e-9 ? 1 / d : 0
        // unit vectors toward the neighbours: their mean says how one-sided the neighbourhood is
        cohX += dx * inv
        cohY += dy * inv
        cohZ += dz * inv
        aliX += sd[q3]
        aliY += sd[q3 + 1]
        aliZ += sd[q3 + 2]
        if (d < SEP) {
          // away from each close flockmate, weighted by closeness (coincident: no direction)
          const close = 1 - d / SEP
          const w = close * inv
          sepX -= dx * w
          sepY -= dy * w
          sepZ -= dz * w
          sepS += close
        }
      }
      const invM = 1 / m
      alignSum += (sd[j3] * aliX + sd[j3 + 1] * aliY + sd[j3 + 2] * aliZ) * invM
      alignCount++
      neighbourSum += m
      nearestSum += nearest
      if (nearest * nearest < COLL2) collisions++

      // separation: pushed from each flockmate inside SEPARATION_DISTANCE, harder the closer
      if (wSep > 0 && sepS > 0) {
        const l = Math.sqrt(sepX * sepX + sepY * sepY + sepZ * sepZ) * MAX_STEER
        const r = wSep * (l < MAX_STEER ? l : MAX_STEER)
        if (l > 1e-12) {
          const grant = r <= budget ? r : budget
          const k = (grant * MAX_STEER) / l
          ax += sepX * k
          ay += sepY * k
          az += sepZ * k
          budget -= grant
        }
      }
      // alignment: the velocity relaxes toward the neighbours' mean heading at cruise speed
      if (wAli > 0 && budget > 0) {
        const l = Math.sqrt(aliX * aliX + aliY * aliY + aliZ * aliZ)
        if (l > 1e-9) {
          const k = CRUISE_SPEED / l
          const rx = (aliX * k - vx) * INV_ALIGN_TIME, ry = (aliY * k - vy) * INV_ALIGN_TIME, rz = (aliZ * k - vz) * INV_ALIGN_TIME
          const rl = Math.sqrt(rx * rx + ry * ry + rz * rz)
          const r = wAli * (rl < MAX_STEER ? rl : MAX_STEER)
          if (rl > 1e-12) {
            const grant = r <= budget ? r : budget
            const g = grant / rl
            ax += rx * g
            ay += ry * g
            az += rz * g
            budget -= grant
          }
        }
      }
      // cohesion: toward the flockmates, for birds on the flock's edge (all neighbours to one
      // side) and not for birds inside it, whose neighbours surround them (Hemelrijk &
      // Hildenbrandt's centrality); this is what gives the flock a surface
      if (wCoh > 0 && budget > 0) {
        const l = Math.sqrt(cohX * cohX + cohY * cohY + cohZ * cohZ)
        const edge = (l * invM - COHESION_EDGE_LOW) * INV_EDGE_SPAN
        if (edge > 0 && l > 1e-9) {
          const r = wCoh * MAX_STEER * (edge < 1 ? edge : 1)
          const grant = r <= budget ? r : budget
          const g = grant / l
          ax += cohX * g
          ay += cohY * g
          az += cohZ * g
          budget -= grant
        }
      }
    }

    // wander: an Ornstein–Uhlenbeck process per bird, granted from what is left
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    const wx = wander[i3] * (1 - wDecay) + wKick * seed * 4.656612873077393e-10
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    const wy = wander[i3 + 1] * (1 - wDecay) + wKick * seed * 4.656612873077393e-10
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    const wz = wander[i3 + 2] * (1 - wDecay) + wKick * seed * 4.656612873077393e-10
    wander[i3] = wx
    wander[i3 + 1] = wy
    wander[i3 + 2] = wz
    if (budget > 0) {
      const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) * WANDER_ACCEL
      if (wl > 1e-12) {
        const g = ((wl <= budget ? wl : budget) * WANDER_ACCEL) / wl
        ax += wx * g
        ay += wy * g
        az += wz * g
      }
    }

    acc[i3] = ax
    acc[i3 + 1] = ay
    acc[i3 + 2] = az
  }

  f.seed = seed
  const a = alignCount > 0 ? alignSum / alignCount : 0
  f.alignment = a < 0 ? 0 : a > 1 ? 1 : a
  f.meanNeighbours = neighbourSum / n
  f.meanNearest = alignCount > 0 ? nearestSum / alignCount : 0
  f.collisions = collisions / n
}

/** The world's forces (outside the steering budget), then semi-implicit Euler. */
function integrate(f: Flock, dt: number) {
  const { n, pos, vel, acc } = f
  const B2 = BOUND_RADIUS * BOUND_RADIUS
  const hawkW = f.hawkPresence > 0 ? HAWK_WEIGHT * f.hawkPresence : 0
  const hx = f.hawk[0], hy = f.hawk[1], hz = f.hawk[2]
  const REACH2 = HAWK_REACH * HAWK_REACH
  let sumX = 0, sumY = 0, sumZ = 0
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2]
    const vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2]
    let ax = acc[i3], ay = acc[i3 + 1], az = acc[i3 + 2]

    const r2 = px * px + py * py + pz * pz
    if (r2 > B2) {
      // steer (turn), not shove: the velocity relaxes toward "inward at cruise speed"
      const r = Math.sqrt(r2)
      const depth = (r - BOUND_RADIUS) / BOUND_DEPTH
      const k = (depth < 1 ? depth : 1) / BOUND_TIME
      const inward = CRUISE_SPEED / r
      ax += (-px * inward - vx) * k
      ay += (-py * inward - vy) * k
      az += (-pz * inward - vz) * k
    }
    if (hawkW > 0) {
      const dx = px - hx, dy = py - hy, dz = pz - hz
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < REACH2) {
        // flee straight away at full speed: HAWK_WEIGHT full steering requests, nearer is harder
        const d = Math.sqrt(d2)
        const k = d > 1e-6 ? MAX_SPEED / d : 0
        const rx = dx * k - vx, ry = dy * k - vy, rz = dz * k - vz
        const rl = Math.sqrt(rx * rx + ry * ry + rz * rz)
        const g = (hawkW * (1 - d2 / REACH2) * (rl > MAX_STEER ? MAX_STEER / rl : 1))
        ax += rx * g
        ay += ry * g
        az += rz * g
      }
    }
    acc[i3] = ax
    acc[i3 + 1] = ay
    acc[i3 + 2] = az

    // semi-implicit Euler: velocity first, clamped to the speed band, then position
    let nvx = vx + ax * dt, nvy = vy + ay * dt, nvz = vz + az * dt
    const s2 = nvx * nvx + nvy * nvy + nvz * nvz
    if (s2 > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(s2)
      nvx *= k
      nvy *= k
      nvz *= k
    } else if (s2 < MIN_SPEED * MIN_SPEED) {
      // too slow: keep the new direction, or the old one if the new velocity vanished
      const ok = s2 > 1e-18
      const k = MIN_SPEED / Math.sqrt(ok ? s2 : vx * vx + vy * vy + vz * vz)
      nvx = (ok ? nvx : vx) * k
      nvy = (ok ? nvy : vy) * k
      nvz = (ok ? nvz : vz) * k
    }
    vel[i3] = nvx
    vel[i3 + 1] = nvy
    vel[i3 + 2] = nvz
    const nx = px + nvx * dt, ny = py + nvy * dt, nz = pz + nvz * dt
    pos[i3] = nx
    pos[i3 + 1] = ny
    pos[i3 + 2] = nz
    sumX += nx
    sumY += ny
    sumZ += nz
  }
  f.centroid[0] = sumX / n
  f.centroid[1] = sumY / n
  f.centroid[2] = sumZ / n
}
