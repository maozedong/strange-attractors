/**
 * Chaos, put to work. Three machines in a row. A taffy puller: three rods braiding through a
 * blob of two-coloured taffy, the colours stretched and folded into finer and finer layers (the
 * old GPU simulation, now the dust itself). A wall of lava lamps whose wobbling wax is hashed
 * into a running key. And the butterfly, held by tiny well-timed nudges on the shortest of its
 * unstable loops, then let go: it spills back over the whole attractor in a few laps.
 */
import * as THREE from 'three'
import { defaultLook, type DustLook } from '../../engine/Dust'
import { rampColor } from '../../engine/palettes'
import { at, easeInOut, easeOut, type SceneFactory } from '../../film/types'
import { sound } from '../../sound/audio'
import { releaseSource } from '../kit/FragmentSource'
import { readout } from '../kit/hud'
import { FLOOR, haze, lorenzFlow, resetLorenz, silk, veil } from '../kit/shared'
import { createLampWall, wallKey } from './lamps'
import { LoopFlow } from './loop'
import { TaffySource } from './taffy'
import { ROD_RADIUS } from '../../world/taffy/puller'

type Stage = 'taffy' | 'lamps' | 'loop'

/** domain units → world: the blob (radius 0.8) is about 1.3 units across */
const TAFFY_SCALE = 0.8
const TAFFY_Y = 0.02
/** the lamp wall stands a little behind where the taffy was */
const WALL_Z = -0.7
const WALL_W = 3.0
const WALL_H = 2.0
/** pull strength while holding the loop, per unit of system time */
const HOLD = 45

const pinVert = /* glsl */ `
varying vec3 vN;
varying vec3 vObj;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vObj = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`
const pinFrag = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uCap;
uniform vec3 uLight;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vObj;
void main() {
  vec3 n = normalize(vN);
  float lit = 0.18 + 0.82 * max(dot(n, uLight), 0.0);
  // the end facing us glows; the shaft behind it is polished metal catching the key light
  float cap = smoothstep(0.7, 0.95, n.z);
  vec3 col = mix(uBody * lit, uCap, cap);
  gl_FragColor = vec4(col, uOpacity);
}
`

const hold: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx

  // ---- the taffy
  const taffy = new TaffySource(engine.renderer, ctx.size)
  taffy.inks(palette)
  taffy.matrix.makeScale(TAFFY_SCALE, TAFFY_SCALE, TAFFY_SCALE).setPosition(0, TAFFY_Y, 0)
  const taffyLook: DustLook = {
    ...defaultLook(palette),
    size: 0.0024,
    minPx: 0.6,
    gain: 0.3,
    streak: 0.25,
    tone: 'seed',
    toneBias: 0.7,
    toneScale: 0,
    paint: taffy.paint,
    paintMix: 1,
    twinkle: 0,
  }

  // the three rods, seen end-on: pins standing out of the taffy toward us
  const pinGeometry = new THREE.CylinderGeometry(ROD_RADIUS * TAFFY_SCALE, ROD_RADIUS * TAFFY_SCALE, 0.5, 40, 1).rotateX(Math.PI / 2).translate(0, 0, -0.2)
  const pinMaterial = new THREE.ShaderMaterial({
    vertexShader: pinVert,
    fragmentShader: pinFrag,
    uniforms: {
      uBody: { value: rampColor(palette, 0.62).multiplyScalar(0.55) },
      uCap: { value: rampColor(palette, 0.95).multiplyScalar(1.05) },
      uLight: { value: new THREE.Vector3(-0.55, 0.6, 0.58).normalize() },
      uOpacity: { value: 0 },
    },
    transparent: true,
    toneMapped: false,
  })
  const pins = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(pinGeometry, pinMaterial)
    m.renderOrder = 2
    root.add(m)
    return m
  })
  let pinOpacity = 0
  const setPins = (v: number) => {
    pinOpacity = v
    pinMaterial.uniforms.uOpacity.value = v
    pinMaterial.depthWrite = v > 0.5
    for (const p of pins) p.visible = v > 0.002
  }
  setPins(0)
  const fadePins = (to: number, seconds: number) => {
    const from = pinOpacity
    ctx.tween(seconds, (u) => setPins(from + (to - from) * u), { tag: 'pins' })
  }

  // ---- the lamps
  const wall = createLampWall(palette, WALL_W, WALL_H)
  wall.mesh.position.set(0, FLOOR + WALL_H / 2 + 0.02, WALL_Z)
  root.add(wall.mesh)
  let wallOpacity = 0
  const setWall = (v: number) => {
    wallOpacity = v
    wall.opacity = v
  }
  setWall(0)
  const fadeWall = (to: number, seconds: number) => {
    const from = wallOpacity
    ctx.tween(seconds, (u) => setWall(from + (to - from) * u), { tag: 'wall' })
  }
  let wallClock = 1300

  // ---- the butterfly, and its loop
  const lorenz = lorenzFlow(engine)
  const loop = new LoopFlow(engine.renderer, ctx.size)
  if (import.meta.env.DEV && loop.closure > 1e-4) console.warn(`[hold] the periodic orbit does not close: ${loop.closure}`)
  /** world speed of the flow at its usual pace, for colouring by motion */
  const speedNorm = () => lorenz.speedNorm * new THREE.Vector3().setFromMatrixColumn(lorenz.matrix, 0).length()
  const flowLook = (): DustLook => ({ ...silk(palette, speedNorm() * loop.rate), tone: 'motion', gain: 0.55 })
  let loopLook = flowLook()
  // while the lamps have the stage the dust hangs behind the wall, out of the way
  const cloud = veil(engine)

  let stage: Stage = 'taffy'
  let holding = false
  let pulls: ReturnType<typeof ctx.label> | null = null
  let key: ReturnType<typeof ctx.label> | null = null
  let note: ReturnType<typeof ctx.label> | null = null
  let keyClock = 0

  const shotTaffy = (seconds: number) =>
    rig.shot({ target: [0, TAFFY_Y - 0.04, 0], distance: 2.85, azimuth: 14, elevation: 7, fov: 38, orbit: 0, aperture: 0.003, portrait: { distance: 2.1 } }, seconds)
  const shotLamps = (seconds: number) =>
    rig.shot({ target: [0, FLOOR + WALL_H / 2, WALL_Z], distance: 2.8, azimuth: -5, elevation: 2, fov: 38, orbit: 0.45, aperture: 0.002, portrait: { distance: 1.25, orbit: 0.2 } }, seconds)
  const shotLoop = (seconds: number) =>
    rig.shot({ target: [0, -0.24, 0], distance: 3.7, azimuth: 22, elevation: 12, fov: 38, orbit: 1.4, aperture: 0.003 }, seconds)

  const showTaffy = (seconds = 2.8) => {
    if (stage !== 'taffy') {
      taffy.reset()
      fadeWall(0, 1.5)
    }
    stage = 'taffy'
    holding = false
    loop.hold = 0
    void dust.morphTo(taffy, taffyLook, { seconds, swirl: 0.7 })
    // the rods arrive once the previous picture has cleared
    ctx.after(seconds * 0.3, () => stage === 'taffy' && fadePins(1, seconds * 0.6))
    shotTaffy(seconds)
  }

  const showLamps = (seconds = 3) => {
    stage = 'lamps'
    void dust.morphTo(cloud, { ...haze(palette), gain: 0.12 }, { seconds, swirl: 0.9 })
    fadePins(0, 1.2)
    fadeWall(1, seconds * 0.9)
    shotLamps(seconds + 0.4)
    pulls?.remove()
    pulls = null
  }

  const showButterfly = (seconds = 2.6) => {
    stage = 'loop'
    holding = false
    loop.hold = 0
    loop.rate = 2
    resetLorenz(lorenz)
    loop.seed(lorenz.texture)
    loop.source.matrix.copy(lorenz.matrix)
    loopLook = flowLook()
    void dust.morphTo(loop.source, loopLook, { seconds, swirl: 0.8 })
    fadeWall(0, 1.6)
    fadePins(0, 0.8)
    shotLoop(seconds + 0.4)
    key?.remove()
    key = null
  }

  /** the nudges: every particle is drawn to its nearest place on the loop and kept there */
  const gather = (seconds: number) => {
    if (stage !== 'loop') showButterfly(1.6)
    holding = true
    ctx.cancel('rate')
    loop.rate = 2
    loop.findPlaces()
    const g0 = loopLook.gain
    ctx.tween(seconds, (u) => {
      loop.hold = HOLD * u * u
      loopLook.gain = g0 + (0.16 - g0) * u
    }, { ease: easeInOut, tag: 'hold' })
  }

  const letGo = () => {
    holding = false
    ctx.cancel('hold')
    loop.hold = 0
    // unhurried, so the spill takes a few laps rather than one
    ctx.tween(1.5, (u) => (loop.rate = 2 - 0.9 * u), { tag: 'rate' })
    note?.remove()
    note = null
    const g0 = loopLook.gain
    ctx.tween(3.5, (u) => (loopLook.gain = g0 + (0.55 - g0) * u), { ease: easeOut, tag: 'gain' })
  }

  const freshTaffy = () => {
    if (stage !== 'taffy') {
      showTaffy(2)
      return
    }
    dust.setSource(dust.bake(), { ...dust.look })
    taffy.reset()
    void dust.morphTo(taffy, taffyLook, { seconds: 1.2, swirl: 0.3 })
  }

  const setPullSpeed = (to: number, seconds: number) => {
    const from = taffy.speed
    ctx.tween(seconds, (u) => (taffy.speed = from + (to - from) * u), { ease: easeInOut, tag: 'pull' })
  }

  const rodWorld = (k: number, out: THREE.Vector3) => out.set(taffy.rods[k * 2] * TAFFY_SCALE, taffy.rods[k * 2 + 1] * TAFFY_SCALE + TAFFY_Y, 0)

  /** the highest point of the loop's left lobe on screen, for the note */
  const noteAnchor = new THREE.Vector3()
  const pickNoteAnchor = () => {
    const v = new THREE.Vector3()
    let best = -Infinity
    for (let i = 0; i < 128; i++) {
      loop.loopPoint(i / 128, v).applyMatrix4(lorenz.matrix)
      const s = v.clone().project(rig.camera)
      // the top of the left-hand lobe (on a narrow screen, the top of the whole loop)
      if ((ctx.portrait || s.x < 0) && s.y > best) {
        best = s.y
        noteAnchor.copy(v)
      }
    }
  }

  return {
    enter() {
      // the machines float in the dark: no floor, so nothing is mirrored under them
      dust.floorY = null
      engine.backdrop.floor = 0.25
      taffy.reset()
      taffy.speed = 0
      showTaffy(3)
    },

    cues: [
      // the rods begin to braid so the swaps fall on "stretch, fold"
      at(1, 'Stretch', -1.6, () => {
        setPullSpeed(0.6, 0.5)
        pulls = readout(ctx)
      }),
      at(2, () => {
        setPullSpeed(1.15, 3)
        rig.shot({ distance: 2.25, azimuth: 8, elevation: 5, portrait: { distance: 1.8 } }, 5.5)
      }),
      at(3, () => showLamps(3.2)),
      at(4, 'random', () => {
        key = readout(ctx)
        keyClock = 0
      }),
      at(5, () => showButterfly(2.4)),
      at(6, 'smallest', () => {
        gather(Math.max(1.6, ctx.until(6, 'single') - 0.2))
        sound.sfx('turn', 0.35)
      }),
      at(6, 'single loop', () => {
        pickNoteAnchor()
        note = ctx.label('one loop of the infinitely many inside it', { kind: 'note', at: noteAnchor.clone(), align: 'above', dy: -34, leader: true })
      }),
      at(7, () => rig.shot({ distance: 3.25, elevation: 16, orbit: 0.8 }, 6)),
      at(8, 'easy', () => {
        letGo()
        sound.sfx('release', 0.5)
        rig.shot({ distance: 3.8, elevation: 12, orbit: 1.6 }, 5)
      }),
    ],

    explore() {
      // the puller already at work; the lamps and the steered butterfly are in the drawer
      ctx.after(2.4, () => {
        setPullSpeed(0.8, 1)
        pulls = readout(ctx)
      })
    },

    update(dt) {
      // colour by speed relative to the flow's own pace, so slowing it does not dim it
      if (stage === 'loop') loopLook.speedNorm = speedNorm() * loop.rate
      // the rods follow the taffy's clock
      const p = new THREE.Vector3()
      for (let k = 0; k < 3; k++) pins[k].position.copy(rodWorld(k, p))
      pulls?.set(`pulls ${taffy.pulls.toFixed(1)}`)

      if (wallOpacity > 0) {
        wallClock += dt
        wall.update(wallClock)
      }
      if (key) {
        keyClock -= dt
        if (keyClock <= 0) {
          keyClock = 0.12
          key.set(wallKey(wallClock).slice(0, 32))
        }
      }
    },

    exit() {
      fadePins(0, 1.2)
      fadeWall(0, 2)
    },

    dispose() {
      pinGeometry.dispose()
      pinMaterial.dispose()
      wall.dispose()
      releaseSource(dust, taffy, () => taffy.dispose())
      releaseSource(dust, loop.source, () => loop.dispose())
    },

    lab: [
      {
        kind: 'choice',
        label: 'Machine',
        options: [
          { value: 'taffy', label: 'Taffy puller' },
          { value: 'lamps', label: 'Lava lamps' },
          { value: 'loop', label: 'Butterfly' },
        ],
        get: () => stage,
        set: (v) => {
          if (v === stage) return
          if (v === 'taffy') {
            showTaffy(2.4)
            setPullSpeed(0.8, 1)
            if (!pulls) pulls = readout(ctx)
          } else if (v === 'lamps') {
            showLamps(2.4)
            if (!key) key = readout(ctx)
          } else showButterfly(2.2)
        },
      },
      { kind: 'slider', label: 'Pulls per second', min: 0, max: 3, step: 0.05, get: () => taffy.speed, set: (v) => {
        ctx.cancel('pull')
        taffy.speed = v
      }, format: (v) => v.toFixed(2) },
      { kind: 'action', label: 'Fresh taffy', run: freshTaffy },
      { kind: 'toggle', label: 'Hold the loop', get: () => holding, set: (v) => (v ? gather(1.8) : letGo()) },
      { kind: 'readout', label: 'Pulls', get: () => taffy.pulls.toFixed(1) },
    ],
    notes: [
      'A taffy puller is three rods moving in a braid. Each pull stretches the taffy and folds it back over itself, so the number of layers grows exponentially. The braid alone guarantees a factor of at least the golden ratio, about 1.6, every pull here; after twenty pulls a stripe is at least fifteen thousand times thinner, and the real flow does better than the guarantee. The same stretch-and-fold kneads dough and mixes the fluids in microchip mixers.',
      'Cloudflare’s lobby in San Francisco has a wall of about a hundred lava lamps. A camera photographs it continuously, and the noise in each picture, wax and light and passers-by, is fed into the random-number generators that make encryption keys. The key shown here is a hash of the wax you see; the real system mixes the camera’s raw pixels into a cryptographic generator.',
      'Inside every strange attractor are infinitely many unstable periodic orbits. Because the motion is so sensitive, tiny corrections, applied when the path passes close to the chosen orbit, are enough to keep it there (Ott, Grebogi and Yorke, 1990). Lasers, chemical reactions, heart tissue and spacecraft trajectories have been controlled this way; the ISEE-3 probe was steered to a comet on almost no fuel.',
    ],
  }
}

export default hold
