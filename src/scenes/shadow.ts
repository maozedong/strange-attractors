/**
 * The shadow of the Mandelbrot set. The set lies on the floor as a luminous relief; the
 * bifurcation diagram from the dripping tap stands up along its real axis, and every fork lands
 * over a bulb. Then the plane and the diagram zoom together, out along the axis to the window
 * where the rhythm came back: a small copy of the whole set, with a small copy of the whole
 * diagram standing on it. And inside that, another.
 */
import * as THREE from 'three'
import { rampColor } from '../engine/palettes'
import { flightEase, flightPath } from '../fractal/mandel/flight'
import { MANDEL_TARGETS } from '../fractal/mandel/targets'
import { at, easeInOut, easeOut, linear, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { ComplexPlane, type PlaneView } from './kit/ComplexPlane'
import { GlowLine } from './kit/GlowLine'
import { readout } from './kit/hud'
import { logisticSource } from './kit/LogisticSource'
import { DIAGRAM, diagramLook, placeDiagram as standInTheRoom } from './kit/bifurcation'
import { FLOOR, driftMotes, haze, motes } from './kit/shared'

/** the plane lies just above the mirror floor */
const PLANE_Y = FLOOR + 0.002
const PLANE_W = 6.4
const PLANE_H = 5.0
/** the diagram stands on the real axis from c = −2 to c = ¼ (world x at the overview) */
const X0 = -1.25
const X1 = 1.0
/** height of the standing diagram, world units */
const HEIGHT = 1.3
/** the diagram's vertical zoom follows the horizontal one to this power (period-3 renormalisation: ln 9.28 / ln 55.8) */
const VALUE_POWER = 0.553

/** the period-3 copy on the real axis: antenna tip −1.79033, cusp −1.75 (fractal/mandel/targets.ts) */
const P3_TIP = -1.7903274919993457
const P3_WIDTH = 0.0403274919993457
/** its own period-3 copy (period 9): cusp found by Newton on the 9-cycle, width by the same tip-to-cusp ratio */
const P9_CUSP = -1.7857769425128733
const P9_NUCLEUS = -1.7858656464106737
const P9_WIDTH = (P9_CUSP - P9_NUCLEUS) * (P3_WIDTH / (-1.75 - -1.7548776662466927))

/** where each copy sits in the frame: framed exactly as the overview frames the whole set */
const FRAME = (0 - X0) / (X1 - X0)
const VIEWS: Record<string, PlaneView & { iter: number }> = {
  whole: { cx: -0.75, cy: 0, scale: 1, iter: 300 },
  // points near a copy of period p take about p times as long to escape
  copy: { cx: P3_TIP + FRAME * P3_WIDTH, cy: 0, scale: P3_WIDTH / 2.25, iter: 1000 },
  inner: { cx: P9_CUSP - P9_WIDTH + FRAME * P9_WIDTH, cy: 0, scale: P9_WIDTH / 2.25, iter: 3000 },
  seahorse: { cx: MANDEL_TARGETS.seahorse.cx, cy: MANDEL_TARGETS.seahorse.cy, scale: 1e-12, iter: 4000 },
  elephant: { cx: MANDEL_TARGETS.elephant.cx, cy: MANDEL_TARGETS.elephant.cy, scale: 9e-10, iter: 4000 },
}
/** width of the view a flight is measured in, world units */
const FLIGHT_WIDTH = 3

/** the top of the attracting cycle just past a fork at c (quadratic form), by iteration */
function topOfCycle(c: number): number {
  let z = 0
  for (let i = 0; i < 4000; i++) z = z * z + c
  let top = z
  for (let i = 0; i < 64; i++) {
    z = z * z + c
    top = Math.max(top, z)
  }
  return top
}

const shadow: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const logistic = logisticSource(engine)
  const haze_ = motes(engine)

  const plane = new ComplexPlane(engine.renderer, palette, 'mandel', PLANE_W, PLANE_H, VIEWS.whole, { density: ctx.size >= 512 ? 380 : 220 })
  plane.mesh.rotation.x = -Math.PI / 2
  plane.mesh.position.set(0, PLANE_Y, 0)
  root.add(plane.mesh)
  const pu = plane.uniforms

  /** 0 = the diagram lies flat on the axis, 1 = standing */
  let rise = 1
  /** the diagram steps back once the plane is the subject again */
  let diagramDim = 1
  let lastFrame = performance.now()
  /** the glow is no longer being faded in by a cue */
  let depthGlow = false
  let diagramOn = false
  let diagramForm: 'logistic' | 'quadratic' = 'logistic'
  let target = 'whole'
  let note: ReturnType<typeof ctx.label> | null = null
  const names: ReturnType<typeof ctx.label>[] = []
  let mag: ReturnType<typeof ctx.label> | null = null

  // ── plumb lines from each fork down to the point where its bulb begins ──
  const pale = rampColor(palette, 0.7).multiplyScalar(1.3)
  const FORKS = [-0.75, -1.25, -1.3680989]
  const valueY = (z: number) => PLANE_Y + 0.004 + ((z + 2) / 4) * HEIGHT
  const plumbs = FORKS.map((c, i) => {
    // the branch splits at its top point just past the fork
    const z = topOfCycle(c - 0.004 * (i + 1) ** -1.5)
    const x = c - VIEWS.whole.cx
    const line = new GlowLine([new THREE.Vector3(x, valueY(z), 0.002), new THREE.Vector3(x, PLANE_Y + 0.002, 0.002)], 0.0045, pale, new THREE.Vector3(0, 0, 1))
    line.opacity = 0
    root.add(line.mesh)
    return line
  })
  /** where each name is pinned: inside its bulb, in front of the standing diagram */
  const NAME_AT: [number, number][] = [
    [-0.18, -0.36],
    [-1.0, -0.06],
    [-1.31, -0.075],
  ]

  // ── the last scene's diagram: parked up and out of the way while the set comes up ──
  const parked = new THREE.Matrix4()
    .makeTranslation(-DIAGRAM.width * 0.42, 1.9 - DIAGRAM.height * 0.42, -3.2)
    .multiply(new THREE.Matrix4().makeScale(DIAGRAM.width * 0.84, DIAGRAM.height * 0.84, DIAGRAM.width * 0.84))
  let parking = false

  // ── the diagram, standing on the axis and zooming with the plane ──
  const placeDiagram = () => {
    const v = plane.view
    logistic.setDial(v.cx + X0 * v.scale, v.cx + X1 * v.scale)
    const k = Math.pow(VIEWS.whole.scale / v.scale, VALUE_POWER)
    logistic.setValue(-2 / k, 2 / k)
    logistic.depth = 0.02
    logistic.matrix
      .makeTranslation(X0, PLANE_Y + 0.004, 0)
      .multiply(new THREE.Matrix4().makeScale(X1 - X0, HEIGHT * Math.max(0.004, rise), 0.6))
  }
  /** the house look for the diagram (coloured by order and chaos), at this scene's brightness */
  const GAIN = 0.42
  const axisLook = () => ({ ...diagramLook(palette, logistic), gain: GAIN })
  const hazeLook = () => ({ ...haze(palette), gain: 0.05 })

  /** the diagram flies to the axis and stands on it (in the quadratic form, which lines up with the set) */
  const standDiagram = (seconds = 2.4) => {
    diagramDim = 1
    ctx.cancel('dim')
    parking = false
    if (dust.source !== logistic || diagramForm !== 'quadratic') {
      // freeze what is on screen, so the switch of form is seen as a flight, not a jump
      dust.setSource(dust.bake(), { ...dust.look })
      logistic.setForm('quadratic')
      diagramForm = 'quadratic'
      logistic.setPalette(palette)
      logistic.pool = null
      logistic.reveal = 1
      logistic.seek = true
      logistic.spot.gain = 0
      logistic.feather = 0
      logistic.orderGain = 0.16
      placeDiagram()
      void dust.morphTo(logistic, axisLook(), { seconds, swirl: 0.5 })
    }
    diagramOn = true
  }

  /** off the axis the diagram cannot line up: the dust becomes a quiet haze */
  const toHaze = (seconds = 3) => {
    diagramOn = false
    if (dust.source !== haze_) void dust.morphTo(haze_, hazeLook(), { seconds, swirl: 0.8 })
  }

  /** fly the plane (and the diagram with it) to a view */
  const fly = (to: PlaneView & { iter: number }, seconds: number, tag = 'flight') => {
    const from = { ...plane.view }
    const i0 = plane.iterations
    const z0 = Math.log(from.scale)
    const z1 = Math.log(to.scale)
    const path = flightPath(from, to, FLIGHT_WIDTH)
    const out = { cx: 0, cy: 0, scale: 1 }
    ctx.tween(
      seconds,
      (u) => {
        path.at(flightEase(u) * path.length, out)
        if (u >= 1) Object.assign(out, to)
        // the budget follows the depth, in log steps
        const k = z1 === z0 ? 1 : Math.min(1, Math.max(0, (Math.log(out.scale) - z0) / (z1 - z0)))
        plane.maxIter = Math.round(Math.exp(Math.log(i0) + (Math.log(to.iter) - Math.log(i0)) * k))
        plane.view.cx = out.cx
        plane.view.cy = out.cy
        plane.view.scale = out.scale
      },
      { ease: linear, tag },
    )
  }

  const choose = (name: string, seconds = 5) => {
    target = name
    const v = VIEWS[name]
    if (!v) return
    fly(v, seconds)
    if (v.cy === 0) {
      rise = 1
      standDiagram(2.2)
    } else {
      toHaze(2.2)
    }
  }

  const magnification = () => VIEWS.whole.scale / plane.view.scale
  const formatMag = (m: number) => (m < 1000 ? `×${m.toFixed(m < 10 ? 1 : 0)}` : `×${m.toExponential(1).replace('e+', ' × 10^')}`)

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      plane.setPalette(palette)
      pu.uGlow.value = 0
      pu.uRim.value = 0
      pu.uBase.value = 1
      pu.uInterior.value = 1
      pu.uEscape2.value = 4
      plane.maxIter = 2
      ctx.fade(3.2, 0, 1, (v) => (pu.uOpacity.value = v))
      // the diagram the tap and the Feigenbaum scene built drifts up and back, out of the way
      logistic.setPalette(palette)
      if (dust.source === logistic) {
        diagramForm = logistic.dialRange[0] < 0 ? 'quadratic' : 'logistic'
        if (diagramForm === 'quadratic') {
          standInTheRoom(logistic, palette)
          diagramForm = 'logistic'
        }
        const from = logistic.matrix.clone()
        const g0 = dust.look.gain
        parking = true
        ctx.tween(
          3.6,
          (u) => {
            if (!parking) return
            for (let i = 0; i < 16; i++) logistic.matrix.elements[i] = from.elements[i] + (parked.elements[i] - from.elements[i]) * u
            dust.look.gain = g0 * (1 - u) * (1 - u)
          },
          { tag: 'park' },
        )
      } else {
        if (dust.morphing) dust.setSource(dust.bake(), { ...dust.look })
        standInTheRoom(logistic, palette)
        diagramForm = 'logistic'
        logistic.matrix.copy(parked)
        void dust.morphTo(logistic, { ...diagramLook(palette, logistic), gain: 0 }, { seconds: 3, swirl: 0.8 })
      }
      rig.shot(
        { target: [0.25, FLOOR, 0.1], distance: 5.2, azimuth: 24, elevation: 58, orbit: 0.7, aperture: 0.003, portrait: { distance: 3.4, elevation: 64 } },
        3.4,
      )
    },

    cues: [
      at(1, () => {
        note = ctx.portrait
          ? ctx.label('z → z² + c', { kind: 'note', at: new THREE.Vector3(0.2, PLANE_Y, -1.35), align: 'above', dy: -6 })
          : ctx.label('z → z² + c', { kind: 'note', at: new THREE.Vector3(1.32, PLANE_Y, -0.05), align: 'right', dx: 10 })
      }),
      // one more step of the rule each time it is said, then the whole loop, faster and faster
      at(1, 'Square it', () => {
        plane.maxIter = 3
        sound.note(330, { gain: 0.12, seconds: 1.2 })
      }),
      at(1, 'Add a constant', () => {
        plane.maxIter = 4
        sound.note(392, { gain: 0.12, seconds: 1.2 })
      }),
      at(1, 'Repeat', () => {
        rig.shot({ target: [0.05, FLOOR, 0.1], distance: 4.3, elevation: 54 }, 5)
        let last = 4
        ctx.tween(
          Math.max(2, ctx.until(2) + 0.6),
          (u) => {
            const n = Math.round(4 + (60 - 4) * Math.pow(u, 1.8))
            if (n !== last) {
              if (n <= 11) sound.note(392 * Math.pow(2, (n - 3) / 7), { gain: 0.07, seconds: 0.8 })
              last = n
            }
            plane.maxIter = n
          },
          { ease: linear, tag: 'iter' },
        )
      }),
      at(2, () => {
        plane.maxIter = VIEWS.whole.iter
        pu.uEscape2.value = 256
        sound.sfx('shimmer', 0.5)
        ctx.tween(
          3.4,
          (u) => {
            pu.uGlow.value = u
            pu.uRim.value = u
            pu.uBase.value = 1 - u
          },
          { done: () => (depthGlow = true) },
        )
      }),
      at(2, 'most famous', () => {
        rig.shot({ target: [0, FLOOR, 0.05], distance: 3.4, azimuth: 16, elevation: 48, orbit: 0.9 }, 6)
      }),
      // stand the diagram up: the dust gathers into a line on the axis, then rises
      at(3, () => {
        note?.remove()
        note = null
        rise = 0.004
        ctx.cancel('park')
        standDiagram(2.6)
        sound.sfx('rise', 0.55)
        ctx.after(1.9, () => ctx.tween(2.6, (u) => (rise = Math.max(0.004, u)), { ease: easeOut, tag: 'rise' }))
        rig.shot(
          { target: [-0.14, FLOOR + 0.36, 0.25], distance: 3.65, azimuth: 3, elevation: 19, orbit: 0, aperture: 0.004, portrait: { distance: 3.9, elevation: 24, target: [-0.3, FLOOR + 0.55, 0.1] } },
          4.6,
        )
      }),
      // they line up: a plumb line drops from each fork onto the plane
      at(4, () => {
        plumbs.forEach((p, i) =>
          ctx.after(i * 0.32, () => {
            p.opacity = 1
            ctx.tween(0.9, (u) => (p.draw = u), { ease: easeOut })
            sound.note([523.25, 659.25, 783.99][i], { gain: 0.09, seconds: 1.4 })
          }),
        )
      }),
      ...[
        { line: 4, word: 'heart-shaped', k: 0, name: 'one rhythm' },
        { line: 5, word: 'The disc', k: 1, name: 'two' },
        { line: 5, word: 'The next bud', k: 2, name: 'four' },
      ].map(({ line, word, k, name }) =>
        at(line, word, () => {
          ctx.tween(1.6, (u) => pu.uLit.value.setComponent(k, u), { ease: easeInOut })
          const [re, im] = NAME_AT[k]
          names.push(ctx.label(name, { kind: 'note', at: plane.toWorld(re, im).setY(PLANE_Y), align: 'below', dy: 2 }))
        }),
      ),
      at(6, () => {
        for (const n of names) n.remove()
        names.length = 0
        const lit = pu.uLit.value.clone()
        ctx.tween(3, (u) => {
          for (const p of plumbs) p.opacity = Math.min(p.opacity, 1 - u)
          pu.uLit.value.copy(lit).multiplyScalar(1 - u)
        })
        rig.shot({ target: [-0.2, FLOOR + 0.36, 0.15], distance: 3.9, azimuth: -9, elevation: 15, orbit: -0.7 }, 5.5)
      }),
      // out along the axis to the window where the rhythm came back
      at(7, () => {
        target = 'copy'
        fly(VIEWS.copy, Math.min(7, Math.max(3.5, ctx.until(8) - 0.5)))
        rig.shot(
          { target: [-0.15, FLOOR + 0.42, 0.15], distance: 3.85, azimuth: 6, elevation: 24, orbit: 0.5, aperture: 0.004, portrait: { distance: 3.6, elevation: 34 } },
          5.4,
        )
        mag = readout(ctx)
      }),
      at(7, 'tiny copy', () => sound.sfx('shimmer', 0.45)),
      at(8, () => {
        target = 'inner'
        fly(VIEWS.inner, 3.6)
        // the same framing as the first full view of the set: the same picture again
        rig.shot({ target: [0, FLOOR, 0.05], distance: 3.4, azimuth: 16, elevation: 48, orbit: 0.9 }, 4.5)
        ctx.tween(3, (u) => (diagramDim = 1 - 0.6 * u), { tag: 'dim' })
      }),
      at(8, 'another one', () => sound.note(587.33, { gain: 0.1, seconds: 2.4 })),
    ],

    explore() {
      // the whole set, lit, with the diagram standing on its axis; the flights are in the drawer
      ctx.after(1.2, () => {
        depthGlow = true
        pu.uRim.value = 1
        pu.uBase.value = 0
        ctx.cancel('iter')
        choose('whole', 2)
        if (!mag) mag = readout(ctx)
      })
    },

    update(dt) {
      driftMotes(haze_, engine.time)
      if (diagramOn && diagramForm === 'quadratic') {
        placeDiagram()
        // flat on the axis every particle shares one line: dim it until it stands
        if (dust.source === logistic) dust.look.gain = GAIN * (0.2 + 0.8 * rise) * diagramDim
      }
      // wall-clock frame time, only to size the plane's work to the GPU (never for timing)
      const now = performance.now()
      // deeper views are thick with filaments: a thinner, quieter glow keeps the copy readable
      const depth = Math.min(1, Math.max(0, Math.log10(magnification()) / 3.5))
      pu.uReach.value = 0.075 * (1 - 0.65 * depth)
      pu.uFine.value = 1.6 * depth
      if (depthGlow) pu.uGlow.value = 1 - 0.6 * depth
      plane.update(dt, Math.min(0.1, (now - lastFrame) / 1000))
      lastFrame = now
      mag?.set(`magnification  ${formatMag(magnification())}`)
    },

    exit() {
      ctx.cancel('flight')
      const o = pu.uOpacity.value
      ctx.tween(1.5, (u) => (pu.uOpacity.value = o * (1 - u)), { ease: (t) => t * (2 - t) })
      for (const l of plumbs) l.opacity = 0
    },

    dispose() {
      plane.dispose()
      for (const l of plumbs) l.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Fly to',
        options: [
          { value: 'whole', label: 'The whole set' },
          { value: 'copy', label: 'The copy on the axis' },
          { value: 'inner', label: 'The copy inside the copy' },
          { value: 'seahorse', label: 'Seahorse valley' },
          { value: 'elephant', label: 'Elephant valley' },
        ],
        get: () => target,
        set: (v) => {
          depthGlow = true
          pu.uRim.value = 1
          pu.uBase.value = 0
          ctx.cancel('iter')
          choose(v, v === 'seahorse' || v === 'elephant' ? 9 : 5)
          if (!mag) mag = readout(ctx)
        },
      },
      {
        kind: 'toggle',
        label: 'Bifurcation diagram',
        get: () => diagramOn,
        set: (on) => {
          if (on && plane.view.cy === 0) {
            rise = 1
            standDiagram(2)
          } else toHaze(2)
        },
      },
      { kind: 'readout', label: 'Magnification', get: () => formatMag(magnification()) },
      { kind: 'readout', label: 'Iterations per point', get: () => String(plane.iterations) },
    ],
    notes: [
      'A different equation, from a different world: z → z² + c, with complex numbers. Start at z = 0 and apply the rule again and again. For some constants c the numbers stay small forever; for others they run off to infinity. The Mandelbrot set is the set of constants that stay. Benoit Mandelbrot first printed it in 1980, on a line printer. Here the glow outside the set shows how close each point lies to it.',
      'Restricted to real numbers, z → z² + c is the logistic map in disguise (c = r/2 − r²/4), so the bifurcation diagram can stand on the set\'s axis of symmetry. The forks land exactly where the bulbs meet: the cardioid is the steady rhythm, the disc beside it period two, the next bulb four, and so on down to the tip at c = −2.',
      'Near c = −1.75, where the dripping tap found its rhythm again, there is a copy of the whole set about fifty-six times smaller, and a copy of the whole diagram standing on it. Inside that copy is another, and another: the zoom here is computed by perturbation around one exact orbit, so it can go a trillion times deeper.',
    ],
  }
}

export default shadow
