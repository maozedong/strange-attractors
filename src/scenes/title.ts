/**
 * The title. The dust drifts in as a loose cloud and settles into the words; when the film
 * begins the letters let go and become the first scene.
 */
import type { SceneFactory } from '../film/types'
import { driftMotes, haze, motes } from './kit/shared'
import { TITLE_SHOT, titleLook, titleSource } from './kit/titleText'

const title: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const cloud = motes(engine)
  let alive = true

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0
      dust.setSource(cloud, haze(palette))
      rig.shot(TITLE_SHOT, 0)
      void titleSource(engine).then((text) => {
        if (alive) void dust.morphTo(text, titleLook(palette), { seconds: 3.4, swirl: 1.1 })
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
    },
  }
}

export default title
