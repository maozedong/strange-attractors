/**
 * Roll the dice. Three corners and one bright dot. The dot hops halfway to whichever corner
 * the die picks, leaving a faint mark where it lands; then the whole dust scatters and plays the
 * same game at once, and Sierpiński's triangle condenses out of the noise. Change the moves and
 * the same blind dice find Barnsley's fern.
 *
 * Two sources: a CPU board for the single dot (every particle belongs to a corner, a mark, or
 * the dot itself), then the GPU chaos game (`IfsSource`). Both live in the chaos game's stage
 * units, so the hand-over is a plain morph.
 */
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { Engine } from '../engine/Engine'
import { rampColor } from '../engine/palettes'
import { PointsSource } from '../engine/sources'
import { at, easeInOut, easeOut, type SceneFactory } from '../film/types'
import type { IfsFrame } from '../fractal/ifs/presets'
import type { IfsPreset } from '../fractal/types'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../scene/trajectories/lineMaterial'
import { sound } from '../sound/audio'
import { plate } from './kit/hud'
import { IfsSource } from './kit/IfsSource'
import { ink } from './kit/shared'

/** world units per stage unit, and where the stage's centre stands */
const K = 1
const LIFT = 0.02
/** where the dot is first placed (stage units): outside the triangle, so it is seen pulled in */
const START: [number, number] = [0.66, 0.4]
/** the die, fixed so every showing is the same */
const DIE = [0, 2, 1, 0, 2, 2, 1, 0, 1, 2, 0, 1, 0, 2, 1]
/** marks left behind, at most */
const MARKS = 14
/** the haze the game starts from */
const PLANE: IfsFrame = { cx: 0, cy: 0, halfW: 1.75, halfH: 1.08 }
/** where everything is thrown when the whole dust plays: wider than the frame, so no edge shows */
const THROW: IfsFrame = { cx: 0, cy: -0.05, halfW: 2.9, halfH: 1.75 }
/** a triad for the three corners */
const PITCH = [392, 493.9, 587.3]
/** brightness of one particle once the shape has formed */
const GAME_GAIN = 0.21

const PRESET_NAMES: Record<IfsPreset, [string, string]> = {
  sierpinski: ['Sierpiński’s triangle', 'Wacław Sierpiński, 1915'],
  fern: ['Barnsley’s fern', 'Michael Barnsley, 1988'],
  dragon: ['Heighway’s dragon', 'John Heighway, 1966'],
  leaf: ['A maple leaf', 'Barnsley’s maple, four moves'],
  spiral: ['A spiral', 'three moves'],
}

interface Kept {
  ifs: IfsSource
  board: PointsSource
}
const keep = new WeakMap<Engine, Kept>()

/** sources outlive the scene (the next scene flies out of them), so they are kept per engine */
function sources(engine: Engine): Kept {
  let k = keep.get(engine)
  if (!k) {
    k = { ifs: new IfsSource(engine.renderer, engine.size), board: new PointsSource(engine.size, true) }
    keep.set(engine, k)
  }
  return k
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (e: number) => {
  const x = Math.min(1, Math.max(0, e))
  return x * x * (3 - 2 * x)
}

const roll: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const { ifs, board } = sources(engine)
  const n = board.count
  ifs.matrix.makeScale(K, K, K).setPosition(0, LIFT, 0)
  board.matrix.copy(ifs.matrix)
  ifs.setPreset('sierpinski', 0)
  ifs.rate = 0

  // ---------------------------------------------------------------- the board
  const corners: [number, number][] = [0, 1, 2].map((i) => ifs.fixedPoint(i))
  /** per particle: 0..2 a corner, 3 the dot, 4 + m mark m */
  const group = new Uint8Array(n)
  const haze = new Float32Array(n * 3)
  const off = new Float32Array(n * 2)
  const stag = new Float32Array(n)
  {
    const r = rng(0x5eed1e)
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r())
    for (let i = 0; i < n; i++) {
      const g = r()
      group[i] = g < 0.075 ? Math.floor(g / 0.025) : g < 0.075 + MARKS * 0.007 ? 4 + Math.floor((g - 0.075) / 0.007) : 3
      // a soft cloud with no edge
      haze[i * 3] = gauss() * PLANE.halfW * 0.5
      haze[i * 3 + 1] = gauss() * PLANE.halfH * 0.5
      haze[i * 3 + 2] = (r() - 0.5) * 0.4
      off[i * 2] = gauss()
      off[i * 2 + 1] = gauss()
      stag[i] = r()
    }
  }
  const aux = (g: number) => (g < 3 ? 0.88 : g === 3 ? 0.8 : 0.66)
  const spread = (g: number) => (g < 3 ? 0.009 : g === 3 ? 0.011 : 0.0045)

  /** 0..1: corners gathered out of the haze; the dot gathered */
  let cornersIn = 0
  let dotIn = 0
  /** the dot: landings so far, and the hop in flight */
  const landings: [number, number][] = [[START[0], START[1]]]
  let hopFrom: [number, number] = [START[0], START[1]]
  let hopTo: [number, number] = [START[0], START[1]]
  let hopU = 1
  let hopSeconds = 1
  let hops = 0
  const dot: [number, number] = [START[0], START[1]]
  let boardDirty = true
  let settle = 0
  let onBoard = false

  const writeBoard = () => {
    const d = board.data
    const eC = cornersIn
    const eD = dotIn
    for (let i = 0; i < n; i++) {
      const g = group[i]
      const o = i * 4
      const s = spread(g)
      let tx: number
      let ty: number
      let e: number
      if (g < 3) {
        tx = corners[g][0]
        ty = corners[g][1]
        e = smooth(eC * 1.6 - stag[i] * 0.6)
      } else {
        // a mark stays at landing m once the dot has left it
        const m = g - 3
        if (g > 3 && hops > m) {
          tx = landings[m][0]
          ty = landings[m][1]
        } else {
          tx = dot[0]
          ty = dot[1]
        }
        e = smooth(eD * 1.6 - stag[i] * 0.6)
      }
      tx += off[i * 2] * s
      ty += off[i * 2 + 1] * s
      const hx = haze[i * 3]
      const hy = haze[i * 3 + 1]
      const hz = haze[i * 3 + 2]
      d[o] = hx + (tx - hx) * e
      d[o + 1] = hy + (ty - hy) * e
      d[o + 2] = hz * (1 - e)
      d[o + 3] = aux(g)
    }
    board.commit()
    boardDirty = false
  }

  // ---------------------------------------------------------------- the line to the chosen corner
  const lineMat = createTrajectoryLineMaterial(1.2)
  lineMat.vertexColors = false
  const lineColor = rampColor(palette, 0.62).multiplyScalar(1.3)
  const lineGeo = new LineGeometry()
  lineGeo.setPositions([0, 0, 0, 1, 0, 0])
  const line = new Line2(lineGeo, lineMat)
  line.frustumCulled = false
  line.renderOrder = 20
  line.visible = false
  root.add(line)
  let lineOpacity = 0
  const world = (p: [number, number], out = new THREE.Vector3()) => out.set(p[0], p[1], 0).applyMatrix4(ifs.matrix)
  const a3 = new THREE.Vector3()
  const b3 = new THREE.Vector3()

  // ---------------------------------------------------------------- labels
  const rings: ReturnType<typeof ctx.label>[] = []
  let name: ReturnType<typeof ctx.label> | null = null
  const showRings = () => {
    if (rings.length) return
    for (const c of corners) {
      const l = ctx.label('', { kind: 'note', at: world(c), align: 'center' })
      l.el.classList.add('label--ring')
      rings.push(l)
    }
  }
  const hideRings = () => {
    while (rings.length) rings.pop()?.remove()
  }
  const pulse = (k: number) => {
    const span = rings[k]?.el.firstElementChild as HTMLElement | null
    span?.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', borderColor: 'var(--ink-2)' },
        { transform: 'translate(-50%, -50%) scale(1.55)', borderColor: 'var(--ink)', offset: 0.25 },
        { transform: 'translate(-50%, -50%) scale(1)', borderColor: 'var(--ink-2)' },
      ],
      { duration: 700, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    )
  }
  const named = (preset: IfsPreset) => {
    name?.remove()
    const [t, s] = PRESET_NAMES[preset]
    name = plate(ctx, t, s)
  }

  // ---------------------------------------------------------------- the single dot's game
  /** roll the die and move halfway; `withLine` draws the way to the corner first */
  const hop = (seconds: number, withLine: boolean) => {
    if (hops >= DIE.length || !onBoard) return
    const k = DIE[hops]
    const c = corners[k]
    // a hop still in flight lands now
    dot[0] = hopTo[0]
    dot[1] = hopTo[1]
    hopFrom = [dot[0], dot[1]]
    hopTo = [(dot[0] + c[0]) / 2, (dot[1] + c[1]) / 2]
    hops++
    landings.push(hopTo)
    hopU = 0
    hopSeconds = seconds
    pulse(k)
    if (seconds >= 0.3 || hops % 2 === 0) sound.note(PITCH[k], { gain: 0.12, seconds: 1.4, pan: (c[0] / 1.2) * 0.6 })
    if (withLine) {
      world(hopFrom, a3)
      world(c, b3)
      lineGeo.setPositions([a3.x, a3.y, a3.z, b3.x, b3.y, b3.z])
      ctx.tween(0.35, (u) => (lineOpacity = u), { tag: 'line' })
    } else {
      lineOpacity = 0
    }
    boardDirty = true
  }

  /** a run of hops, `delays` seconds from now, each `durs` long */
  const run = (delays: number[], durs: number[]) => {
    delays.forEach((t, i) => ctx.after(Math.max(0, t), () => hop(durs[i], durs[i] >= 0.5)))
  }

  // ---------------------------------------------------------------- the whole dust plays
  const gameLook = () => ({
    ...ink(palette),
    tone: 'aux' as const,
    toneBias: -0.04,
    toneScale: 0.98,
    size: 0.0022,
    minPx: 0.55,
    gain: GAME_GAIN * 10,
    streak: 0.8,
    twinkle: 0.12,
  })

  let rolling = false
  let gainScale = 1
  const scatterAll = (seconds = 1.1) => {
    onBoard = false
    rolling = true
    hideRings()
    ctx.tween(0.4, (u) => (lineOpacity = (1 - u) * lineOpacity), { tag: 'line' })
    ifs.rate = 0
    ifs.scatter(THROW)
    void dust.morphTo(ifs, gameLook(), { seconds, swirl: 0.35 })
  }

  const setRate = (r: number) => {
    ifs.rate = r
  }

  /** the fern's four moves in neighbouring greens; the others in three far-apart inks */
  const shade = (p: IfsPreset) => {
    const [b1, s1] = p === 'fern' ? [0.26, 0.62] : [-0.04, 0.98]
    const b0 = dust.look.toneBias
    const s0 = dust.look.toneScale
    ctx.tween(3, (u) => {
      dust.look.toneBias = b0 + (b1 - b0) * u
      dust.look.toneScale = s0 + (s1 - s0) * u
    }, { tag: 'shade' })
  }

  const setPreset = (p: IfsPreset) => {
    if (!rolling) scatterAll(1)
    ifs.setPreset(p)
    shade(p)
  }

  return {
    enter() {
      // a page standing in the dark: no mirror under it (its reflection would sit under the captions)
      dust.floorY = null
      engine.backdrop.floor = 0.55
      // the board, all haze: the corners and the dot gather out of it on the words
      cornersIn = 0
      dotIn = 0
      // twice, so last frame's state is the haze too (no streaks from wherever it was before)
      writeBoard()
      writeBoard()
      onBoard = true
      void dust.morphTo(
        board,
        { ...ink(palette), tone: 'aux', toneBias: -0.1, toneScale: 0.75, size: 0.0024, minPx: 0.6, gain: 0.2, streak: 1.2, twinkle: 0.3 },
        { seconds: 3, swirl: 1 },
      )
      rig.shot(
        { target: [0, -0.1, 0], distance: 3.95, azimuth: -6, elevation: 5, fov: 38, orbit: 0.35, aperture: 0.003, portrait: { distance: 3.4 } },
        3.2,
      )
    },

    cues: [
      // "Three corners"
      at(0, 'Three', () => {
        showRings()
        ctx.tween(1.3, (u) => {
          cornersIn = u
          boardDirty = true
        }, { ease: easeOut, tag: 'corners' })
      }),
      // "and a dot placed anywhere": everything else falls into one bright point
      at(0, 'a dot', -0.1, () => {
        ctx.tween(1.5, (u) => {
          dotIn = u
          boardDirty = true
        }, { ease: easeInOut, tag: 'dot' })
        ctx.tween(1.5, (u) => {
          dust.look.gain = 0.2 + (0.022 - 0.2) * u
          dust.look.toneBias = -0.1 + 0.1 * u
          dust.look.toneScale = 0.75 + 0.25 * u
        })
      }),
      // "Roll a die, and move the dot halfway to whichever corner comes up."
      at(1, 'and move', -0.35, () => hop(1.25, true)),
      at(1, 'corner', 0, () => hop(0.9, true)),
      // "Mark the spot. Roll again." and then quicker and quicker
      at(2, -0.1, () => {
        const rollAt = ctx.until(2, 'Roll')
        const next = ctx.until(3)
        run([0.05, rollAt - 0.05, next - 0.75, next - 0.25, next + 0.2, next + 0.55, next + 0.85, next + 1.1], [0.6, 0.5, 0.42, 0.36, 0.3, 0.25, 0.21, 0.18])
      }),
      // "Nothing could be more random": the whole dust is thrown over the plane
      at(3, 'random', -0.15, () => scatterAll(1.15)),
      // "So keep rolling": every particle plays at once
      at(3, 'So', () => {
        setRate(1.6)
        ctx.after(1.0, () => setRate(5))
        ctx.after(1.5, () => setRate(24))
      }),
      // "A triangle full of holes"
      at(4, () => named('sierpinski')),
      // "with smaller triangles in every corner, all the way down": into the top corner
      at(4, 'holes', () => {
        // closer in, the same light fills more of the frame: ease it down, and let the name go
        ctx.tween(3.5, (u) => (gainScale = 1 - 0.3 * u), { ease: easeInOut, tag: 'gscale' })
        ctx.after(2.2, () => {
          name?.remove()
          name = null
        })
        rig.shot({ target: [0, 0.7 * K + LIFT, 0], distance: 0.55, azimuth: -2, elevation: 3, orbit: 0, aperture: 0.002 }, Math.max(3, ctx.until(4, 'all the way') + 0.4))
      }),
      // "Now change the moves. Four of them, each a squeeze and a turn."
      at(5, () => {
        ctx.tween(3, (u) => (gainScale = 0.7 + 0.3 * u), { ease: easeInOut, tag: 'gscale' })
        name?.remove()
        name = null
        rig.shot({ target: [0, 0.02, 0], distance: 3.4, azimuth: 4, elevation: 4, orbit: 0.3, aperture: 0.003 }, 3.4)
      }),
      at(5, 'change', () => {
        ifs.setPreset('fern', 0)
        setRate(1.4)
        shade('fern')
      }),
      // "The same blind dice draw a fern."
      at(6, 'draw', -0.3, () => setRate(24)),
      at(6, 'fern', () => named('fern')),
      // "The dice aren't making the fern. They are only finding it." a slow rise along it
      at(7, () => {
        name?.remove()
        name = null
        rig.shot({ target: [0.02, -0.5, 0], distance: 1.55, azimuth: 8, elevation: 2, orbit: 0, aperture: 0.004 }, 3)
        ctx.after(3, () => rig.shot({ target: [-0.02, 0.48, 0], distance: 1.75, azimuth: -6, elevation: 6, orbit: 0, aperture: 0.004 }, 10))
      }),
      // "It was already there in the rules": a nudge to the rules bends the plant
      at(8, () => {
        ctx.tween(3, (u) => ifs.setVariation(0.8 * u), { ease: easeInOut, tag: 'species' })
        ctx.after(3.1, () => ctx.tween(4.2, (u) => ifs.setVariation(0.8 - 1.4 * u), { ease: easeInOut, tag: 'species' }))
      }),
      at('end', () => rig.shot({ target: [0, 0.02, 0], distance: 3.3, elevation: 4 }, 3)),
    ],

    explore() {
      // straight to the game being played by the whole dust; the moves are in the drawer
      showRings()
      ctx.after(1.2, () => {
        scatterAll(1)
        ctx.after(1.1, () => setRate(2))
        ctx.after(3.4, () => setRate(24))
      })
    },

    update(dt) {
      if (onBoard) {
        if (hopU < 1 && dt > 0) {
          hopU = Math.min(1, hopU + dt / hopSeconds)
          const e = easeInOut(hopU)
          dot[0] = hopFrom[0] + (hopTo[0] - hopFrom[0]) * e
          dot[1] = hopFrom[1] + (hopTo[1] - hopFrom[1]) * e
          boardDirty = true
          if (hopU >= 1) ctx.tween(0.5, (u) => (lineOpacity = Math.min(lineOpacity, 1 - u)), { tag: 'line' })
        }
        if (boardDirty) {
          writeBoard()
          settle = 2
        } else if (settle > 0 && dt > 0) {
          // once still, let last frame catch up so the streaks close
          settle--
          board.commit()
        }
      }
      if (rolling && dust.source === ifs) {
        // thrown wide, the light is spread thin: bring it up, and down again as the copies shrink
        dust.look.gain = GAME_GAIN * gainScale * (1 + 9 * Math.pow(0.4, ifs.rolls))
      }
      lineMat.color.copy(lineColor).multiplyScalar(lineOpacity)
      line.visible = lineOpacity > 0.003
      setLinePixelRatio(lineMat, engine.renderer.getPixelRatio())
    },

    exit() {
      ctx.tween(0.6, (u) => (lineOpacity = (1 - u) * lineOpacity), { tag: 'line' })
    },

    dispose() {
      lineGeo.dispose()
      lineMat.dispose()
      // the sources are kept (see `sources`): the next scene is still flying out of them
    },

    lab: [
      {
        kind: 'choice',
        label: 'Moves',
        options: (['sierpinski', 'fern', 'dragon', 'leaf', 'spiral'] as IfsPreset[]).map((p) => ({ value: p, label: PRESET_NAMES[p][0] })),
        get: () => ifs.preset,
        set: (v) => {
          setPreset(v as IfsPreset)
          if (ifs.rate === 0) ifs.rate = 24
        },
      },
      {
        kind: 'slider',
        label: 'Species',
        min: -1,
        max: 1,
        step: 0.01,
        get: () => ifs.variation,
        set: (v) => {
          ctx.cancel('species')
          ifs.setVariation(v)
        },
        format: (v) => (v === 0 ? 'as published' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`),
      },
      {
        kind: 'slider',
        label: 'Rolls per second',
        min: 0,
        max: 60,
        step: 0.5,
        get: () => ifs.rate,
        set: (v) => {
          if (!rolling) scatterAll(1)
          setRate(v)
        },
        format: (v) => (v === 0 ? 'held' : v.toFixed(1)),
      },
      {
        kind: 'action',
        label: 'Scatter again',
        run: () => {
          const r = ifs.rate || 24
          if (rolling) dust.setSource(dust.bake(), { ...dust.look })
          scatterAll(1)
          ctx.after(1.1, () => setRate(Math.min(r, 2)))
          ctx.after(3.2, () => setRate(r))
        },
      },
      { kind: 'readout', label: 'Rolls', get: () => (rolling ? ifs.rolls.toLocaleString('en-US') : String(hops)) },
    ],
    notes: [
      'Every particle plays the game on its own: at each roll it picks one of the moves at random, with fixed odds, and applies it. For the triangle each move is "halfway to a corner". For the fern there are four: one shrinks the whole plant into its next frond up, two make the lowest leaves, and one, chosen only one time in a hundred, flattens everything onto the stalk.',
      'Whatever the starting point, after a handful of rolls every particle is within a hair of the same set. That set is the attractor of the moves, a shape that is exactly the union of shrunken copies of itself. Sierpiński described the triangle in 1915 as a curve; Michael Barnsley turned the idea into the chaos game in 1988, and found that 28 numbers draw a fern.',
      'The species slider turns and scales the moves a few degrees and a few percent about their own fixed points: a different set of rules, a different plant. The dice never change; only the rules do.',
    ],
  }
}

export default roll
