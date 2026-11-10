/**
 * The title. The dust drifts in as a loose cloud and settles into the words; when the film
 * begins the letters let go and become the first scene.
 */
import { PointsSource, textPoints } from '../engine/sources'
import type { SceneFactory } from '../film/types'
import { driftMotes, haze, ink, motes } from './kit/shared'

const FAMILY = '"Fraunces Variable", Fraunces, Georgia, serif'

const title: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const cloud = motes(engine)
  let text: PointsSource | null = null
  let alive = true

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0
      dust.setSource(cloud, haze(palette))
      rig.shot({ target: [0, -0.42, 0], distance: 4.6, azimuth: 0, elevation: 1.5, orbit: 0, aperture: 0.005, fov: 38, portrait: { distance: 4.3, target: [0, -0.7, 0] } }, 0)
      void document.fonts.load(`300 200px ${FAMILY}`).then(() => {
        if (!alive) return
        const pts = textPoints(['Strange', 'Attractors'], FAMILY, 300, 140000, 0.6, 0.98)
        text = new PointsSource(engine.size)
        text.fill(pts, 3, 0.0025)
        void dust.morphTo(text, { ...ink(palette, 0.78), toneScale: 0.22, gain: 0.4, twinkle: 0.35 }, { seconds: 3.4, swirl: 1.1 })
      })
    },
    update() {
      driftMotes(cloud, engine.time)
    },
    exit() {
      // the film has begun: a late font load must not pull the dust back into letters
      alive = false
    },
    dispose() {
      alive = false
      text?.dispose()
    },
  }
}

export default title
