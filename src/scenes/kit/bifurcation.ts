/**
 * Where the bifurcation diagram stands in Act II, and how it is drawn: shared by the tap
 * (which raises it out of the water) and the Feigenbaum scene (which zooms into it), so the
 * hand-over between them is seamless.
 */
import * as THREE from 'three'
import { defaultLook, type DustLook } from '../../engine/Dust'
import type { Palette } from '../../engine/palettes'
import type { LogisticSource } from './LogisticSource'

/** the whole diagram, r 2.8 → 4 across and x 0 → 1 up, in world units */
export const DIAGRAM = {
  width: 2.8,
  height: 1.38,
  centre: [0, -0.33, 0] as [number, number, number],
  dial: [2.8, 4] as [number, number],
}

/** stand the shared source where the diagram goes, at full range */
export function placeDiagram(src: LogisticSource, palette: Palette) {
  src.setForm('logistic')
  src.setDial(DIAGRAM.dial[0], DIAGRAM.dial[1])
  src.setValue(0, 1)
  src.place(DIAGRAM.width, DIAGRAM.height, DIAGRAM.centre)
  src.depth = 0.008
  src.setPalette(palette)
}

/** world position of (r, x) on the whole diagram */
export function diagramWorld(r: number, x: number, out = new THREE.Vector3()): THREE.Vector3 {
  const [c0, c1, c2] = DIAGRAM.centre
  return out.set(
    c0 - DIAGRAM.width / 2 + ((r - DIAGRAM.dial[0]) / (DIAGRAM.dial[1] - DIAGRAM.dial[0])) * DIAGRAM.width,
    c1 - DIAGRAM.height / 2 + x * DIAGRAM.height,
    c2,
  )
}

/**
 * Fine round points, coloured by the source's order/chaos paint. On a tall screen the same
 * diagram covers far fewer pixels, so each must be dimmer.
 */
export function diagramLook(palette: Palette, src: LogisticSource, portrait = false): DustLook {
  return {
    ...defaultLook(palette),
    size: 0.0022,
    minPx: 0.55,
    gain: portrait ? 0.24 : 0.5,
    streak: 0,
    tone: 'seed',
    toneBias: 0.6,
    toneScale: 0.3,
    paint: src.paint,
    paintMix: 1,
    twinkle: 0.18,
  }
}
