/**
 * "How long is the coastline of Britain?" data for the coast stage.
 *
 *   pnpm tsx scripts/coastline.ts
 *
 * 1. Downloads the Natural Earth 10 m coastline (cached in /tmp), picks the Great Britain
 *    mainland ring, projects it to km and writes public/data/britain.json.
 * 2. Walks a pair of dividers round it (Richardson's compass walk) for every ruler in RULERS,
 *    stores the walks in the same file and fits the Richardson dimension D.
 * 3. Prints the Lorenz box-count table that <BoxCount /> draws (no file written).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { openShp } from 'shapefile'
import { RULERS, type BritainJson, type BritainWalkJson } from '../src/fractal/coast/britain'
import {
  BOX_SAMPLE_COUNT,
  MAX_BOXES,
  boxCounts,
  boxLattice,
  fitLine,
  unitCubeEdges,
} from '../src/fractal/coast/boxCounting'

const ZIP_URL = 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_coastline.zip'
const ZIP_CACHE = '/tmp/ne_10m_coastline.zip'
const SHP_NAME = 'ne_10m_coastline.shp'
/** mainland Great Britain lies inside this lon/lat box; Ireland and the Continent do not */
const GB_BOX = { lon0: -7, lon1: 2, lat0: 49.8, lat1: 59 }
/** IUGG mean Earth radius, km */
const R_EARTH = 6371.0088
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const MAIN_FILE = 'britain.json'
const WALKS_FILE = 'britain-walks.json'
/** try this rounding first, then the coarser one if the file is over SOFT_BUDGET */
const ROUNDINGS_KM = [0.01, 0.05]
const SOFT_BUDGET = 1_000_000
const HARD_BUDGET = 1_500_000
/** extra starting points for the robustness check of D (not written to the file) */
const ROBUST_STARTS = 64

// ---------------------------------------------------------------------------------------------
// download

async function coastlineZip(): Promise<Buffer> {
  if (existsSync(ZIP_CACHE) && statSync(ZIP_CACHE).size > 1_000_000) return readFileSync(ZIP_CACHE)
  console.log(`downloading ${ZIP_URL}`)
  try {
    const res = await fetch(ZIP_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(ZIP_CACHE, buf)
    return buf
  } catch (err) {
    console.log(`fetch failed (${(err as Error).message}); retrying with curl`)
    execFileSync('curl', ['-sSL', '--fail', '-o', ZIP_CACHE, ZIP_URL], { stdio: 'inherit' })
    return readFileSync(ZIP_CACHE)
  }
}

type LonLat = [number, number]

async function readLines(zip: Buffer): Promise<LonLat[][]> {
  const entry = new AdmZip(zip).getEntry(SHP_NAME)
  if (!entry) throw new Error(`${SHP_NAME} not found in the zip`)
  // copy into a fresh Uint8Array: shapefile's array source should not see a Buffer pool slice
  const src = await openShp(new Uint8Array(entry.getData()))
  const lines: LonLat[][] = []
  for (;;) {
    const r = await src.read()
    if (r.done) break
    const g = r.value
    if (g.type === 'LineString') lines.push(g.coordinates as LonLat[])
    else if (g.type === 'MultiLineString') for (const l of g.coordinates) lines.push(l as LonLat[])
  }
  return lines
}

// ---------------------------------------------------------------------------------------------
// geometry helpers

const RAD = Math.PI / 180

function haversineKm(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD
  const dLon = (b[0] - a[0]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}

function geodesicLength(line: LonLat[]): number {
  let s = 0
  for (let i = 1; i < line.length; i++) s += haversineKm(line[i - 1], line[i])
  return s
}

/** a closed ring as parallel coordinate arrays; the last vertex repeats the first */
interface Ring {
  x: Float64Array
  y: Float64Array
}

function ringLength(r: Ring): number {
  let s = 0
  for (let i = 1; i < r.x.length; i++) s += Math.hypot(r.x[i] - r.x[i - 1], r.y[i] - r.y[i - 1])
  return s
}

/** shoelace; positive = counter-clockwise */
function signedArea(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  let a = 0
  for (let i = 0; i + 1 < xs.length; i++) a += xs[i] * ys[i + 1] - xs[i + 1] * ys[i]
  return a / 2
}

/** area centroid of a closed ring given as plain coordinates */
function centroid(xs: ArrayLike<number>, ys: ArrayLike<number>): [number, number] {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i + 1 < xs.length; i++) {
    const c = xs[i] * ys[i + 1] - xs[i + 1] * ys[i]
    a += c
    cx += (xs[i] + xs[i + 1]) * c
    cy += (ys[i] + ys[i + 1]) * c
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** the same ring started at vertex `s` (0 ≤ s < n−1) */
function rotateRing(r: Ring, s: number): Ring {
  const n = r.x.length - 1 // unique vertices
  const x = new Float64Array(n + 1)
  const y = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    x[i] = r.x[(s + i) % n]
    y[i] = r.y[(s + i) % n]
  }
  x[n] = x[0]
  y[n] = y[0]
  return { x, y }
}

// ---------------------------------------------------------------------------------------------
// Richardson's compass walk

interface Walk {
  ruler: number
  count: number
  leftover: number
  length: number
  vertices: [number, number][]
}

/**
 * From the ring's first vertex, repeatedly step to the first point further along the polyline
 * whose straight-line distance from the current point is exactly `ruler`, until the remaining
 * polyline up to the start lies inside the ruler's circle; the chord back to the start is the
 * leftover. Measured length = count × ruler + leftover.
 *
 * Invariant: the start of every segment scanned lies strictly inside the circle (it is either
 * the current point or the end of a segment found to be inside). The disc is convex, so a
 * segment whose end is also inside lies wholly inside; otherwise it leaves the circle exactly
 * once, at the larger root of |A + s·d − C|² = r².
 */
function compassWalk(ring: Ring, ruler: number): Walk {
  const { x, y } = ring
  const last = x.length - 1
  const r2 = ruler * ruler
  let cx = x[0]
  let cy = y[0]
  let seg = 0
  let count = 0
  const vertices: [number, number][] = [[cx, cy]]
  for (;;) {
    let hit = false
    for (let j = seg; j < last; j++) {
      const ex = x[j + 1] - cx
      const ey = y[j + 1] - cy
      if (ex * ex + ey * ey < r2) continue
      // A = segment start, or the current point when it lies on this segment
      const ax = j === seg ? cx : x[j]
      const ay = j === seg ? cy : y[j]
      const dx = x[j + 1] - ax
      const dy = y[j + 1] - ay
      const fx = ax - cx
      const fy = ay - cy
      const a = dx * dx + dy * dy
      const b = fx * dx + fy * dy // half the linear coefficient
      const c = fx * fx + fy * fy - r2 // < 0: A is inside
      const sq = Math.sqrt(Math.max(0, b * b - a * c))
      // larger root, written to avoid cancellation
      let s = b >= 0 ? -c / (b + sq) : (sq - b) / a
      s = Math.min(1, Math.max(0, s))
      cx = ax + s * dx
      cy = ay + s * dy
      seg = j
      count++
      vertices.push([cx, cy])
      hit = true
      break
    }
    if (!hit) break
    if (count > 1e6) throw new Error('compass walk did not terminate')
  }
  const leftover = Math.hypot(x[last] - cx, y[last] - cy)
  if (leftover > 1e-9) vertices.push([x[last], y[last]])
  return { ruler, count, leftover, length: count * ruler + leftover, vertices }
}

/** D from walks: slope of log(effective count L/ruler) against log(ruler) is −D */
function richardson(walks: Walk[]): { dimension: number; r2: number } {
  const fit = fitLine(
    walks.map((w) => Math.log(w.ruler)),
    walks.map((w) => Math.log(w.length / w.ruler)),
  )
  return { dimension: -fit.slope, r2: fit.r2 }
}

function richardsonInteger(walks: Walk[]): number {
  return -fitLine(
    walks.map((w) => Math.log(w.ruler)),
    walks.map((w) => Math.log(w.count)),
  ).slope
}

// ---------------------------------------------------------------------------------------------
// output

const roundTo = (q: number) => {
  const k = Math.round(1 / q)
  return (v: number) => Math.round(v * k) / k
}

/** rounded ring as pairs, with consecutive duplicates (after rounding) dropped and closure kept */
function roundRing(r: Ring, q: number): [number, number][] {
  const rd = roundTo(q)
  const out: [number, number][] = []
  for (let i = 0; i < r.x.length; i++) {
    const p: [number, number] = [rd(r.x[i]), rd(r.y[i])]
    const prev = out[out.length - 1]
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue
    out.push(p)
  }
  const a = out[0]
  const b = out[out.length - 1]
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]])
  return out
}

function walkJson(w: Walk, q: number): BritainWalkJson {
  const rd = roundTo(q)
  const r2 = roundTo(0.01)
  return {
    ruler: w.ruler,
    count: w.count,
    leftoverKm: r2(w.leftover),
    lengthKm: r2(w.length),
    vertices: w.vertices.map(([x, y]) => [rd(x), rd(y)]),
  }
}

const pad = (s: string | number, n: number) => String(s).padStart(n)

// ---------------------------------------------------------------------------------------------
// main

async function britain(): Promise<void> {
  const lines = await readLines(await coastlineZip())
  let best: LonLat[] | null = null
  let bestLen = -1
  for (const l of lines) {
    let lo0 = Infinity
    let lo1 = -Infinity
    let la0 = Infinity
    let la1 = -Infinity
    for (const [lon, lat] of l) {
      if (lon < lo0) lo0 = lon
      if (lon > lo1) lo1 = lon
      if (lat < la0) la0 = lat
      if (lat > la1) la1 = lat
    }
    if (lo0 < GB_BOX.lon0 || lo1 > GB_BOX.lon1 || la0 < GB_BOX.lat0 || la1 > GB_BOX.lat1) continue
    const len = geodesicLength(l)
    if (len > bestLen) {
      bestLen = len
      best = l
    }
  }
  if (!best) throw new Error('no line inside the Great Britain box')

  // full resolution, consecutive duplicates dropped, closed
  const ll: LonLat[] = []
  for (const p of best) {
    const q = ll[ll.length - 1]
    if (!q || q[0] !== p[0] || q[1] !== p[1]) ll.push([p[0], p[1]])
  }
  const wasClosed = ll[0][0] === ll[ll.length - 1][0] && ll[0][1] === ll[ll.length - 1][1]
  if (!wasClosed) ll.push([ll[0][0], ll[0][1]])

  // x = R·Δlon·cos(lat0) and y = R·Δlat is affine in (lon, lat), so the area centroid of the
  // projected ring is the projection of the centroid computed in degrees
  const [lon0, lat0] = centroid(
    ll.map((p) => p[0]),
    ll.map((p) => p[1]),
  )
  const kx = R_EARTH * RAD * Math.cos(lat0 * RAD)
  const ky = R_EARTH * RAD
  let ring: Ring = {
    x: Float64Array.from(ll, (p) => (p[0] - lon0) * kx),
    y: Float64Array.from(ll, (p) => (p[1] - lat0) * ky),
  }
  // clockwise (from the north tip the walk heads east, down the North Sea coast)
  if (signedArea(ring.x, ring.y) > 0) ring = { x: ring.x.slice().reverse(), y: ring.y.slice().reverse() }
  let north = 0
  for (let i = 1; i < ring.y.length - 1; i++) if (ring.y[i] > ring.y[north]) north = i
  ring = rotateRing(ring, north)

  const lengthKm = ringLength(ring)
  const geodesicKm = geodesicLength(ll)
  const walks = RULERS.map((r) => compassWalk(ring, r))
  const fit = richardson(walks)

  // ---- report
  const northLL = [ring.x[0] / kx + lon0, ring.y[0] / ky + lat0]
  console.log(
    `\nGreat Britain mainland: ${ll.length - 1} vertices (${best.length - ll.length + (wasClosed ? 0 : 1)} duplicates dropped), ` +
      `centroid ${lon0.toFixed(3)}°, ${lat0.toFixed(3)}°`,
  )
  console.log(`start (northernmost vertex): ${northLL[0].toFixed(3)}°, ${northLL[1].toFixed(3)}°`)
  console.log(
    `polyline length ${lengthKm.toFixed(1)} km projected, ${geodesicKm.toFixed(1)} km geodesic ` +
      `(projection error ${(((lengthKm - geodesicKm) / geodesicKm) * 100).toFixed(2)} %)`,
  )
  console.log('\n  ruler km   steps N   leftover km   length km   local D')
  walks.forEach((w, i) => {
    const prev = walks[i - 1]
    const local = prev ? 1 - Math.log(w.length / prev.length) / Math.log(w.ruler / prev.ruler) : NaN
    console.log(
      `${pad(w.ruler, 10)} ${pad(w.count, 9)} ${pad(w.leftover.toFixed(1), 13)} ${pad(w.length.toFixed(1), 11)}` +
        `   ${Number.isNaN(local) ? '     ' : local.toFixed(3)}`,
    )
  })
  console.log(
    `\nRichardson D = ${fit.dimension.toFixed(3)} (R² ${fit.r2.toFixed(4)}), fit of log(L/ruler) vs log(ruler), ` +
      `all ${RULERS.length} rulers; integer-N fit gives ${richardsonInteger(walks).toFixed(3)}`,
  )
  const sub = (lo: number, hi: number) => richardson(walks.filter((w) => w.ruler >= lo && w.ruler <= hi))
  for (const [lo, hi] of [
    [6.25, 200],
    [12.5, 400],
    [12.5, 200],
    [25, 400],
  ])
    console.log(`  rulers ${lo}–${hi} km: D = ${sub(lo, hi).dimension.toFixed(3)}`)

  // robustness: the same walks from other starting points along the ring
  const n = ring.x.length - 1
  const ds: number[] = []
  const lens = RULERS.map(() => [] as number[])
  for (let k = 0; k < ROBUST_STARTS; k++) {
    const rr = rotateRing(ring, Math.floor((k * n) / ROBUST_STARTS))
    const ws = RULERS.map((r) => compassWalk(rr, r))
    ds.push(richardson(ws).dimension)
    ws.forEach((w, i) => lens[i].push(w.length))
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
  const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)))
  console.log(
    `  over ${ROBUST_STARTS} starting points: D = ${mean(ds).toFixed(3)} ± ${sd(ds).toFixed(3)} ` +
      `(min ${Math.min(...ds).toFixed(3)}, max ${Math.max(...ds).toFixed(3)})`,
  )
  console.log(
    '  length spread by ruler: ' +
      RULERS.map((r, i) => `${r}: ${mean(lens[i]).toFixed(0)}±${sd(lens[i]).toFixed(0)}`).join(', '),
  )

  // ---- write, coarsening the rounding if needed to stay in budget
  mkdirSync(OUT_DIR, { recursive: true })
  let written = false
  for (const q of ROUNDINGS_KM) {
    const points = roundRing(ring, q)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const r2 = roundTo(0.01)
    const json: BritainJson = {
      source: 'Natural Earth 10 m coastline (public domain), naturalearthdata.com',
      projection: { lon0: +lon0.toFixed(5), lat0: +lat0.toFixed(5), radiusKm: R_EARTH },
      roundingKm: q,
      points,
      bbox: [minX, minY, maxX, maxY],
      lengthKm: r2(lengthKm),
      walks: walks.map((w) => walkJson(w, q)),
      fit: { dimension: +fit.dimension.toFixed(4), r2: +fit.r2.toFixed(5) },
    }
    let text = JSON.stringify(json)
    const isLast = q === ROUNDINGS_KM[ROUNDINGS_KM.length - 1]
    if (text.length > SOFT_BUDGET && !isLast) continue
    if (text.length > HARD_BUDGET) {
      const { walks: w, ...rest } = json
      writeFileSync(join(OUT_DIR, WALKS_FILE), JSON.stringify(w))
      text = JSON.stringify(rest)
      console.log(`walks moved to ${WALKS_FILE}`)
    }
    writeFileSync(join(OUT_DIR, MAIN_FILE), text)
    console.log(
      `\nwrote public/data/${MAIN_FILE}: ${(text.length / 1024).toFixed(1)} KB, ${points.length} points, rounding ${q} km`,
    )
    written = true
    break
  }
  if (!written) throw new Error('nothing written')
}

/** brute force: every unique lattice edge of the union is drawn by exactly one cell */
function checkMasks(edge: number): void {
  const lat = boxLattice(edge)
  if (!lat || lat.drawn !== lat.count) return
  const cube = unitCubeEdges()
  const key = (x: number, y: number, z: number, a: number) => `${x},${y},${z},${a}`
  const unique = new Set<string>()
  const drawn = new Map<string, number>()
  for (let c = 0; c < lat.drawn; c++) {
    const i = lat.cells[c * 3]
    const j = lat.cells[c * 3 + 1]
    const k = lat.cells[c * 3 + 2]
    for (let e = 0; e < 12; e++) {
      const o = e * 6
      const k0 = key(i + cube[o], j + cube[o + 1], k + cube[o + 2], e >> 2)
      unique.add(k0)
      if (lat.masks[c] & (1 << e)) drawn.set(k0, (drawn.get(k0) ?? 0) + 1)
    }
  }
  let twice = 0
  for (const v of drawn.values()) if (v !== 1) twice++
  const ok = drawn.size === unique.size && twice === 0
  console.log(
    `  mask check at edge ${edge}: ${unique.size} unique edges, ${drawn.size} drawn, ${twice} drawn more than once → ${ok ? 'OK' : 'FAIL'}` +
      ` (naive instancing would draw ${lat.drawn * 12})`,
  )
  if (!ok) process.exitCode = 1
}

function lorenzBoxes(): void {
  const t0 = performance.now()
  boxCounts([1]) // builds the sample
  const tSample = performance.now() - t0
  const edges: number[] = []
  for (let e = 0.5; e > 0.0039; e /= Math.SQRT2) edges.push(+e.toPrecision(6))
  const t1 = performance.now()
  const counts = boxCounts(edges)
  const tCount = (performance.now() - t1) / edges.length
  console.log(
    `\nLorenz box count: ${BOX_SAMPLE_COUNT} RK4 samples (dt 0.005, transient 2000) in render units, ` +
      `sampled in ${tSample.toFixed(0)} ms, ${tCount.toFixed(1)} ms per edge`,
  )
  console.log('\n    edge     boxes   local slope   drawable')
  counts.forEach((c, i) => {
    const p = counts[i - 1]
    const local = p ? Math.log(c.count / p.count) / Math.log(p.edge / c.edge) : NaN
    console.log(
      `${pad(c.edge.toFixed(4), 8)} ${pad(c.count, 9)}   ${pad(Number.isNaN(local) ? '' : local.toFixed(3), 11)}   ${c.count <= MAX_BOXES ? 'yes' : 'capped'}`,
    )
  })
  const fitRange = (lo: number, hi: number) => {
    const sel = counts.filter((c) => c.edge >= lo - 1e-9 && c.edge <= hi + 1e-9)
    const f = fitLine(
      sel.map((c) => -Math.log(c.edge)),
      sel.map((c) => Math.log(c.count)),
    )
    return `${lo}–${hi}: D = ${f.slope.toFixed(3)} (R² ${f.r2.toFixed(4)}, ${sel.length} edges)`
  }
  console.log('\nfits of log(count) vs log(1/edge):')
  for (const [lo, hi] of [
    [0.03, 0.25],
    [0.0625, 0.25],
    [0.03, 0.125],
    [0.0156, 0.125],
    [0.0156, 0.0625],
    [0.0078, 0.0625],
  ])
    console.log('  ' + fitRange(lo, hi))
  const ladder = [0.25, 0.125, 0.0625, 0.03125]
  const f = fitLine(
    ladder.map((e) => -Math.log(e)),
    boxCounts(ladder).map((c) => Math.log(c.count)),
  )
  console.log(
    `  halving ladder ${ladder.join(', ')}: counts ${boxCounts(ladder)
      .map((c) => c.count)
      .join(', ')} → D = ${f.slope.toFixed(3)} (R² ${f.r2.toFixed(4)})`,
  )
  const t2 = performance.now()
  boxLattice(0.03)
  console.log(`\nlattice (cells + edge masks) at edge 0.03 built in ${(performance.now() - t2).toFixed(1)} ms`)
  for (const e of [0.25, 0.0625, 0.03]) checkMasks(e)
}

await britain()
lorenzBoxes()
