/**
 * The shape it can't leave. The scrambled swarm, repainted by speed, is the attractor. A wide
 * rain of new points falls onto it; the camera goes in close enough to see the sheets; the
 * still points are marked.
 */
import * as THREE from 'three'
import { at, easeInOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { getSystem } from '../systems'
import { FLOOR, lorenzFlow, resetLorenz, silk } from './kit/shared'

const shape: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const flow = lorenzFlow(engine)
  const sys = getSystem('lorenz')
  const rings: ReturnType<typeof ctx.label>[] = []
  let figure: ReturnType<typeof ctx.label> | null = null

  const rain = () => {
    const f = sys.frame(flow.params)
    // freeze the picture, scatter the particles, and let them be seen flying out and falling back
    const look = { ...dust.look }
    dust.setSource(dust.bake(), look)
    flow.spawnCloud(f.center, 1.15 / f.scale)
    sound.sfx('shimmer', 0.35)
    void dust.morphTo(flow, look, { seconds: 1.1, swirl: 0.15 })
    flow.paused = false
    flow.speed = 0.5
    ctx.tween(5, (u) => (flow.speed = 0.5 + 0.5 * u), { tag: 'speed' })
  }

  const markEyes = (on: boolean) => {
    while (rings.length) rings.pop()?.remove()
    if (!on) return
    const pts = sys.fixedPoints?.(flow.params) ?? []
    for (const p of pts.slice(1)) {
      const w = flow.toWorld(p, new THREE.Vector3())
      rings.push(ctx.label('', { kind: 'note', at: w, align: 'center' }))
      rings[rings.length - 1].el.classList.add('label--ring')
    }
    const first = pts[1]
    if (first) rings.push(ctx.label('the air could rest here', { kind: 'note', at: flow.toWorld(first, new THREE.Vector3()), align: 'right', dx: 22, dy: -4 }))
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      flow.paused = false
      flow.speed = 1
      const target = silk(palette, flow.speedNorm)
      if (dust.source !== flow) {
        resetLorenz(flow)
        void dust.morphTo(flow, target, { seconds: 2.6 })
      } else {
        // carried over from the swarm: fade from "where it started" to "how fast it moves"
        const look = dust.look
        look.paint = flow.paint
        const mix0 = look.paintMix
        const g0 = look.gain
        const s0 = look.size
        ctx.tween(4, (u) => {
          look.paintMix = mix0 * (1 - u)
          look.gain = g0 + (target.gain - g0) * u
          look.size = s0 + (target.size - s0) * u
        })
      }
      rig.shot({ target: [0, -0.24, 0], distance: 3.65, elevation: 13, orbit: 3, aperture: 0.004 }, 3)
    },

    cues: [
      at(2, rain),
      // "it isn't a surface, and it isn't a solid": turn until the wings are seen edge on, thin as blades
      at(4, () => {
        rig.shot({ target: [0, 0.05, 0], distance: 2.1, azimuth: 150, elevation: 9, orbit: 1.2, aperture: 0.006 }, 7)
      }),
      at(6, () => {
        figure = ctx.label('2.06', { kind: 'big', at: { screen: [0.5, 0.5] }, align: 'center' })
        ctx.after(4.2, () => figure?.remove())
      }),
      at(7, () => {
        rig.shot({ target: [0, -0.24, 0], distance: 3.45, azimuth: 205, elevation: 12, orbit: 2.4, aperture: 0.004 }, 5)
        ctx.after(2.6, () => markEyes(true))
      }),
      at(8, 2.5, () => markEyes(false)),
    ],

    // nothing to stage: the opening picture is already the thing to play with
    explore() {},

    dispose() {
      // the butterfly stays
    },

    lab: [
      { kind: 'action', label: 'Rain points onto it', run: rain },
      { kind: 'toggle', label: 'Mark the still points', get: () => rings.length > 0, set: markEyes },
      { kind: 'choice', label: 'Colour each point by', options: [{ value: 'speed', label: 'its speed' }, { value: 'origin', label: 'where it started' }], get: () => (dust.look.paintMix > 0.5 ? 'origin' : 'speed'), set: (v) => {
        dust.look.paint = flow.paint
        const from = dust.look.paintMix
        const to = v === 'origin' ? 1 : 0
        ctx.tween(1.2, (u) => (dust.look.paintMix = from + (to - from) * u), { ease: easeInOut })
      } },
    ],
    notes: [
      'An attractor is a set of states that nearby states are drawn toward. Simple attractors are a point (a pendulum coming to rest) or a loop (a clock ticking). This one is neither.',
      'Because the flow keeps stretching and folding, the attractor is made of infinitely many layers. Measured by how the number of boxes needed to cover it grows as the boxes shrink, its dimension is about 2.06: more than a surface, less than a solid.',
      'Paths never cross: at any point the equations give exactly one direction. The unpredictability comes only from not knowing which path you are on.',
    ],
  }
}

export default shape
