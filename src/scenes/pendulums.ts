/**
 * A hundred pendulums. One plain pendulum ticks like a clock; a second arm is hung from it;
 * then a hundred copies are lifted together, each a millionth of a degree from the next, and
 * let go. For a few swings they are one pendulum, a hundred deep. Then the fan opens.
 */
import * as THREE from 'three'
import { rampColor } from '../engine/palettes'
import { at, easeInOut, easeOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { DT, L1, L2, MAX_COPIES, PendulumEnsemble, THETA0 } from '../world/pendulum/physics'
import { Beads, FatSegments, floorMirror } from './kit/FatSegments'
import { readout } from './kit/hud'
import { FLOOR, driftMotes, haze, motes } from './kit/shared'

/** the pendulum's own units → world: pivot height and scale */
const PY = 0.16
const SCALE = 0.7
/** trail samples kept per copy, one per 1/60 s of simulated time */
const TRAIL_MAX = 330
const SAMPLE_EVERY = Math.round(1 / 60 / DT)
/** depth between neighbouring copies once the deck is opened (pendulum units) */
const DECK = 0.005
/** the gentle swing of the plain pendulum, radians */
const SWING = 0.42
const SWING_PERIOD = 2 * Math.PI * Math.sqrt(L1 / 9.81)
/** spread of the tips (pendulum units) at which the eye sees the copies part */
const VISIBLE = 0.03
/** reflection strength of the props in the floor */
const MIRROR = 0.07
const MOTES_SCALE = new THREE.Vector3(1.6, 1.3, 1.6)

const NUDGES: Record<string, number> = { '1e-3': 1e-3, '1e-6': 1e-6, '1e-9': 1e-9 }

/** half-spread of the starting angle (radians) for `deg` degrees between neighbours */
const nudgeOf = (deg: number, n: number) => ((deg * Math.max(1, n - 1)) / 2) * (Math.PI / 180)

/** simulated seconds until the copies visibly part (measured once for the film's own setting) */
const OPEN_100_1E6 = 9.4
function timeToOpen(count: number, deg: number): number {
  if (count === 100 && deg === 1e-6) return OPEN_100_1E6
  const e = new PendulumEnsemble(count, nudgeOf(deg, count))
  const limit = Math.round(40 / DT)
  for (let s = 0; s < limit; s++) {
    e.step()
    if (s % 24 === 0 && e.spread() > VISIBLE) return e.time
  }
  return 40
}

type Mode = 'simple' | 'double' | 'lift' | 'held' | 'running'

const pendulums: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const cloud = motes(engine)

  // ---------------------------------------------------------------- props
  const stage = new THREE.Group()
  stage.position.set(0, PY, 0)
  stage.scale.setScalar(SCALE)
  const reflected = new THREE.Group()
  reflected.position.copy(stage.position)
  reflected.scale.copy(stage.scale)
  const mirror = floorMirror(FLOOR)
  mirror.add(reflected)
  root.add(mirror, stage)

  const trails = new FatSegments(MAX_COPIES * TRAIL_MAX, 1.3, 18)
  const rods = new FatSegments(MAX_COPIES * 2, 2, 19)
  const ring = new FatSegments(48, 1, 19)
  const beads = new Beads(MAX_COPIES * 2 + 1)
  stage.add(trails.line, rods.line, ring.line, beads.points)
  reflected.add(trails.mirror(MIRROR), rods.mirror(MIRROR), beads.mirror(MIRROR))

  // colours: rods from the cold end, weights and trails from the hot end
  const rodColor = rampColor(palette, 0.36).multiplyScalar(2.1)
  const ringColor = rampColor(palette, 0.5).multiplyScalar(0.6)
  const tmp = new THREE.Color()
  /** tone of copy k of n along the hot half of the ramp */
  const hue = (k: number, n: number) => 0.52 + 0.45 * (n > 1 ? k / (n - 1) : 0.7)

  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2
    const a1 = ((i + 1) / 48) * Math.PI * 2
    const r = 0.035
    ring.pos.set([r * Math.cos(a0), r * Math.sin(a0), 0, r * Math.cos(a1), r * Math.sin(a1), 0], i * 6)
  }
  ring.fillColor(ringColor)
  ring.count = 48
  ring.commit(true)
  rods.fillColor(rodColor)
  // the pivot itself
  beads.pos.set([0, 0, 0], MAX_COPIES * 2 * 3)

  // ---------------------------------------------------------------- simulation
  const ens = new PendulumEnsemble(1, 0)
  let mode: Mode = 'simple'
  let copies = 100
  let nudgeKey = '1e-6'
  /** copies drawn (the ensemble's count once released) */
  let shown = 1
  /** simulated seconds per real second */
  let rate = 1
  /** integration owed, in steps */
  let acc = 0
  let swingPhase = -Math.PI / 2
  /** drawn angles per copy, and the state before the last step (for drawing between steps) */
  const d1 = new Float64Array(MAX_COPIES)
  const d2 = new Float64Array(MAX_COPIES)
  const p1 = new Float64Array(MAX_COPIES)
  const p2 = new Float64Array(MAX_COPIES)
  /** lift: from these angles to the release pose */
  let liftFrom1 = 0
  let liftFrom2 = 0
  let liftU = 0
  /** 0..1 how much of the second arm is visible */
  let arm2 = 0
  let deck = 0
  /** brightness of everything the copies draw together, relative to one pendulum */
  let together = 1
  let trailLen = 140
  let trailGain = 0.55
  let fade = 0
  let fadeIn = false
  let deckGoal = 0
  let goWhenHeld = false
  let releasedAt = -1
  let released = false
  let opened = false
  let paced = false
  let tOpen = timeToOpen(copies, 1e-6)

  // trail ring: tip of copy k at slot s is [s·MAX_COPIES + k]
  const trailX = new Float32Array(TRAIL_MAX * MAX_COPIES)
  const trailY = new Float32Array(TRAIL_MAX * MAX_COPIES)
  let head = 0
  let filled = 0
  let sampleClock = 0
  let builtFor = { n: -1, len: -1 }
  let lastSign = 0
  let tickHold = 0

  let count: ReturnType<typeof ctx.label> | null = null
  let clock: ReturnType<typeof ctx.label> | null = null

  const tipOf = (k: number, out: { x: number; y: number }) => {
    const ex = L1 * Math.sin(d1[k])
    const ey = -L1 * Math.cos(d1[k])
    out.x = ex + arm2 * L2 * Math.sin(d2[k])
    out.y = ey - arm2 * L2 * Math.cos(d2[k])
    return out
  }
  const tip = { x: 0, y: 0 }
  const tipWorld = (k: number) => {
    tipOf(k, tip)
    return new THREE.Vector3(tip.x * SCALE, PY + tip.y * SCALE, 0)
  }

  const sample = () => {
    const base = head * MAX_COPIES
    for (let k = 0; k < shown; k++) {
      tipOf(k, tip)
      trailX[base + k] = tip.x
      trailY[base + k] = tip.y
    }
    head = (head + 1) % TRAIL_MAX
    filled = Math.min(TRAIL_MAX, filled + 1)
  }

  /** show `n` copies; new ones inherit copy 0's trail, since until now they were the same pendulum */
  const setShown = (n: number) => {
    if (n > shown) {
      for (let s = 0; s < TRAIL_MAX; s++) {
        const b = s * MAX_COPIES
        for (let k = shown; k < n; k++) {
          trailX[b + k] = trailX[b]
          trailY[b + k] = trailY[b]
        }
      }
      for (let k = shown; k < n; k++) {
        d1[k] = d1[0]
        d2[k] = d2[0]
        p1[k] = p1[0]
        p2[k] = p2[0]
      }
    }
    shown = n
  }

  /** per-copy colours: weights and trail ages */
  const colour = () => {
    const n = shown
    const len = Math.round(trailLen)
    if (builtFor.n === n && builtFor.len === len) return
    builtFor = { n, len }
    for (let k = 0; k < n; k++) {
      rampColor(palette, hue(k, n), tmp)
      const e = k * 6
      beads.col[e] = tmp.r * 0.7
      beads.col[e + 1] = tmp.g * 0.7
      beads.col[e + 2] = tmp.b * 0.7
      beads.col[e + 3] = tmp.r * 2.2
      beads.col[e + 4] = tmp.g * 2.2
      beads.col[e + 5] = tmp.b * 2.2
    }
    rampColor(palette, 0.55, tmp).multiplyScalar(0.8)
    beads.col.set([tmp.r, tmp.g, tmp.b], MAX_COPIES * 2 * 3)
    const col = trails.col
    for (let k = 0; k < n; k++) {
      rampColor(palette, hue(k, n), tmp)
      for (let a = 0; a < len; a++) {
        const b0 = Math.pow(1 - a / len, 1.6)
        const b1 = Math.pow(1 - (a + 1) / len, 1.6)
        const o = (a * n + k) * 6
        col[o] = tmp.r * b0
        col[o + 1] = tmp.g * b0
        col[o + 2] = tmp.b * b0
        col[o + 3] = tmp.r * b1
        col[o + 4] = tmp.g * b1
        col[o + 5] = tmp.b * b1
      }
    }
    trails.count = len * n
    trails.commitColors()
  }

  const draw = () => {
    colour()
    const n = shown
    const rp = rods.pos
    const bp = beads.pos
    for (let k = 0; k < n; k++) {
      const z = (k - (n - 1) / 2) * deck
      const ex = L1 * Math.sin(d1[k])
      const ey = -L1 * Math.cos(d1[k])
      const tx = ex + arm2 * L2 * Math.sin(d2[k])
      const ty = ey - arm2 * L2 * Math.cos(d2[k])
      rp.set([0, 0, z, ex, ey, z, ex, ey, z, tx, ty, z], k * 12)
      bp.set([ex, ey, z, tx, ty, z], k * 6)
      // in the plain pendulum the elbow is the weight; the second weight grows in with its arm
      beads.size[k * 2] = 4 + 4 * (1 - arm2)
      beads.size[k * 2 + 1] = 7 * Math.sqrt(arm2)
    }
    beads.size[MAX_COPIES * 2] = 4
    rods.count = 2 * n
    rods.commit()
    // the pivot bead sits after the copies: draw it by moving it into the range
    bp.set([0, 0, 0], n * 6)
    beads.col.copyWithin(n * 6, MAX_COPIES * 2 * 3, MAX_COPIES * 2 * 3 + 3)
    beads.size[n * 2] = 4
    beads.count = n * 2 + 1
    beads.commit(true)

    const len = Math.min(Math.round(trailLen), filled)
    const tp = trails.pos
    // segment a joins the point of age a to age a + 1: age 0 is the drawn tip, age j the j-th newest sample
    for (let a = 0; a < len; a++) {
      const from = ((head - a + TRAIL_MAX * 2) % TRAIL_MAX) * MAX_COPIES
      const to = ((head - a - 1 + TRAIL_MAX * 2) % TRAIL_MAX) * MAX_COPIES
      for (let k = 0, o = a * n * 6; k < n; k++, o += 6) {
        const z = (k - (n - 1) / 2) * deck
        if (a === 0) {
          tipOf(k, tip)
          tp[o] = tip.x
          tp[o + 1] = tip.y
        } else {
          tp[o] = trailX[from + k]
          tp[o + 1] = trailY[from + k]
        }
        tp[o + 2] = z
        tp[o + 3] = trailX[to + k]
        tp[o + 4] = trailY[to + k]
        tp[o + 5] = z
      }
    }
    trails.count = len * n
    trails.commit()

    // n copies drawn on top of one another add up: keep their sum to `together` × one pendulum
    const per = together / n
    rods.opacity = fade * Math.max(per, 0.04)
    trails.opacity = fade * trailGain * Math.max(per, 0.04)
    beads.opacity = fade * Math.min(1, Math.max(per * 1.5, 0.16))
    ring.opacity = fade
  }

  /** start the hundred from the release pose */
  const letGo = () => {
    if (released && mode === 'running') return
    ens.reset(copies, nudgeOf(NUDGES[nudgeKey], copies))
    setShown(ens.count)
    for (let k = 0; k < ens.count; k++) {
      p1[k] = d1[k] = ens.t1[k]
      p2[k] = d2[k] = ens.t2[k]
    }
    acc = 0
    ctx.cancel('deck')
    deck = 0
    deckGoal = 0
    mode = 'running'
    released = true
    opened = false
    releasedAt = 0
    arm2 = 1
    liftU = 1
    sound.sfx('release', 0.5)
  }

  /** the lift is done: hold, or let go if the visitor asked to while it was lifting */
  const held = () => {
    mode = 'held'
    if (goWhenHeld) {
      goWhenHeld = false
      letGo()
    }
  }

  /** everyone back to the release pose, held (lab) */
  const lineUp = () => {
    ctx.cancel('lift')
    ctx.cancel('deck')
    const d0 = deck
    ctx.tween(1.2, (u) => (deck = d0 * (1 - u)), { ease: easeInOut, tag: 'deck' })
    deckGoal = 0
    liftFrom1 = d1[0]
    liftFrom2 = d2[0]
    liftU = 0
    mode = 'lift'
    released = false
    opened = false
    releasedAt = -1
    paced = false
    rate = 1
    ctx.tween(1.6, (u) => (liftU = u), { ease: easeInOut, tag: 'lift', done: held })
  }

  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      if (i === n - 1) {
        for (let k = 0; k < ens.count; k++) {
          p1[k] = ens.t1[k]
          p2[k] = ens.t2[k]
        }
      }
      ens.step()
      if (ens.steps % SAMPLE_EVERY === 0) {
        // the trail takes the copies' exact states, not the drawn ones
        const base = head * MAX_COPIES
        for (let k = 0; k < ens.count; k++) {
          trailX[base + k] = L1 * Math.sin(ens.t1[k]) + arm2 * L2 * Math.sin(ens.t2[k])
          trailY[base + k] = -L1 * Math.cos(ens.t1[k]) - arm2 * L2 * Math.cos(ens.t2[k])
        }
        head = (head + 1) % TRAIL_MAX
        filled = Math.min(TRAIL_MAX, filled + 1)
      }
    }
  }

  const tick = (dt: number) => {
    // a soft tick each time the leading pendulum passes the bottom, while the copies agree
    tickHold -= dt
    const s = Math.sign(Math.sin(d1[0]))
    if (s !== 0 && lastSign !== 0 && s !== lastSign && tickHold <= 0 && !opened && fade > 0.5) {
      const pitch = mode === 'simple' ? 880 : 740
      sound.note(pitch, { gain: 0.07, seconds: 0.35, pan: s * 0.25, wet: 0.5 })
      tickHold = 0.25
    }
    if (s !== 0) lastSign = s
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      void dust.morphTo(cloud, { ...haze(palette), gain: 0.07, size: 0.0032 }, { seconds: 3, swirl: 1.1 })
      fadeIn = true
      rig.shot(
        { target: [0, PY - 0.3, 0], distance: 2.25, azimuth: 0, elevation: 3, fov: 38, orbit: 0, aperture: 0.003, portrait: { distance: 1.55, target: [0, PY - 0.62, 0] } },
        3,
      )
    },

    cues: [
      // "Hang a second one from the end of the first."
      at(1, 'second one', () => {
        const w = (SWING * 2 * Math.PI * Math.cos(swingPhase)) / SWING_PERIOD
        ens.reset(1, 0)
        ens.t1[0] = ens.t2[0] = d1[0]
        ens.w1[0] = ens.w2[0] = w
        p1[0] = p2[0] = d1[0]
        acc = 0
        mode = 'double'
        ctx.tween(1.8, (u) => (arm2 = u), { ease: easeInOut })
        rig.shot({ target: [0, PY - 0.55, 0], distance: 2.9, elevation: 4, portrait: { distance: 1.8, target: [0, PY - 0.8, 0] } }, 3)
      }),
      // "Here are a hundred of them": lifted to the release pose, a hundred deep
      at(2, () => {
        liftFrom1 = d1[0]
        liftFrom2 = d2[0]
        liftU = 0
        mode = 'lift'
        ctx.tween(1.5, (u) => (liftU = u), { ease: easeInOut, tag: 'lift', done: held })
        setShown(copies)
        ctx.tween(2.4, (u) => (together = 1 + 2.2 * u), { ease: easeInOut })
        rig.shot({ target: [0, PY - 0.24, 0], distance: 3.1, azimuth: 8, elevation: 6, orbit: 0, aperture: 0.003, portrait: { distance: 2.25, target: [0, PY - 0.6, 0] } }, 2.6)
      }),
      at(2, 'a hundred', 0.2, () => {
        count = ctx.portrait
          ? ctx.label(`${copies} pendulums`, { kind: 'note', at: [0, PY + 0.06, 0], align: 'above', dy: -16 })
          : ctx.label(`${copies} pendulums`, { kind: 'note', at: () => tipWorld(0), align: 'right', dx: 30, dy: -10, leader: true })
      }),
      at(2, 'let go', () => {
        letGo()
        // pace the swing so the copies part as the narrator says so, then run at true speed
        rate = tOpen / Math.max(4, ctx.until(5) + 0.25)
        paced = true
      }),
      at(3, 'a millionth', () => count?.set('each a millionth of a degree from the next')),
      at(4, () => count?.remove()),
      // "Then the fan opens": the futures part in depth too, and the camera turns to see it
      at(5, () => {
        clock = readout(ctx)
        rig.shot({ target: [0, PY - 0.2, 0], distance: 3.3, azimuth: 34, elevation: 9, orbit: 1.4, aperture: 0.004, portrait: { distance: 2.35, target: [0, PY - 0.55, 0] } }, 6)
      }),
      at(6, () => {
        ctx.tween(6, (u) => {
          trailLen = 140 + (TRAIL_MAX - 140) * u
          trailGain = 0.6 + 1.0 * u
        }, { ease: easeInOut })
      }),
      at(7, () => {
        rig.shot({ target: [0, PY - 0.12, 0], distance: 3.9, azimuth: 20, elevation: 11, orbit: 1.8, portrait: { distance: 2.6, target: [0, PY - 0.5, 0] } }, 8)
      }),
    ],

    explore() {
      // a hundred of them, let go; the counts and the gap are in the drawer
      ctx.after(2.6, () => {
        if (mode === 'held') {
          letGo()
        } else {
          if (mode !== 'lift') lineUp()
          setShown(copies)
          together = 3.2
          goWhenHeld = true
        }
        rate = 1
        paced = false
      })
    },

    update(dt) {
      // the act's title card may still be up: the pendulum appears as it leaves
      if (fadeIn) {
        fadeIn = false
        const wait = ctx.until(0) - 1.4
        ctx.after(Number.isFinite(wait) ? Math.max(0, wait) : 0, () => ctx.tween(2.2, (u) => (fade = u), { ease: easeOut }))
      }
      driftMotes(cloud, engine.time)
      // keep the motes out of the lens: the camera works inside their hollow
      cloud.matrix.scale(MOTES_SCALE)
      if (dt > 0) {
        if (mode === 'simple') {
          swingPhase += (dt * 2 * Math.PI) / SWING_PERIOD
          d1[0] = d2[0] = SWING * Math.sin(swingPhase)
          sampleClock += dt
          if (sampleClock >= 1 / 60) {
            // one sample per frame at most: repeated samples of one drawn pose would kink the trail
            sampleClock %= 1 / 60
            sample()
          }
        } else if (mode === 'lift' || mode === 'held') {
          const u = mode === 'held' ? 1 : liftU
          // the outer arm swings up a little behind the inner one, like a lifted chain
          const u2 = Math.min(1, Math.max(0, (u - 0.12) / 0.88))
          const a = liftFrom1 + (THETA0 - liftFrom1) * u
          const b = liftFrom2 + (THETA0 - liftFrom2) * (u2 * u2 * (3 - 2 * u2))
          for (let k = 0; k < shown; k++) {
            d1[k] = a
            d2[k] = b
          }
          sampleClock += dt
          if (sampleClock >= 1 / 60) {
            // one sample per frame at most: repeated samples of one drawn pose would kink the trail
            sampleClock %= 1 / 60
            sample()
          }
        } else {
          const r = ctx.lab ? 1 : rate
          acc += (Math.min(dt, 1 / 20) * r) / DT
          const n = Math.floor(acc)
          acc -= n
          if (n > 0) step(n)
          const alpha = acc
          for (let k = 0; k < ens.count; k++) {
            d1[k] = p1[k] + (ens.t1[k] - p1[k]) * alpha
            d2[k] = p2[k] + (ens.t2[k] - p2[k]) * alpha
          }
          if (mode === 'running') {
            releasedAt = ens.time
            if (!opened && ens.steps % 24 === 0 && ens.spread() > VISIBLE) opened = true
            if (opened && deckGoal === 0) {
              // the futures part in depth as well, so a turning camera sees each one
              deckGoal = (DECK * 100) / Math.max(10, ens.count)
              const goal = deckGoal
              ctx.tween(7, (u) => (deck = goal * u), { ease: easeInOut, tag: 'deck' })
            }
            if (paced && opened) {
              paced = false
              const from = rate
              ctx.tween(4, (u) => (rate = from + (1 - from) * u), { ease: easeInOut })
            }
          }
        }
        tick(dt)
      }
      clock?.set(releasedAt >= 0 ? `released  ${releasedAt.toFixed(1)} s` : '')
      draw()
      const dpr = engine.renderer.getPixelRatio()
      for (const l of [trails, rods, ring]) l.setPixelRatio(dpr)
      beads.setPixelRatio(dpr)
    },

    exit() {
      const f0 = fade
      ctx.tween(1.5, (u) => (fade = f0 * (1 - u)))
    },

    dispose() {
      trails.dispose()
      rods.dispose()
      ring.dispose()
      beads.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Copies',
        options: [
          { value: '10', label: '10' },
          { value: '100', label: '100' },
          { value: '200', label: '200' },
        ],
        get: () => String(copies),
        set: (v) => {
          copies = Number(v)
          tOpen = timeToOpen(copies, NUDGES[nudgeKey])
          if (mode === 'running' || mode === 'held') {
            lineUp()
            setShown(copies)
          }
        },
      },
      {
        kind: 'choice',
        label: 'Between neighbours',
        options: [
          { value: '1e-3', label: '0.001°' },
          { value: '1e-6', label: '0.000001°' },
          { value: '1e-9', label: '10⁻⁹ °' },
        ],
        get: () => nudgeKey,
        set: (v) => {
          nudgeKey = v
          tOpen = timeToOpen(copies, NUDGES[nudgeKey])
        },
      },
      { kind: 'action', label: 'Let go', run: () => {
        if (mode === 'held') {
          letGo()
        } else {
          // lift them back to the release pose first, then let go
          if (mode !== 'lift') lineUp()
          setShown(copies)
          together = 3.2
          goWhenHeld = true
        }
        rate = 1
        paced = false
      } },
      { kind: 'action', label: 'Line them up again', run: () => {
        goWhenHeld = false
        lineUp()
        setShown(copies)
      } },
      { kind: 'readout', label: 'Time since release', get: () => (releasedAt >= 0 ? `${releasedAt.toFixed(1)} s` : '—') },
      { kind: 'readout', label: 'They part after', get: () => `${tOpen.toFixed(1)} s` },
    ],
    notes: [
      'A single pendulum is the textbook example of order: for small swings its period depends only on its length, which is why it kept time in clocks for three centuries. Hang a second pendulum from its end and the pair becomes one of the simplest chaotic systems there is.',
      'Each copy here is integrated separately with the exact equations of motion, released from the same angle except for a tiny twist of the upper arm: a millionth of a degree between neighbours. They swing together for about nine seconds, and then the difference, doubling over and over, takes over. Make the twist a thousand times smaller and you buy only about four more seconds.',
      'No real pendulum can be set up to a millionth of a degree, let alone a billionth. That is why no two runs of a real double pendulum ever look the same.',
    ],
  }
}

export default pendulums
