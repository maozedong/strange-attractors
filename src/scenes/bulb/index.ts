/**
 * The Mandelbulb. A ray-marched solid, no mesh and no model: every pixel asks the distance
 * estimator how far it is to the surface. It begins at power 2, a smooth dull lump (the honest
 * result of every early attempt at a 3D Mandelbrot), and on "Raise the power" the exponent
 * climbs to 8 and the buds break out. Then the camera goes in, to a bud, and to its buds.
 *
 * The bulb is a prop (BulbRenderer, the film's copy of the old renderer with a new shader); the
 * dust is a haze of motes round it. The march runs at an adaptive resolution to hold 60 fps.
 */
import * as THREE from 'three'
import type { Shot } from '../../engine/CameraRig'
import { at, easeInOut, type SceneFactory } from '../../film/types'
import { bulbDistance } from '../../fractal/bulb/de'
import { sound } from '../../sound/audio'
import { plate, readout } from '../kit/hud'
import { driftMotes, haze, motes } from '../kit/shared'
import { BulbRenderer } from './BulbRenderer'

/** world radius of the power-8 bulb's bounding sphere (fractal units × RADIUS / 1.25) */
const RADIUS = 1
const SCALE = RADIUS / 1.25
const POWER_LUMP = 2
const POWER_BULB = 8
/** how far out (fractal units) the lump's surface is drawn: rounds the power-2 shape into a dull blob */
const SOFT_LUMP = 0.12

/**
 * The bud the camera dives to: one of the power-8 bulb's outermost buds (a local maximum of the
 * surface radius, found with bulbDistance), at azimuth 40°, elevation 13°. BUD is its body,
 * TIP the crown of buds on it.
 */
const BUD: [number, number, number] = [0.526, 0.189, 0.627]
const TIP: [number, number, number] = [0.548, 0.197, 0.653]

const bulb: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  /** a shot, held a little closer on a tall screen (the rig's own pull-back is sized for flat subjects) */
  const shot = (s: Shot, seconds: number) =>
    rig.shot(s.distance !== undefined && !s.portrait ? { ...s, portrait: { distance: s.distance * 0.8 } } : s, seconds)
  const renderer = new BulbRenderer()
  renderer.setRamp(palette.ramp)
  renderer.setFog(palette.sky)
  renderer.opacity = 0
  const mesh = new THREE.Mesh(renderer.geometry, renderer.material)
  mesh.rotation.x = -Math.PI / 2 // fractal +z (the pole) up
  mesh.scale.setScalar(SCALE)
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.onBeforeRender = (r, _scene, camera) => renderer.render(r, camera, mesh)
  root.add(mesh)

  let ready = false
  let alive = true
  void renderer.compile(engine.renderer, rig.camera).then(
    () => alive && (ready = true),
    (e: unknown) => {
      console.error('[bulb] shader compile', e)
      if (alive) ready = true
    },
  )

  const haze_ = motes(engine)
  let power = POWER_LUMP
  let soft = SOFT_LUMP
  let fade = 0
  let last = 0
  let dial: ReturnType<typeof ctx.label> | null = null

  const raise = (to: number, seconds: number) => {
    const from = power
    const soft0 = soft
    ctx.tween(
      seconds,
      (u) => {
        power = from + (to - from) * u
        // the rounding goes first, so the buds are seen to break out as the power climbs
        soft = soft0 * (1 - Math.min(1, u * 1.6)) ** 2
      },
      { ease: easeInOut, tag: 'power' },
    )
  }

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0
      const look = { ...haze(palette), gain: 0.06, size: 0.0045 }
      if (dust.source !== haze_) void dust.morphTo(haze_, look, { seconds: 3, swirl: 0.8 })
      else {
        const g0 = dust.look.gain
        ctx.tween(2, (u) => (dust.look.gain = g0 + (look.gain - g0) * u))
      }
      ctx.tween(2.6, (u) => (fade = u), { tag: 'fade' })
      shot({ target: [0, 0.24, 0], distance: 5.6, azimuth: 30, elevation: 14, fov: 38, orbit: 2.5, aperture: 0.004 }, 3)
    },

    cues: [
      // "Raise the power."
      at(3, () => {
        // most of the way there as the narrator names it, settled just after
        raise(POWER_BULB, Math.max(3, ctx.until(4, 'Mandelbulb') + 1.4))
        sound.sfx('rise', 0.5)
        dial = readout(ctx)
        // the lump condenses into the bulb: come in with it
        shot({ target: [0, -0.1, 0], distance: 3.7, elevation: 18, orbit: 4 }, 5.5)
      }),
      at(4, 'Mandelbulb', () => {
        plate(ctx, 'Mandelbulb', 'White and Nylander, 2009')
      }),
      at(5, () => {
        dial?.remove()
        dial = null
        // slow push in while the narrator says there is no model
        shot({ distance: 3.15, elevation: 22, orbit: 2.4, aperture: 0.004 }, 9)
      }),
      // "Go closer. Every bud has buds."
      at(7, -0.5, () => {
        shot({ target: BUD, distance: 0.55, azimuth: 80, elevation: 18, orbit: -0.8, aperture: 0.006, portrait: { distance: 0.62 } }, 3.0)
      }),
      // "And those have buds."
      at(8, () => {
        shot({ target: TIP, distance: 0.2, azimuth: 66, elevation: 24, orbit: -0.5, portrait: { distance: 0.23 } }, 4)
      }),
    ],

    explore() {
      // straight to the finished bulb, close enough to see the buds
      raise(POWER_BULB, 2.2)
      shot({ target: [0, -0.1, 0], distance: 3.5, elevation: 20, orbit: 3 }, 3)
    },

    update(dt) {
      driftMotes(haze_, engine.time)
      const now = performance.now()
      // the frame rate the march resolution is governed by; capture frames count as on time
      const interval = engine.manual || last === 0 ? 1000 / 60 : now - last
      last = now
      renderer.prepare(power, dt, interval, 1, soft)
      dial?.set(`power  ${power.toFixed(1)}`)
      mesh.visible = ready && fade > 0.001
      renderer.opacity = fade
    },

    exit() {
      const from = fade
      ctx.tween(2.4, (u) => (fade = from * (1 - u)), { tag: 'fade' })
    },

    dispose() {
      alive = false
      root.remove(mesh)
      renderer.dispose()
    },

    lab: [
      {
        kind: 'slider',
        label: 'Power',
        min: 2,
        max: 12,
        step: 0.1,
        get: () => power,
        set: (v) => {
          ctx.cancel('power')
          power = v
          soft = 0
        },
        format: (v) => v.toFixed(1),
      },
      { kind: 'action', label: 'Back to 8', run: () => raise(POWER_BULB, 2.5) },
      {
        kind: 'readout',
        label: 'Camera to surface',
        get: () => {
          const p = rig.camera.position
          return bulbDistance(p.x, p.y, p.z, power, RADIUS).toFixed(3)
        },
      },
    ],
    notes: [
      'The Mandelbrot set lives in the plane of complex numbers, where squaring a number doubles its angle. Three-dimensional space has no such multiplication, so for decades every attempt at a 3D Mandelbrot came out as a smooth, featureless blob. In 2009 Daniel White and Paul Nylander, on the Fractal Forums, replaced multiplication with a rotation in spherical coordinates: raise the length to the n-th power and multiply both angles by n. At n = 2 it is still a lump; at n = 8 it breaks into buds, and buds on buds.',
      'Nothing here is a mesh. For each pixel the graphics card marches a ray forward, asking a distance estimate at every step how far the nearest point of the set could be, and steps that far. Shadows, the occlusion in the folds and the colour (how far each point\'s orbit strayed before it escaped) all come from the same formula.',
      'Drag to turn it, scroll to go closer. Unlike the Mandelbrot set, the bulb is not known to be a true fractal all the way down: its surface may be smooth in places. But in practice the detail does not run out at any zoom a screen can show.',
    ],
  }
}

export default bulb
