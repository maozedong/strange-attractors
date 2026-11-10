/**
 * The dripping tap. Drops gather in a point of light and fall to still, dark water. Each one's
 * gap is set by the one before it, through one line of arithmetic, x → r·x·(1 − x): opening
 * the tap is turning r. Beside the drops, every drip leaves a mark at the height of its gap,
 * in a strip that slides left, so the rhythm can be seen: one row, two, four, a scatter. Then
 * every rhythm is laid side by side, one column per position of the tap: the bifurcation
 * diagram rises out of the water where the strip stood.
 */
import * as THREE from 'three'
import { defaultLook, type DustLook } from '../../engine/Dust'
import { at, easeInOut, easeOut, type SceneFactory } from '../../film/types'
import { sound } from '../../sound/audio'
import { PERIOD3_WINDOW, logistic } from '../../fractal/logistic/math'
import { readout } from '../kit/hud'
import { logisticSource } from '../kit/LogisticSource'
import { FLOOR } from '../kit/shared'
import { DIAGRAM, diagramLook, diagramWorld, placeDiagram } from '../kit/bifurcation'
import { MARKS, MarksSource, RIPPLES } from './MarksSource'
import { MAX_DROPS, Water } from './Water'

/** where the drops gather and fall, world units */
const DROP_X = 1.86
const DROP_Z = 0.05
const NOZZLE_Y = 0.42
/** the drops take this long to fall */
const FALL = 0.66
const GRAVITY = (2 * (NOZZLE_Y - FLOOR)) / (FALL * FALL)
const DROP_SIZE = 0.13
/** the strip: newest mark at the diagram's right edge, the oldest at its left */
const STRIP_RIGHT = DIAGRAM.centre[0] + DIAGRAM.width / 2
const SPACING = DIAGRAM.width / (MARKS - 1)
const RING_LIFE = 2.2
const RING_REACH = 0.78
/** seconds the strip takes to step left after a drip */
const SLIDE = 0.42

/** seconds between drips scale with how far the tap is open: higher r, a faster tap */
const TEMPO: [number, number][] = [
  [2.8, 1.3],
  [2.9, 1.22],
  [2.95, 0.84],
  [3.2, 0.66],
  [3.5, 0.56],
  [3.75, 0.5],
  [4, 0.48],
]
function tempo(r: number): number {
  if (r <= TEMPO[0][0]) return TEMPO[0][1]
  for (let i = 1; i < TEMPO.length; i++) {
    const [r1, t1] = TEMPO[i]
    const [r0, t0] = TEMPO[i - 1]
    if (r <= r1) return t0 + ((t1 - t0) * (r - r0)) / (r1 - r0)
  }
  return TEMPO[TEMPO.length - 1][1]
}

/** the middle of the period-3 window */
const WINDOW = 0.5 * (PERIOD3_WINDOW[0] + PERIOD3_WINDOW[1])
/** the dial range the last line opens up around it, and how much narrower that is than the whole */
const ZOOM_IN: [number, number, number] = [3.812, 3.872, (3.872 - 3.812) / 1.2]

const tap: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const marks = new MarksSource(engine.renderer, ctx.size, {
    floor: FLOOR,
    rise: 0.6,
    spread: 0.026,
    share: 0.36,
    ringLife: RING_LIFE,
    ringReach: RING_REACH,
  })
  marks.impact.set(DROP_X, FLOOR + 0.01, DROP_Z)
  const water = new Water(palette, marks.ripples, FLOOR, RING_LIFE, RING_REACH)
  water.centre(DROP_X, DROP_Z)
  root.add(water.object)
  const logi = logisticSource(engine)

  const marksLook = (): DustLook => ({
    ...defaultLook(palette),
    size: 0.0024,
    minPx: 0.6,
    gain: ctx.portrait ? 0.06 : 0.09,
    streak: 0.25,
    tone: 'aux',
    toneBias: 0,
    toneScale: 1,
    twinkle: 0.12,
  })

  // ── the tap ──
  let r = 2.9
  let x = 0.62
  /** seconds since the last release */
  let phase = 0
  let interval = 1
  let dripping = true
  /** 0..1 how much of the gathering drop shows */
  let hang = 0
  const drops = Array.from({ length: MAX_DROPS }, () => ({ on: false, age: 0, x: 0 }))
  /** index of each slot's drip, -1 = never used */
  const slotDrip = new Int32Array(MARKS).fill(-1)
  const slotValue = new Float32Array(MARKS)
  let drips = 0
  let slide = 1
  let rippleNext = 0

  // ── the diagram ──
  let diagram = false
  let reveal = 0
  let rTag: ReturnType<typeof ctx.label> | null = null
  let rule: ReturnType<typeof ctx.label> | null = null
  const look = new THREE.Vector3()
  const noteAt = new THREE.Vector3()
  const buffer = new THREE.Vector2()

  const setR = (v: number) => {
    r = Math.min(4, Math.max(2.8, v))
  }
  const turn = (to: number, seconds: number) => {
    const from = r
    ctx.tween(seconds, (u) => setR(from + (to - from) * u), { ease: easeInOut, tag: 'r' })
  }
  /** a real tap is never perfectly steady: a nudge lets a rhythm that has just lost its footing show it */
  const nudge = (amount: number) => {
    x = Math.min(0.97, Math.max(0.03, x + amount))
  }

  const land = (value: number, late: number) => {
    // a ring, a sound, a mark
    const rp = marks.ripples[rippleNext]
    rippleNext = (rippleNext + 1) % RIPPLES
    rp.set(DROP_X, DROP_Z, late, 0.65 + 0.35 * value)
    const gap = tempo(r) * (0.22 + 0.9 * value)
    if (water.opacity > 0.05) sound.sfx('drip', 0.42 * water.opacity, THREE.MathUtils.clamp(1.5 - 0.75 * gap, 0.7, 1.4), 0.35)
    const slot = drips % MARKS
    slotDrip[slot] = drips
    slotValue[slot] = value
    marks.marks[slot].z = late
    drips++
    slide = 0
  }

  const release = () => {
    x = logistic(r, x)
    if (!(x > 0 && x < 1)) x = 0.5
    for (const d of drops) {
      if (d.on) continue
      d.on = true
      d.age = 0
      d.x = x
      break
    }
    interval = tempo(r) * (0.22 + 0.9 * x)
  }

  const stepTap = (dt: number) => {
    for (const d of drops) {
      if (!d.on) continue
      d.age += dt
      if (d.age >= FALL) {
        d.on = false
        land(d.x, d.age - FALL)
      }
    }
    if (dripping) {
      phase += dt
      if (phase >= interval) {
        phase -= interval
        release()
      }
    }
    hang += ((dripping ? 1 : 0) - hang) * (1 - Math.exp(-dt * 3))
    for (const rp of marks.ripples) if (rp.z >= 0) rp.z += dt
    slide = Math.min(1, slide + dt / SLIDE)

    // the strip
    const newest = drips - 1
    const s = easeOut(slide)
    for (let i = 0; i < MARKS; i++) {
      const m = marks.marks[i]
      const n = slotDrip[i]
      if (n < 0) continue
      const back = newest - n
      const steps = back === 0 ? 0 : back - 1 + s
      m.x = STRIP_RIGHT - steps * SPACING
      m.y = DIAGRAM.centre[1] - DIAGRAM.height / 2 + slotValue[i] * DIAGRAM.height
      m.z += dt
      // older marks fade; the last few go out altogether before their slot is reused
      const k = steps / (MARKS - 1)
      m.w = (1 - 0.72 * Math.pow(k, 1.1)) * THREE.MathUtils.smoothstep(MARKS - 1 - steps, 0, 2.5)
    }
  }

  const drawDrops = () => {
    // the drop gathering under the point of light grows through the second half of the wait
    const grow = THREE.MathUtils.smoothstep(phase / Math.max(interval, 1e-3), 0.35, 1) * hang
    water.sprite(0, DROP_X, NOZZLE_Y - 0.02 * grow, DROP_Z, DROP_SIZE * (1 + 0.35 * grow), 1 + 0.12 * grow, (0.6 + 0.4 * grow) * hang, FLOOR)
    drops.forEach((d, i) => {
      if (!d.on) {
        water.sprite(i + 1, 0, 0, 0, 0, 1, 0, FLOOR)
        return
      }
      const y = NOZZLE_Y - 0.03 - 0.5 * GRAVITY * d.age * d.age
      water.sprite(i + 1, DROP_X, y, DROP_Z, DROP_SIZE * 0.55, 1 + Math.min(1.2, 0.16 * GRAVITY * d.age), 0.85, FLOOR)
    })
    engine.renderer.getDrawingBufferSize(buffer)
    water.commit(buffer.y)
  }

  // ── the turn to the diagram ──
  const showDiagram = (seconds: number, revealSeconds: number) => {
    if (diagram) return
    diagram = true
    dripping = false
    ctx.cancel('dial')
    logi.feather = 0
    placeDiagram(logi, palette)
    logi.pool = { y: (FLOOR + 0.012 - (DIAGRAM.centre[1] - DIAGRAM.height / 2)) / DIAGRAM.height, depth: 0.2 }
    reveal = 0
    logi.reveal = 0
    logi.orderGain = 0.14
    void dust.morphTo(logi, diagramLook(palette, logi, ctx.portrait), { seconds, swirl: 0.25 })
    ctx.after(seconds * 0.8, () => {
      sound.sfx('rise', 0.7)
      ctx.tween(
        revealSeconds,
        (u) => {
          reveal = u
          logi.reveal = u
        },
        {
          tag: 'reveal',
          ease: (t) => t,
          done: () => {
            logi.pool = null
          },
        },
      )
    })
    ctx.tween(4, (u) => (water.opacity = Math.min(water.opacity, 1 - u * 0.75)), { tag: 'water' })
  }

  const showTap = () => {
    if (!diagram) return
    diagram = false
    ctx.cancel('reveal')
    ctx.cancel('dial')
    logi.pool = null
    logi.reveal = 1
    dripping = true
    void dust.morphTo(marks, marksLook(), { seconds: 2, swirl: 0.3 })
    ctx.tween(1.5, (u) => (water.opacity = Math.max(water.opacity, u)), { tag: 'water' })
  }

  /** move the band of light in the diagram's paint */
  const spotTo = (to: number, width: number, gain: number, seconds: number) => {
    const sp = logi.spot
    const a = { at: sp.gain > 0.01 ? sp.at : to, width: sp.width, gain: sp.gain }
    ctx.tween(
      seconds,
      (u) => {
        sp.at = a.at + (to - a.at) * u
        sp.width = Math.exp(Math.log(a.width) + (Math.log(width) - Math.log(a.width)) * u)
        sp.gain = a.gain + (gain - a.gain) * u
      },
      { ease: easeInOut, tag: 'spot' },
    )
  }

  /** where the camera looks along the diagram during "One line. Two. Four. Then a cloud." */
  const along = (rr: number, v = 0.62): [number, number, number] => {
    diagramWorld(rr, v, look)
    return [look.x, look.y, look.z]
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      void dust.morphTo(marks, marksLook(), { seconds: 3.2, swirl: 0.7 })
      ctx.tween(2.5, (u) => (water.opacity = u), { tag: 'water' })
      interval = 1.6
      phase = 0.2
      rig.shot(
        {
          target: [DROP_X - 0.68, -0.36, 0],
          distance: 3.0,
          azimuth: -8,
          elevation: 8,
          orbit: 0,
          aperture: 0.004,
          portrait: { target: [DROP_X - 0.45, -0.3, 0], distance: 2.3 },
        },
        3.4,
      )
    },

    cues: [
      at(0, () => {
        rTag = readout(ctx)
      }),
      // "Open it a little, and the drips come faster."
      at(1, () => turn(2.95, 1.8)),
      // "A little more, and the rhythm splits."
      at(2, () => {
        turn(3.2, 1.2)
        ctx.after(1.0, () => nudge(0.08))
        rig.shot({ target: [DROP_X - 1.1, -0.38, 0], distance: 3.6, azimuth: -6, elevation: 8, portrait: { target: [DROP_X - 0.75, -0.32, 0], distance: 2.9 } }, 6)
      }),
      // "Again. Four gaps, repeating."
      at(3, () => {
        turn(3.5, 1.0)
        ctx.after(0.6, () => nudge(0.05))
      }),
      at(3, 'Then eight', () => turn(3.56, 0.6)),
      at(3, 'Then sixteen', () => turn(3.567, 0.5)),
      // "The splits come faster and faster, until there is no rhythm left at all."
      at(4, () => {
        turn(3.72, ctx.until(4, 'no rhythm') + 0.4)
        rig.shot({ target: [0.24, -0.4, 0], distance: 4.3, azimuth: -4, elevation: 8, orbit: 0.3, portrait: { target: [0.85, -0.36, 0], distance: 3.6 } }, 7)
      }),
      // "One line of arithmetic does all of this."
      at(5, () => {
        rule = ctx.label('next = r × x × (1 − x)', { kind: 'note', at: [STRIP_RIGHT - 1.2, 0.42, 0], align: 'above' })
      }),
      // "Now lay every rhythm side by side"
      at(6, () => {
        rule?.remove()
        rTag?.remove()
        rTag = null
        showDiagram(1.6, 4.2)
        rig.shot({ target: along(3.0, 0.45), distance: 3.1, azimuth: -14, elevation: 6, orbit: 0, aperture: 0.005, portrait: { distance: 2.6 } }, 2)
        ctx.after(1.6, () => {
          rig.shot({ distance: 4.3, azimuth: -10, elevation: 5, portrait: { distance: 3.7 } }, 4.4)
          // keep the middle of what has been drawn so far in the middle of the frame
          rig.track((target) => {
            diagramWorld(DIAGRAM.dial[0] + 0.6 * reveal, 0.5, target)
          })
        })
      }),
      // "One line. Two. Four. Then a cloud.": a band of light travels along it, the camera with it
      at(7, -0.4, () => rig.shot({ target: along(2.95, 0.62), distance: 2.15, azimuth: -26, elevation: 3, aperture: 0.014, portrait: { distance: 1.6 } }, 1.3)),
      at(7, 'Two', -0.2, () => rig.shot({ target: along(3.24, 0.62) }, 0.9)),
      at(7, 'Four', -0.2, () => rig.shot({ target: along(3.5, 0.6) }, 0.9)),
      at(7, 'cloud', -0.25, () => {
        rig.shot({ target: along(3.74, 0.56), distance: 2.5 }, 1.3)
        spotTo(3.78, 0.14, 0.7, 1.2)
      }),
      // "And inside the cloud, narrow windows where the rhythm comes back.": open the widest one up
      at(8, -0.2, () => {
        spotTo(WINDOW, 0.2, 0, 1.5)
        rig.shot({ target: DIAGRAM.centre, distance: 3.25, azimuth: -4, elevation: 2, aperture: 0.003, orbit: 0, portrait: { distance: 3.5 } }, 2.4)
        const [d0, d1] = logi.dialRange
        ctx.tween(
          3.6,
          (u) => {
            const w = (1 - Math.pow(ZOOM_IN[2], u)) / (1 - ZOOM_IN[2])
            logi.setDial(d0 + (ZOOM_IN[0] - d0) * w, d1 + (ZOOM_IN[1] - d1) * w)
            logi.feather = 0.05 * Math.min(1, u * 2)
          },
          { ease: easeInOut, tag: 'dial' },
        )
      }),
      at(8, 'windows', 0.4, () => {
        ctx.label('the rhythm comes back', {
          kind: 'note',
          at: () => logi.toWorld(PERIOD3_WINDOW[0] + 0.0045, 0.74, noteAt),
          align: 'center',
        })
      }),
    ],

    explore() {
      // the tap already open far enough for the rhythm to have split; the dial is in the drawer
      ctx.after(2.5, () => {
        setR(3.2)
        nudge(0.01)
      })
    },

    update(dt) {
      if (dt > 0) stepTap(dt)
      drawDrops()
      rTag?.set(`tap  r = ${r.toFixed(r > 3.555 && r < 3.6 ? 3 : 2)}`)
    },

    exit() {
      const w0 = water.opacity
      ctx.tween(2.2, (u) => (water.opacity = w0 * (1 - u)), { tag: 'water' })
    },

    dispose() {
      if (dust.source === marks) dust.setSource(dust.bake(), { ...dust.look })
      water.dispose()
      marks.dispose()
    },

    lab: [
      {
        kind: 'slider',
        label: 'How far the tap is open, r',
        min: 2.8,
        max: 4,
        step: 0.001,
        get: () => r,
        set: (v) => {
          ctx.cancel('r')
          setR(v)
          nudge(0.01)
        },
        format: (v) => v.toFixed(3),
      },
      {
        kind: 'toggle',
        label: 'Every rhythm side by side',
        get: () => diagram,
        set: (v) => {
          if (v) {
            showDiagram(1.4, 2.6)
            rig.shot({ target: DIAGRAM.centre, distance: 4.4, azimuth: -6, elevation: 4 }, 2)
          } else {
            showTap()
            rig.shot({ target: [0.24, -0.36, 0], distance: 4.6, azimuth: -4, elevation: 8 }, 2)
          }
        },
      },
      { kind: 'readout', label: 'Last gap', get: () => `${interval.toFixed(2)} s` },
    ],
    notes: [
      'Each drop leaves when the water hanging from the tap gets heavy enough, and how much is left behind sets up the next. Robert Shaw and his colleagues at Santa Cruz timed real dripping taps in the early 1980s and found exactly this: as the flow is turned up the drips go from even, to alternating long and short, to a doubling cascade, to no repeating pattern at all.',
      'Here the rule is the logistic map: the next value is r × x × (1 − x), and the gap before the next drip grows with x. r stands for how far the tap is open. Below r = 3 every drip ends up the same; at 3 the rhythm splits into two; at 3.449 into four; then eight, sixteen, and by r ≈ 3.5699 the doublings have piled up into chaos.',
      'The diagram plots, for every r, where the drips settle. A quarter of a million points each iterate the rule at their own r: where they pile onto a few lines the rhythm repeats, where they spread into a cloud it never does. The clear bands inside the cloud are windows of order; the widest, near r = 3.83, drips in threes.',
    ],
  }
}

export default tap
