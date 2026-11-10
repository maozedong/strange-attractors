/**
 * Stands in for a scene whose pictures are not built yet: the narration and captions play over
 * the drifting dust, so the film can always be watched end to end.
 */
import type { SceneFactory } from '../film/types'
import { driftMotes, haze, motes } from './kit/shared'

const placeholder: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const cloud = motes(engine)
  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0.4
      void dust.morphTo(cloud, { ...haze(palette), gain: 0.2 }, { seconds: 3, swirl: 1.2 })
      rig.shot({ target: [0, 0, 0], distance: 4, azimuth: 0, elevation: 6, orbit: 1.5, aperture: 0.006 }, 3)
    },
    update() {
      driftMotes(cloud, engine.time)
    },
    dispose() {},
  }
}

export default placeholder
