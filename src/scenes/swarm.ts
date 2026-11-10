/**
 * The swarm. A quarter of a million starting points packed into a ball too small to see,
 * coloured by where each sits inside it. On the visitor's click they are released: the ball is
 * drawn into a thread, folded, drawn again, until the colours are scrambled over the whole shape.
 */
import * as THREE from 'three'
import { at, easeOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { readout } from './kit/hud'
import { rk4Step } from '../sim/cpu'
import { getSystem } from '../systems'
import { FLOOR, LORENZ_SEED, lorenzFlow, resetLorenz, silk } from './kit/shared'

/** radius of the starting ball, system units */
const BALL = 1e-3
/**
 * Brightness of one particle while all of them share a pixel, and once they are spread over
 * the attractor. The light adds up, so the packed ball must be dimmer per particle by about
 * the factor it will later be diluted by.
 */
const GAIN_PACKED = 5e-4
const GAIN_SPREAD = 0.62
/** the thread grows about this fast (per unit of system time) once released */
const GROWTH = 0.6

const swarm: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const flow = lorenzFlow(engine)
  const sys = getSystem('lorenz')
  const dot = new THREE.Vector3()
  /** one path from the middle of the ball, so the camera can stay with the swarm as it leaves */
  const centre = new Float64Array(LORENZ_SEED)
  let centreTime = 0
  let following = false
  let released = false
  /** the film is setting the speed (the lab slider takes over) */
  let paced = false
  let count: ReturnType<typeof ctx.label> | null = null
  let clock: ReturnType<typeof ctx.label> | null = null

  const pack = () => {
    released = false
    flow.palette = palette
    flow.setParam(1, 28)
    flow.spawnCloud(LORENZ_SEED, BALL)
    flow.paused = true
    flow.speed = 1
    flow.toWorld(LORENZ_SEED, dot)
    centre.set(LORENZ_SEED)
    centreTime = 0
    following = false
  }

  const release = () => {
    if (released) return
    released = true
    sound.sfx('release', 0.8)
    count?.remove()
    flow.paused = false
    paced = true
    ctx.tween(8, (u) => (dust.look.size = 0.0045 + (0.0028 - 0.0045) * u), { ease: easeOut, tag: 'size' })
    // stay with the thread while it is drawn out, backing away as it grows; then settle on the whole shape
    rig.shot({ distance: 3.5, elevation: 10, aperture: 0.003 }, 8)
    following = true
    rig.track((target) => {
      if (following) target.copy(flow.toWorld([centre[0], centre[1], centre[2]], dot))
    })
    ctx.after(8, () => {
      following = false
      rig.shot({ target: [0, -0.24, 0], distance: 3.75, azimuth: 205, elevation: 12, orbit: 2.2, aperture: 0.004 }, 5)
    })
    clock = readout(ctx)
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      if (dust.source === flow) {
        // the butterfly is already on screen: freeze it where it is, so it can fall into the dot
        const was = { ...dust.look }
        dust.setSource(dust.bake(), was)
      } else {
        resetLorenz(flow)
      }
      pack()
      // one bright dot: every particle is inside it
      const look = { ...silk(palette, flow.speedNorm), paint: flow.paint, paintMix: 1, gain: GAIN_PACKED, size: 0.0045, streak: 0.1 }
      void dust.morphTo(flow, look, { seconds: 2.8, swirl: 0.7 })
      rig.shot({ target: [dot.x, dot.y, dot.z], distance: 1.25, azimuth: 205, elevation: 8, orbit: 0, aperture: 0.002 }, 2.6)
    },

    cues: [
      at(1, 'packed into', () => {
        count = ctx.label(`${flow.sim.count.toLocaleString('en-US')} points`, { kind: 'note', at: dot.clone(), align: 'right', dx: 26, dy: -8, leader: true })
      }),
    ],

    gates: { release },

    // the packed ball is the starting position; "Let them go" is in the drawer
    explore() {},

    update() {
      if (released) clock?.set(`time  ${flow.simTime.toFixed(1)}`)
      if (released) {
        const t = flow.simTime
        // the ball's light spreads over a longer and longer thread: bring each particle up to match
        dust.look.gain = Math.min(GAIN_SPREAD, GAIN_PACKED * Math.exp(GROWTH * t))
        // nothing can be seen for the first few units (the ball is still a dot), so hurry through
        // them; linger while the thread is drawn out and folded; then let it run
        if (paced) flow.speed = t < 5 ? 1.5 : t < 13 ? 0.3 : Math.min(1, 0.3 + (t - 13) * 0.12)
      }
      // keep the tracer in step with the swarm's own clock
      while (centreTime + sys.dt <= flow.simTime) {
        rk4Step(sys, centre, flow.params, sys.dt)
        centreTime += sys.dt
      }
    },

    dispose() {
      // the butterfly stays for the next scene
    },

    lab: [
      { kind: 'action', label: 'Pack them back in', run: () => {
        pack()
        dust.look.gain = GAIN_PACKED
        dust.look.size = 0.0045
        paced = false
        ctx.cancel('size')
      } },
      { kind: 'action', label: 'Let them go', run: release },
      { kind: 'slider', label: 'Speed', min: 0.1, max: 3, step: 0.05, get: () => flow.speed, set: (v) => {
        paced = false
        flow.speed = v
      }, format: (v) => `×${v.toFixed(2)}` },
      { kind: 'readout', label: 'Time since release', get: () => (released ? flow.simTime.toFixed(1) : '0.0') },
    ],
    notes: [
      'Every particle is a separate copy of the same three equations, integrated on your graphics card. They start inside a ball one thousandth of a unit across and are coloured by where they sit in it.',
      'The flow stretches the ball in one direction and squeezes it in another, then folds the long thread back on itself. Stretch and fold, again and again: after a few dozen units of time, points that began as neighbours can be anywhere on the attractor. Nothing random has happened. The information in the starting position has simply been spread too thin to read.',
    ],
  }
}

export default swarm
