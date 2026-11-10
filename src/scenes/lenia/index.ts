/**
 * Creatures nobody drew. A pond on the floor. It starts as the Game of Life, hard squares
 * that tick between alive and dead; on "made it smooth" the squares soften and time starts to
 * flow; then the pond fills with Lenia (Bert Chan, 2019) and the creatures turn up: orbia
 * swimming in lanes. The camera goes down to the water and follows one, which takes a knock on
 * "nudge one" and recovers. Two more species flash by, and the orbia come back, seen wide.
 *
 * The simulation is the film's copy of the old LeniaSim; the pond is a new display shader in
 * the act's ramp. The Game of Life runs on the CPU on a 64 × 64 torus. The dust is a haze.
 */
import * as THREE from 'three'
import type { Shot } from '../../engine/CameraRig'
import { at, easeInOut, type SceneFactory } from '../../film/types'
import { sound } from '../../sound/audio'
import type { QuarterTurns } from '../../world/lenia/core'
import { LENIA_SPECIES, getSpecies } from '../../world/lenia/species'
import { plate } from '../kit/hud'
import type { Engine } from '../../engine/Engine'
import { PointsSource } from '../../engine/sources'
import { FLOOR, driftMotes, haze } from '../kit/shared'
import { LeniaSim } from './LeniaSim'
import { LENIA_GRID, TELE_GRID, displayFrag, displayVert } from './shaders'

/** world edge of the dish (one period of the torus); the visible pond is a disc inside it */
const POND = 4
const N = LENIA_GRID
/** the Game of Life grid */
const LIFE = 64
/** generations per second */
const SPEED = 10
const MAX_STEPS_PER_FRAME = 2
const BLOCK = N / TELE_GRID

type Spot = { x: number; y: number; turns: QuarterTurns }

/** an unrotated Orbium swims along this direction (cells), about 0.55 cells a generation */
const HEADING = { x: 0.42, y: 0.91 }

/**
 * Orbia in lanes, all parallel so none ever meets another: the hero first, crossing the
 * middle of the pond while the camera is with it, two lanes either side of it going the same
 * way, and two further out swimming against them.
 */
function orbiumLayout(): Spot[] {
  const d = HEADING
  const p = { x: d.y, y: -d.x }
  const at = (lane: number, along: number, turns: QuarterTurns): Spot => ({
    x: (128 + lane * p.x + along * d.x) / N,
    y: (128 + lane * p.y + along * d.y) / N,
    turns,
  })
  return [at(0, -24, 0), at(34, -6, 0), at(-34, 10, 0), at(68, 14, 2), at(-68, -12, 2), at(102, -20, 0), at(-102, 30, 2)]
}

/** a few of another species, spread round the middle */
function scatterLayout(): Spot[] {
  return [
    { x: 0.5, y: 0.5, turns: 0 },
    { x: 0.5 + 0.23, y: 0.5 + 0.05, turns: 1 },
    { x: 0.5 - 0.2, y: 0.5 + 0.17, turns: 2 },
    { x: 0.5 - 0.06, y: 0.5 - 0.23, turns: 3 },
    { x: 0.5 + 0.18, y: 0.5 - 0.2, turns: 1 },
  ]
}

/**
 * Haze hanging low over the pond, thickest just above the water, so a low camera looks through
 * it. Made once per engine and kept (the next scene's dust may still be leaving it when this
 * scene is disposed).
 */
const pondHazes = new WeakMap<Engine, PointsSource>()
function pondHaze(engine: Engine): PointsSource {
  let src = pondHazes.get(engine)
  if (src) return src
  src = new PointsSource(engine.size)
  const d = src.data
  let seed = 0x6c0ffee
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < src.count; i++) {
    const r = 0.2 + 5.2 * Math.pow(rnd(), 0.75)
    const a = rnd() * Math.PI * 2
    const o = i * 4
    d[o] = r * Math.cos(a)
    d[o + 1] = FLOOR + 0.05 + 2.2 * Math.pow(rnd(), 1.5)
    d[o + 2] = r * Math.sin(a)
    d[o + 3] = rnd()
  }
  src.commit()
  pondHazes.set(engine, src)
  return src
}

const lenia: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  /** a shot, held a little closer on a tall screen (the rig's own pull-back is sized for flat subjects) */
  const shot = (s: Shot, seconds: number) =>
    rig.shot(s.distance !== undefined && !s.portrait ? { ...s, portrait: { distance: s.distance * 0.7 } } : s, seconds)
  let sim: LeniaSim | null = null
  try {
    sim = new LeniaSim(engine.renderer)
  } catch (e) {
    console.error('[lenia] GPU simulation unavailable:', e instanceof Error ? e.message : e)
  }

  // ── the Game of Life, on the CPU ──
  const life = new Uint8Array(LIFE * LIFE)
  const lifeNext = new Uint8Array(LIFE * LIFE)
  const lifeTex = [0, 1].map(() => {
    const t = new THREE.DataTexture(new Uint8Array(LIFE * LIFE), LIFE, LIFE, THREE.RedFormat, THREE.UnsignedByteType)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  })
  let rand = 0x2545f491
  const random = () => {
    rand ^= rand << 13
    rand ^= rand >>> 17
    rand ^= rand << 5
    return (rand >>> 0) / 4294967296
  }
  const soup = () => {
    for (let y = 0; y < LIFE; y++) {
      for (let x = 0; x < LIFE; x++) {
        const r = Math.hypot(x + 0.5 - LIFE / 2, y + 0.5 - LIFE / 2) / (LIFE / 2)
        life[y * LIFE + x] = random() < (r < 0.8 ? 0.34 : 0.12) ? 1 : 0
      }
    }
  }
  const lifeStep = () => {
    for (let y = 0; y < LIFE; y++) {
      for (let x = 0; x < LIFE; x++) {
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx || dy) n += life[((y + dy + LIFE) % LIFE) * LIFE + ((x + dx + LIFE) % LIFE)]
          }
        }
        const alive = life[y * LIFE + x]
        lifeNext[y * LIFE + x] = n === 3 || (alive && n === 2) ? 1 : 0
      }
    }
    life.set(lifeNext)
  }
  /** upload: the texture shown as "previous" becomes the new current */
  let lifeCur = 0
  const lifeUpload = () => {
    lifeCur = 1 - lifeCur
    const t = lifeTex[lifeCur]
    const data = t.image.data as Uint8Array
    for (let i = 0; i < life.length; i++) data[i] = life[i] * 255
    t.needsUpdate = true
  }

  // ── the pond ──
  const uniforms = {
    uLook: { value: sim?.lookTexture ?? null },
    uHalo: { value: sim?.haloTexture ?? null },
    uLife: { value: lifeTex[0] as THREE.Texture },
    uLifePrev: { value: lifeTex[1] as THREE.Texture },
    uLifeN: { value: LIFE },
    uLifeMix: { value: 1 },
    uSmooth: { value: 0 },
    uLenia: { value: 0 },
    uOpacity: { value: 0 },
    uRamp: { value: palette.ramp.map((c) => new THREE.Vector3(c.r, c.g, c.b)) },
    uCamPos: { value: new THREE.Vector3() },
  }
  const material = new THREE.ShaderMaterial({
    name: 'lenia.pond',
    vertexShader: displayVert,
    fragmentShader: displayFrag,
    uniforms,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  const geometry = new THREE.PlaneGeometry(POND, POND)
  const pond = new THREE.Mesh(geometry, material)
  pond.rotation.x = -Math.PI / 2
  pond.position.y = FLOOR + 0.004
  pond.renderOrder = -1
  root.add(pond)

  /** grid cell → world */
  const toWorld = (cx: number, cy: number, out: THREE.Vector3) => out.set((cx / N - 0.5) * POND, FLOOR, -(cy / N - 0.5) * POND)

  const haze_ = pondHaze(engine)
  let speciesId = 'orbium'
  let speed = SPEED
  let running = false
  let acc = 0
  let generation = 0
  let lifeClock = 0
  let lifeTick = 0.42
  let lifeOn = true
  let fade = 0
  /** the hero's centre in cells, unwrapped, and whether the camera is with it */
  const hero = { x: 0, y: 0 }
  let following = false
  const heroWorld = new THREE.Vector3()
  let statsIn = 0

  const hatch = (id: string) => {
    if (!sim) return
    speciesId = id
    const sp = getSpecies(id)
    sim.setSpecies(sp)
    const layout = id === 'orbium' ? orbiumLayout() : scatterLayout()
    sim.seed(sp, layout)
    hero.x = layout[0].x * N
    hero.y = layout[0].y * N
    generation = 0
    acc = 0
    running = true
    sim.present(0)
  }

  /** follow the hero: the mass-weighted centre of the blocks near where it was */
  const trackHero = () => {
    if (!sim) return
    const b = sim.blocks
    const bx0 = Math.floor(hero.x / BLOCK)
    const by0 = Math.floor(hero.y / BLOCK)
    let m = 0
    let sx = 0
    let sy = 0
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const bx = (((bx0 + dx) % TELE_GRID) + TELE_GRID) % TELE_GRID
        const by = (((by0 + dy) % TELE_GRID) + TELE_GRID) % TELE_GRID
        const w = b[(by * TELE_GRID + bx) * 4]
        if (!(w > 0)) continue
        m += w
        sx += w * ((bx0 + dx + 0.5) * BLOCK)
        sy += w * ((by0 + dy + 0.5) * BLOCK)
      }
    }
    if (m > 5) {
      hero.x += (sx / m - hero.x) * 0.25
      hero.y += (sy / m - hero.y) * 0.25
    }
  }

  const follow = (framing: { distance: number; elevation: number; azimuth?: number; orbit?: number }, seconds: number) => {
    toWorld(hero.x, hero.y, heroWorld)
    shot({ target: [heroWorld.x, heroWorld.y, heroWorld.z], ...framing, aperture: 0.007 }, seconds)
    following = true
    rig.track((t) => {
      if (following) t.copy(toWorld(hero.x, hero.y, heroWorld))
    })
  }

  const setFade = (v: number) => {
    uniforms.uOpacity.value = v
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      const look = { ...haze(palette), gain: 0.035, size: 0.0035 }
      if (dust.source !== haze_) void dust.morphTo(haze_, look, { seconds: 3, swirl: 0.8 })
      else {
        const g0 = dust.look.gain
        ctx.tween(2, (u) => (dust.look.gain = g0 + (look.gain - g0) * u))
      }
      soup()
      lifeUpload()
      lifeUpload()
      ctx.tween(2.6, (u) => (fade = u), { tag: 'fade' })
      shot({ target: [0, FLOOR, 0.15], distance: 4.3, azimuth: 0, elevation: 52, fov: 38, orbit: 1.2, aperture: 0.003 }, 3)
    },

    cues: [
      // "…what would happen if you made it smooth."
      at(1, 'smooth', () => {
        ctx.tween(2.6, (u) => (uniforms.uSmooth.value = u), { ease: easeInOut, tag: 'smooth' })
        shot({ distance: 3.9, elevation: 40 }, 6)
      }),
      // "Time that flows instead of ticking."
      at(2, 'Time', () => {
        ctx.tween(2, (u) => (lifeTick = 0.42 + 0.5 * u))
      }),
      // "And these turned up."
      at(3, -0.6, () => {
        hatch('orbium')
        ctx.tween(1.8, (u) => (uniforms.uLenia.value = u), { ease: easeInOut, tag: 'lenia' })
        sound.sfx('shimmer', 0.4)
        follow({ distance: 1.5, elevation: 36, azimuth: -30, orbit: 1.5 }, 3.2)
      }),
      at(4, () => plate(ctx, 'Orbium', 'Lenia, 2019')),
      // "Nudge one, and it recovers."
      at(4, 'Nudge', () => {
        if (!sim) return
        const side = { x: HEADING.y, y: -HEADING.x }
        sim.poke(hero.x + side.x * 4 + HEADING.x * 3, hero.y + side.y * 4 + HEADING.y * 3, 7, 0.15)
        sound.note(220, { gain: 0.12, seconds: 1.4 })
      }),
      at(5, () => follow({ distance: 1.3, elevation: 30, azimuth: 25, orbit: 1.2 }, 5)),
      // "There are hundreds of species now, catalogued like beetles."
      at(6, () => {
        following = false
        rig.track(null)
        hatch('shield')
        shot({ target: [0, FLOOR, 0], distance: 2.7, azimuth: 60, elevation: 50, orbit: 2 }, 0)
      }),
      at(6, 'catalogued', () => {
        hatch('spinner')
        shot({ target: [0, FLOOR, 0], distance: 2.3, azimuth: 150, elevation: 58, orbit: -2 }, 0)
      }),
      // "They are not designs. They are solutions."
      at(7, () => {
        hatch('orbium')
        shot({ target: [0, FLOOR, 0], distance: 3.4, azimuth: 120, elevation: 28, orbit: 0 }, 0)
        shot({ target: [0, FLOOR, 0.1], distance: 4.2, azimuth: 150, elevation: 40, orbit: 2.4, aperture: 0.004 }, 5)
      }),
    ],

    explore() {
      // straight to the creatures
      ctx.after(0.4, () => {
        uniforms.uSmooth.value = 1
        uniforms.uLenia.value = 1
        hatch('orbium')
      })
      shot({ target: [0, FLOOR, 0.1], distance: 3.6, azimuth: 150, elevation: 40, orbit: 2 }, 3)
    },

    update(dt) {
      driftMotes(haze_, engine.time)
      uniforms.uCamPos.value.copy(rig.camera.position)

      // the Game of Life ticks while it is on screen
      if (lifeOn && dt > 0) {
        lifeClock += dt
        if (lifeClock >= lifeTick) {
          lifeClock %= lifeTick
          lifeStep()
          lifeUpload()
        }
        uniforms.uLife.value = lifeTex[lifeCur]
        uniforms.uLifePrev.value = lifeTex[1 - lifeCur]
        uniforms.uLifeMix.value = Math.min(1, lifeClock / lifeTick)
      }
      if (uniforms.uLenia.value >= 1) lifeOn = false

      if (sim && running && dt > 0) {
        acc += speed * Math.min(dt, 0.25)
        const whole = Math.floor(acc)
        const n = Math.min(whole, MAX_STEPS_PER_FRAME)
        acc -= whole
        if (n > 0) {
          sim.step(n)
          generation += n
        }
        sim.present(generation > 0 ? acc : 0)
        if (--statsIn <= 0 && sim.sampleStats()) statsIn = 4
        trackHero()
      }
      pond.visible = fade > 0.001
      setFade(fade)
    },

    exit() {
      following = false
      const from = fade
      ctx.tween(2.4, (u) => (fade = from * (1 - u)), { ease: easeInOut, tag: 'fade' })
    },

    dispose() {
      root.remove(pond)
      geometry.dispose()
      material.dispose()
      for (const t of lifeTex) t.dispose()
      sim?.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Species',
        options: LENIA_SPECIES.map((s) => ({ value: s.id, label: s.label })),
        get: () => speciesId,
        set: (v) => {
          following = false
          rig.track(null)
          ctx.cancel('lenia')
          uniforms.uLenia.value = 1
          hatch(v)
        },
      },
      {
        kind: 'slider',
        label: 'Generations per second',
        min: 1,
        max: 30,
        step: 1,
        get: () => speed,
        set: (v) => (speed = v),
        format: (v) => v.toFixed(0),
      },
      {
        kind: 'action',
        label: 'Hatch them again',
        run: () => {
          ctx.cancel('lenia')
          uniforms.uLenia.value = 1
          hatch(speciesId)
        },
      },
      { kind: 'readout', label: 'Generation', get: () => generation.toLocaleString('en-US') },
    ],
    notes: [
      'In the Game of Life a cell looks at its eight neighbours and is alive or dead in the next tick. Lenia, published by Bert Wang-Chak Chan in 2019, makes every part of that continuous: a cell holds any value between 0 and 1, it weighs a whole ring of neighbours with a smooth kernel, and it changes by a small step each moment instead of flipping.',
      'Under one choice of kernel and growth rule, the Orbium appears: a creature about twenty cells across that glides about half a cell per step and keeps its shape indefinitely. Knock a piece off it and it grows back. Nobody designed it; it was found by searching, as were the hundreds of species since catalogued, some that spin, some that pulse, some that split in two.',
      'Here the pond is a 256 by 256 grid wrapped round on itself, stepped on your graphics card about ten times a second, each step weighing 500 neighbours per cell.',
    ],
  }
}

export default lenia
