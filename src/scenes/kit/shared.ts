/**
 * Things several scenes share: the house looks for the dust, the height of the floor, and the
 * long-lived sources (the Lorenz butterfly appears in six scenes; it is made once and kept).
 */
import * as THREE from 'three'
import { defaultLook, type DustLook } from '../../engine/Dust'
import type { Engine } from '../../engine/Engine'
import type { Palette } from '../../engine/palettes'
import { FlowSource, PointsSource } from '../../engine/sources'
import { getSystem } from '../../systems'
import type { Vec3 } from '../../types'

/** world y of the mirror floor in scenes that stand on one */
export const FLOOR = -1.05

/** fine glowing threads: a strange attractor in full flow */
export function silk(palette: Palette, speedNorm: number): DustLook {
  return { ...defaultLook(palette), size: 0.0026, minPx: 0.6, gain: 0.6, streak: 2, soft: 1.55, tone: 'speed', speedNorm }
}

/** still points of light: lettering, diagrams, anything drawn rather than flowing */
export function ink(palette: Palette, tone = 0.72): DustLook {
  return { ...defaultLook(palette), size: 0.0026, minPx: 0.6, gain: 0.5, streak: 0, tone: 'seed', toneBias: tone, toneScale: 0.28, twinkle: 0.25 }
}

/** barely-there motes filling the room while something else has the stage */
export function haze(palette: Palette): DustLook {
  return { ...defaultLook(palette), size: 0.004, minPx: 0.6, gain: 0.07, streak: 0, tone: 'seed', toneBias: 0.3, toneScale: 0.22, twinkle: 0.5 }
}

const keep = new WeakMap<Engine, { lorenz?: FlowSource; motes?: PointsSource; veil?: PointsSource }>()

function kept(engine: Engine) {
  let k = keep.get(engine)
  if (!k) {
    k = {}
    keep.set(engine, k)
  }
  return k
}

/** The Lorenz system at its classic settings; one instance for the whole film. */
export function lorenzFlow(engine: Engine): FlowSource {
  const k = kept(engine)
  if (!k.lorenz) k.lorenz = new FlowSource(engine.renderer, engine.size, 'lorenz')
  return k.lorenz
}

/** put the shared butterfly back to ρ = 28 with every particle on the attractor */
export function resetLorenz(flow: FlowSource) {
  const sys = getSystem('lorenz')
  flow.setSystem('lorenz', sys.params.map((p) => p.default))
  flow.speed = 1
  flow.paused = false
  flow.spawnAttractor()
}

/** a point on the butterfly, system coordinates */
export const LORENZ_SEED: Vec3 = [5.2644, 8.9105, 14.331]

/**
 * A wide, flat cloud of drifting motes. Scenes whose subject is a solid object park the dust
 * here; it turns slowly so the room never looks frozen.
 */
export function motes(engine: Engine): PointsSource {
  const k = kept(engine)
  if (!k.motes) {
    const src = new PointsSource(engine.size)
    const d = src.data
    let seed = 0x1234abcd
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < src.count; i++) {
      // a thick disc, denser toward the middle, with a hollow where the subject stands
      const r = 1.6 + 5.5 * Math.pow(rand(), 0.7)
      const a = rand() * Math.PI * 2
      const o = i * 4
      d[o] = r * Math.cos(a)
      d[o + 1] = (rand() - 0.5) * (1.2 + r * 0.55)
      d[o + 2] = r * Math.sin(a)
      d[o + 3] = rand()
    }
    src.commit()
    k.motes = src
  }
  return k.motes
}

/**
 * Dust hung in the air behind a flat subject (a chart, a diagram): a deep slab of faint points
 * that never comes between the camera and the page.
 */
export function veil(engine: Engine): PointsSource {
  const k = kept(engine)
  if (!k.veil) {
    const src = new PointsSource(engine.size)
    const d = src.data
    let seed = 0x51ed270b
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < src.count; i++) {
      const o = i * 4
      const depth = 0.6 + 7 * Math.pow(rand(), 1.4)
      d[o] = (rand() - 0.5) * (9 + depth * 2.2)
      d[o + 1] = (rand() - 0.5) * (4.5 + depth * 1.2)
      d[o + 2] = -depth
      d[o + 3] = rand()
    }
    src.commit()
    k.veil = src
  }
  return k.veil
}

const spin = new THREE.Matrix4()
/** call every frame while the motes are on screen */
export function driftMotes(src: PointsSource, time: number) {
  src.matrix.copy(spin.makeRotationY(time * 0.012))
}
