/**
 * The film's name, written in dust. Used by the title and again by the last scene, which lets
 * the butterfly settle back into the words it came from.
 */
import type { DustLook } from '../../engine/Dust'
import type { Engine } from '../../engine/Engine'
import type { Palette } from '../../engine/palettes'
import { PointsSource, textPoints } from '../../engine/sources'
import { ink } from './shared'

const FAMILY = '"Fraunces Variable", Fraunces, Georgia, serif'
const keep = new WeakMap<Engine, PointsSource>()

/** resolves once the typeface has loaded and the letters have been sampled */
export async function titleSource(engine: Engine): Promise<PointsSource> {
  const had = keep.get(engine)
  if (had) return had
  await document.fonts.load(`300 200px ${FAMILY}`)
  const made = keep.get(engine)
  if (made) return made
  const pts = textPoints(['Strange', 'Attractors'], FAMILY, 300, 140000, 0.6, 0.98)
  const src = new PointsSource(engine.size)
  src.fill(pts, 3, 0.0025)
  keep.set(engine, src)
  return src
}

export function titleLook(palette: Palette): DustLook {
  return { ...ink(palette, 0.78), toneScale: 0.22, gain: 0.4, twinkle: 0.35 }
}

/** where the camera sits to read the title, with room under it for the buttons */
export const TITLE_SHOT = { target: [0, -0.42, 0] as [number, number, number], distance: 4.6, azimuth: 0, elevation: 1.5, orbit: 0, aperture: 0.005, fov: 38, portrait: { distance: 4.3, target: [0, -0.7, 0] as [number, number, number] } }
