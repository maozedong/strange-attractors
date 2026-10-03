/**
 * The Great Britain coastline and its Richardson ruler walks, precomputed by
 * scripts/coastline.ts into public/data/britain.json. Shared by the script (types, RULERS) and
 * the app (loader, readouts). No three.js here, so the script can import it.
 */

/** Ruler lengths of the precomputed walks, km, longest first. */
export const RULERS = [400, 200, 100, 50, 25, 12.5, 6.25] as const

// ---------------------------------------------------------------- the file on disk

export interface BritainWalkJson {
  /** ruler length, km */
  ruler: number
  /** full ruler steps N */
  count: number
  /** chord from the last step back to the start, km (shorter than one ruler) */
  leftoverKm: number
  /** N × ruler + leftover, km */
  lengthKm: number
  /** start, the N step points, then the start again (the leftover chord); km */
  vertices: [number, number][]
}

export interface BritainJson {
  source: string
  /** x = R·Δlon·cos(lat0), y = R·Δlat, both in km, about the ring's area centroid */
  projection: { lon0: number; lat0: number; radiusKm: number }
  /** coordinate rounding applied to points and walk vertices, km */
  roundingKm: number
  /** closed ring (last point = first), clockwise, starting at the northernmost vertex; km */
  points: [number, number][]
  /** [minX, minY, maxX, maxY], km */
  bbox: [number, number, number, number]
  /** polyline length of `points`, km */
  lengthKm: number
  /** absent only if the script had to move them to britain-walks.json to stay under budget */
  walks?: BritainWalkJson[]
  /** least-squares fit of log(L / ruler) against log(ruler) over every walk: slope = −D */
  fit: { dimension: number; r2: number }
}

// ---------------------------------------------------------------- in memory

export interface BritainWalk {
  ruler: number
  count: number
  leftoverKm: number
  lengthKm: number
  /** xyz per vertex (z = 0), km; `count + 2` vertices, or `count + 1` if there is no leftover */
  vertices: Float32Array
  /** number of chords = vertices − 1 */
  segments: number
}

export interface Britain {
  /** xyz per ring vertex (z = 0), km */
  points: Float32Array
  bbox: [number, number, number, number]
  lengthKm: number
  /** longest ruler first, same order as RULERS */
  walks: BritainWalk[]
  /** the coastline's Richardson dimension, fitted over every walk */
  dimension: number
}

export interface WalkInfo {
  /** the precomputed ruler that was matched, km; 0 when nothing matched */
  ruler: number
  /** full ruler steps; 0 when nothing matched */
  count: number
  /** measured length N × ruler + leftover, km; 0 when nothing matched */
  lengthKm: number
}

function toXYZ(pairs: [number, number][]): Float32Array {
  const out = new Float32Array(pairs.length * 3)
  for (let i = 0; i < pairs.length; i++) {
    out[i * 3] = pairs[i][0]
    out[i * 3 + 1] = pairs[i][1]
  }
  return out
}

let loaded: Britain | null = null
let pending: Promise<Britain> | null = null

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`coast: ${name} → HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * The coastline and its walks, fetched once per page load and shared by every <Coastline />.
 * Call it early to prefetch. A failed load is not cached, so the next call retries.
 */
export function loadBritain(): Promise<Britain> {
  if (pending) return pending
  pending = (async () => {
    const json = await fetchJson<BritainJson>('britain.json')
    const walksJson = json.walks ?? (await fetchJson<BritainWalkJson[]>('britain-walks.json'))
    const walks = walksJson
      .map((w): BritainWalk => ({
        ruler: w.ruler,
        count: w.count,
        leftoverKm: w.leftoverKm,
        lengthKm: w.lengthKm,
        vertices: toXYZ(w.vertices),
        segments: w.vertices.length - 1,
      }))
      .sort((a, b) => b.ruler - a.ruler)
    loaded = {
      points: toXYZ(json.points),
      bbox: json.bbox,
      lengthKm: json.lengthKm,
      walks,
      dimension: json.fit.dimension,
    }
    return loaded
  })()
  pending.catch(() => {
    pending = null
  })
  return pending
}

/** The loaded data, or null until loadBritain() has resolved. */
export function britainData(): Britain | null {
  return loaded
}

/** Index of the walk whose ruler is closest to `ruler` in ratio (log) terms. */
export function nearestWalkIndex(walks: readonly { ruler: number }[], ruler: number): number {
  let best = 0
  let bestD = Infinity
  const lr = Math.log(Math.max(ruler, 1e-9))
  for (let i = 0; i < walks.length; i++) {
    const d = Math.abs(Math.log(walks[i].ruler) - lr)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

const NO_WALK: WalkInfo = { ruler: 0, count: 0, lengthKm: 0 }

/**
 * Step count and measured length for the walk closest to `ruler` (km, closest in ratio), for UI
 * readouts. All zeros until the data has loaded (prefetch with loadBritain()) or when `ruler` ≤ 0.
 */
export function walkInfo(ruler: number): WalkInfo {
  if (!loaded || !(ruler > 0) || loaded.walks.length === 0) return NO_WALK
  const w = loaded.walks[nearestWalkIndex(loaded.walks, ruler)]
  return { ruler: w.ruler, count: w.count, lengthKm: w.lengthKm }
}

/** Richardson dimension D of the coastline from the precomputed walks; null until loaded. */
export function coastDimension(): number | null {
  return loaded ? loaded.dimension : null
}
