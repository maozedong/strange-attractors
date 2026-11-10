/**
 * The leopard's spots. Turing's two chemicals (Gray–Scott: U + 2V → 3V, V → P) react and diffuse
 * over a slowly turning ball, read as an animal's coat. It begins bare. On "the faintest flicker
 * of noise" a fine scatter of specks is laid on it, and the pattern invents itself: a labyrinth.
 * Then the dials turn: the maze straightens into stripes, the stripes break into dividing cells,
 * and the cells settle into spots.
 *
 * The simulation is the film's copy of the old TuringSim (a reduced equirectangular grid that is
 * stable at the poles); the coat is a new shader in the act's ramp. The dust is a haze of motes.
 */
import * as THREE from 'three'
import type { Shot } from '../../engine/CameraRig'
import { at, easeInOut, type SceneFactory } from '../../film/types'
import { sound } from '../../sound/audio'
import { glideDials, snapDials, type Dials } from '../../world/turing/glide'
import { TURING_PRESETS } from '../../world/turing/presets'
import { readout } from '../kit/hud'
import { FLOOR, driftMotes, haze, motes } from '../kit/shared'
import { coatFrag, coatVert } from './shaders'
import { TuringSim } from './TuringSim'

const RADIUS = 1
/** toward the key light in view space: upper left, in front */
const KEY_DIR = new THREE.Vector3(-0.5, 0.62, 0.6).normalize()
/** a fine scatter of specks all over the coat: the "flicker of noise" the pattern grows from */
const FLICKER = { discs: 1400, radius: 2, noise: 0.02, seed: 0x5eed }
const BARE = { discs: 0, noise: 0 }
/** most Gray–Scott steps in one frame (each is one pass over a 1024 × 512 grid) */
const MAX_STEPS_PER_FRAME = 54
/** the dials' glide toward a new preset, in steps */
const GLIDE = 420
/** the film's usual pace, steps per second */
const PACE = 1500

const preset = (id: string) => TURING_PRESETS.find((p) => p.id === id) ?? TURING_PRESETS[2]

const turing: SceneFactory = (ctx) => {
  let stepCount = 0
  const { engine, dust, rig, palette, root } = ctx
  /** a shot, held a little closer on a tall screen (the rig's own pull-back is sized for flat subjects) */
  const shot = (s: Shot, seconds: number) =>
    rig.shot(s.distance !== undefined && !s.portrait ? { ...s, portrait: { distance: s.distance * 0.8 } } : s, seconds)
  let sim: TuringSim | null = null
  try {
    sim = new TuringSim(engine.renderer)
    sim.reset(BARE)
  } catch (e) {
    console.error('[turing] GPU simulation unavailable:', e instanceof Error ? e.message : e)
  }

  const uniforms = {
    uState: { value: sim?.texture ?? null },
    uRows: { value: sim?.rowTexture ?? null },
    uKey: { value: KEY_DIR.clone() },
    uRamp: { value: palette.ramp.map((c) => new THREE.Vector3(c.r, c.g, c.b)) },
    uOpacity: { value: 0 },
    uMirror: { value: 0 },
    uFloorY: { value: FLOOR },
    uGrow: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({ name: 'turing.coat', vertexShader: coatVert, fragmentShader: coatFrag, uniforms, transparent: true, toneMapped: false })
  const mirrorUniforms = { ...uniforms, uMirror: { value: 1 }, uOpacity: { value: 0 } }
  const mirrorMaterial = new THREE.ShaderMaterial({
    name: 'turing.reflection',
    vertexShader: coatVert,
    fragmentShader: coatFrag,
    uniforms: mirrorUniforms,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  const geometry = new THREE.SphereGeometry(RADIUS, 128, 80)
  const ball = new THREE.Mesh(geometry, material)
  const reflection = new THREE.Mesh(geometry, mirrorMaterial)
  // the ball rests on the floor; its reflection hangs under it
  ball.position.y = FLOOR + RADIUS + 0.02
  reflection.position.y = 2 * FLOOR - ball.position.y
  reflection.scale.y = -1
  reflection.renderOrder = -1
  root.add(ball, reflection)

  const haze_ = motes(engine)
  const dials: Dials = { f: 0.037, k: 0.06, vf: 0, vk: 0 }
  let target = { f: 0.037, k: 0.06 }
  let presetId = 'labyrinth'
  /** steps per second; 0 = still */
  let rate = 0
  let owed = 0
  let frozen = false
  let fade = 0
  let figure: ReturnType<typeof ctx.label> | null = null

  const goTo = (id: string) => {
    const p = preset(id)
    presetId = p.id
    target = { f: p.feed, k: p.kill }
  }

  /** lay the flicker of noise on a bare coat and let it grow */
  const sow = (pace = PACE) => {
    if (!sim) return
    sim.reset(FLICKER)
    snapDials(dials, target.f, target.k)
    owed = 0
    stepCount = 0
    rate = pace
    uniforms.uGrow.value = 0
    ctx.tween(1.6, (u) => (uniforms.uGrow.value = u), { tag: 'grow' })
    sound.sfx('shimmer', 0.35)
  }

  const setOpacity = (v: number) => {
    uniforms.uOpacity.value = v
    mirrorUniforms.uOpacity.value = v
    material.depthWrite = v > 0.98
  }
  setOpacity(0)

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      const look = { ...haze(palette), gain: 0.07 }
      if (dust.source !== haze_) void dust.morphTo(haze_, look, { seconds: 3, swirl: 0.8 })
      else {
        const g0 = dust.look.gain
        ctx.tween(2, (u) => (dust.look.gain = g0 + (look.gain - g0) * u))
      }
      ctx.tween(2.6, (u) => (fade = u), { tag: 'fade' })
      shot({ target: [0, -0.06, 0], distance: 4.6, azimuth: 20, elevation: 9, fov: 38, orbit: 0, aperture: 0.003 }, 3)
    },

    cues: [
      // "His answer was two chemicals, spreading through the skin at different speeds."
      at(1, () => shot({ distance: 4.1, elevation: 12 }, 9)),
      // "add the faintest flicker of noise…"
      at(3, 'faintest', () => {
        goTo('labyrinth')
        // the specks only swell a little while the line ends...
        sow(40)
        figure = readout(ctx)
        shot({ distance: 3.9, elevation: 14, azimuth: 35 }, 6)
      }),
      // "…and the pattern invents itself." ...then the maze grows over the whole line
      at(4, () => {
        rate = Math.min(3000, 1500 / Math.max(1.5, ctx.until(5) - 0.4))
      }),
      // "Turn a dial, and the maze straightens into stripes."
      at(5, 'Turn a dial', () => {
        goTo('stripes')
        rate = 3200
      }),
      // "Further, and the stripes break into cells that divide."
      at(6, () => {
        goTo('mitosis')
        rate = 3000
        shot({ distance: 3.75, azimuth: 60, elevation: 17 }, 6)
      }),
      // "Then the cells settle into spots."
      at(6, 'settle', () => {
        goTo('spots')
        rate = 2400
      }),
      // "The leopard and the zebra are the same equation"
      at(7, () => {
        rate = 900
        shot({ distance: 3.35, elevation: 13, azimuth: 80 }, 10)
      }),
      at(8, () => shot({ distance: 3.15, elevation: 11 }, 8)),
    ],

    explore() {
      // a coat already growing; the presets and dials are in the drawer
      ctx.after(0.4, () => {
        goTo('labyrinth')
        sow(1200)
        figure = readout(ctx)
      })
      shot({ distance: 3.6, elevation: 14, azimuth: 35, orbit: 1.5 }, 3)
    },

    update(dt) {
      driftMotes(haze_, engine.time)
      if (sim && !frozen && rate > 0 && dt > 0) {
        owed += Math.min(dt, 0.1) * rate
        const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(owed))
        // a slow frame slows the clock rather than bursting later
        owed = Math.min(owed - steps, 0.999)
        if (steps > 0) {
          glideDials(dials, target.f, target.k, steps, GLIDE)
          sim.step(steps, dials.f, dials.k)
          stepCount += steps
        }
      }
      if (sim) uniforms.uState.value = sim.texture
      ball.rotation.y = (ball.rotation.y + 0.07 * dt) % (Math.PI * 2)
      reflection.rotation.y = ball.rotation.y
      setOpacity(fade)
      ball.visible = reflection.visible = fade > 0.001
      figure?.set(`feed ${dials.f.toFixed(3)}   kill ${dials.k.toFixed(3)}`)
    },

    exit() {
      const from = fade
      ctx.tween(2.4, (u) => (fade = from * (1 - u)), { ease: easeInOut, tag: 'fade' })
    },

    dispose() {
      root.remove(ball, reflection)
      geometry.dispose()
      material.dispose()
      mirrorMaterial.dispose()
      sim?.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Coat',
        options: TURING_PRESETS.map((p) => ({ value: p.id, label: p.label })),
        get: () => presetId,
        set: (v) => {
          goTo(v)
          if (rate === 0) sow(1200)
          rate = Math.max(rate, 1200)
        },
      },
      {
        kind: 'slider',
        label: 'Feed',
        min: 0.01,
        max: 0.08,
        step: 0.0005,
        get: () => target.f,
        set: (v) => {
          target = { ...target, f: v }
          presetId = ''
        },
        format: (v) => v.toFixed(4),
      },
      {
        kind: 'slider',
        label: 'Kill',
        min: 0.045,
        max: 0.07,
        step: 0.0005,
        get: () => target.k,
        set: (v) => {
          target = { ...target, k: v }
          presetId = ''
        },
        format: (v) => v.toFixed(4),
      },
      { kind: 'action', label: 'Start from bare skin', run: () => sow(1200) },
      { kind: 'readout', label: 'Steps since the noise', get: () => stepCount.toLocaleString('en-US') },
      { kind: 'toggle', label: 'Freeze', get: () => frozen, set: (v) => (frozen = v) },
    ],
    notes: [
      'In 1952 Alan Turing proposed that two substances could make a pattern from nothing, if one (the activator) makes more of itself and the other (the inhibitor) spreads faster and shuts it down. A small bump of activator grows, but the inhibitor it makes races ahead and stops its neighbours. The distance the inhibitor can travel sets the size of the spots.',
      'This is the Gray–Scott model, a simple chemistry with that character: U is fed in at rate f, V is removed at rate f + k, and U + 2V turns into 3V. U diffuses twice as fast as V. Spots, stripes, mazes, dividing cells and holes all come from the same two equations; only f and k change. The pattern also remembers its past: a field of spots does not turn back into stripes when you return the dials.',
      'The chemistry runs on a sphere of half a million cells, on your graphics card, about fifteen hundred steps a second. In 1990 Patrick De Kepper\'s group in Bordeaux finally saw Turing spots form in a gel reactor, almost forty years after the paper.',
    ],
  }
}

export default turing
