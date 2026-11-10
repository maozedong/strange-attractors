/**
 * The zoo. The butterfly pours into one strange attractor after another, each named as it
 * forms, and returns to itself before the film moves on.
 */
import { at, type SceneFactory } from '../film/types'
import { FlowSource } from '../engine/sources'
import { SYSTEMS, getSystem } from '../systems'
import type { SystemId } from '../types'
import { plate as namePlate } from './kit/hud'
import { FLOOR, lorenzFlow, resetLorenz, silk } from './kit/shared'

const zoo: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const lorenz = lorenzFlow(engine)
  /** every source made here, so each can be freed once the dust has left it */
  const made: FlowSource[] = []
  let current: SystemId = 'lorenz'
  let plate: ReturnType<typeof ctx.label> | null = null

  const show = (id: SystemId, seconds = 2.2) => {
    if (id === current) return
    current = id
    const sys = getSystem(id)
    let src: FlowSource
    if (id === 'lorenz') {
      resetLorenz(lorenz)
      src = lorenz
    } else {
      src = new FlowSource(engine.renderer, engine.size, id)
      made.push(src)
    }
    void dust.morphTo(src, silk(palette, src.speedNorm), { seconds, swirl: 0.9 }).then(() => {
      // sources two steps back are no longer read by the dust
      while (made.length > 2) made.shift()?.dispose()
    })
    plate?.remove()
    plate = namePlate(ctx, sys.name, `${sys.credit}, ${sys.year}`)
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      if (dust.source !== lorenz) {
        resetLorenz(lorenz)
        void dust.morphTo(lorenz, silk(palette, lorenz.speedNorm), { seconds: 2.6 })
      } else {
        lorenz.setParam(1, 28)
        dust.look.paintMix = 0
      }
      rig.shot({ target: [0, -0.24, 0], distance: 3.85, elevation: 14, orbit: 4, aperture: 0.004 }, 3)
    },

    cues: [
      at(1, () => show('rossler')),
      at(2, () => show('chua')),
      at(3, () => show('thomas')),
      at(4, () => show('sprottB')),
      at(5, () => show('halvorsen', 1.8)),
      at(5, 'Different shapes', () => show('aizawa', 1.8)),
      at(5, 'The same behaviour', 0.9, () => show('dadras', 1.8)),
      at(6, () => {
        show('lorenz', 3)
        plate?.remove()
        plate = null
      }),
    ],

    exit() {
      plate?.remove()
    },

    dispose() {
      for (const s of made) s.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Attractor',
        options: SYSTEMS.map((s) => ({ value: s.id, label: s.name })),
        get: () => current,
        set: (v) => show(v as SystemId),
      },
      { kind: 'readout', label: 'About', get: () => getSystem(current).tagline },
    ],
    notes: [
      'A strange attractor needs very little: three variables and one nonlinear term are enough. Rössler built his in 1976 to be the simplest example he could find. Chua\'s comes from a real circuit of a few components. Thomas\'s models feedback loops in biology.',
      'In 1994 Julien Clinton Sprott had a computer try millions of simple equation sets and keep the chaotic ones; nineteen survived, labelled A to S. The shapes differ, but all of them stretch, fold, and never repeat.',
    ],
  }
}

export default zoo
