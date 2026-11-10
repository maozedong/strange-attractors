/**
 * Epilogue. The two weathers from the prologue are still running: they agree about nothing,
 * and both are on the butterfly. The paths fade, the shape stays, the camera lets it go, and
 * the dust settles back into the film's name.
 */
import { rampColor } from '../engine/palettes'
import { at, easeInOut, type SceneFactory } from '../film/types'
import { getSystem } from '../systems'
import type { Vec3 } from '../types'
import { readout } from './kit/hud'
import { Paths } from './kit/Paths'
import { FLOOR, LORENZ_SEED, lorenzFlow, resetLorenz, silk } from './kit/shared'
import { TITLE_SHOT, titleLook, titleSource } from './kit/titleText'

const scene: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const sys = getSystem('lorenz')
  const P = sys.params.map((p) => p.default)
  const flow = lorenzFlow(engine)
  const cool = rampColor(palette, 0.26).multiplyScalar(2.6)
  const warm = rampColor(palette, 0.78).multiplyScalar(1.7)
  const paths = new Paths(sys, P, [cool, warm], 1.5)
  paths.opacity = 0
  root.add(paths.object)
  let gap: ReturnType<typeof ctx.label> | null = null
  let memory: ReturnType<typeof ctx.label> | null = null
  let ending = false

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      resetLorenz(flow)
      void dust.morphTo(flow, { ...silk(palette, flow.speedNorm), gain: 0.07 }, { seconds: 3.4, swirl: 1.2 })
      rig.shot({ target: [0, -0.24, 0], distance: 3.9, azimuth: 30, elevation: 12, orbit: 2, aperture: 0.004 }, 3.4)
      // two runs that parted long ago: far apart on the attractor, each going its own way
      const other: Vec3 = [-7.1, -1.6, 30.2]
      paths.start([LORENZ_SEED, other], 1300, true)
      paths.rate = 1.4
    },

    cues: [
      at(0, () => {
        memory = ctx.label('', { kind: 'big', at: { screen: [0.5, 0.42] }, align: 'center' })
        memory.setHtml('0.506<i class="doomed">127</i>')
        ctx.after(3.6, () => memory?.remove())
      }),
      at(1, () => {
        ctx.tween(2.5, (u) => (paths.opacity = u))
        gap = readout(ctx)
      }),
      // "But look at where they both are."
      at(3, () => {
        ctx.tween(5, (u) => (dust.look.gain = 0.07 + 0.43 * u), { ease: easeInOut })
        rig.shot({ distance: 3.5, elevation: 16, orbit: 3 }, 6)
      }),
      at(6, () => {
        gap?.remove()
        gap = null
        ctx.tween(7, (u) => (paths.opacity = 1 - u))
        ctx.tween(7, (u) => (dust.look.gain = 0.5 + 0.12 * u))
      }),
      at(7, () => rig.shot({ distance: 5.2, elevation: 9, orbit: 1.2 }, 12)),
      // after the last word the butterfly lets go and becomes the title again
      at('end', 1.2, () => {
        ending = true
        void titleSource(engine).then((text) => {
          dust.floorY = null
          engine.backdrop.floor = 0
          void dust.morphTo(text, titleLook(palette), { seconds: 4.2, swirl: 1.2 })
          rig.shot(TITLE_SHOT, 4.2)
        })
      }),
    ],

    update(dt) {
      if (!ending) paths.update(dt, engine.renderer.getPixelRatio())
      else {
        paths.opacity = 0
        paths.update(0, engine.renderer.getPixelRatio())
      }
      if (gap && Number.isFinite(paths.gap)) gap.set(`apart by  ${paths.gap.toFixed(1)}`)
    },

    exit() {
      ctx.tween(1.2, (u) => (paths.opacity = Math.min(paths.opacity, 1 - u)))
    },

    dispose() {
      paths.dispose()
    },

    notes: [
      'Lorenz called his 1963 paper "Deterministic Nonperiodic Flow". Deterministic: the equations leave nothing to chance. Nonperiodic: the motion never repeats. Together those two words say that knowing the rules of a system is not the same as knowing its future.',
      'What can be known is the attractor: the set of states the system will ever visit, and how often. That is the difference between weather and climate. Nobody can say whether it will rain in London a year from today. Everybody can say what a London year looks like.',
    ],
  }
}

export default scene
