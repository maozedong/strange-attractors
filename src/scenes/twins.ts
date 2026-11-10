/**
 * Twins. Two copies of the same system, a millionth apart. Drawn additively, so while they
 * agree you see one pale line; when they part it splits into its two colours. A small chart
 * shows the gap between them climbing a straight line on a log scale: doubling, and doubling.
 */
import { rampColor } from '../engine/palettes'
import { at, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { getSystem } from '../systems'
import type { Vec3 } from '../types'
import { Paths, timeToSplit } from './kit/Paths'
import { Plot } from './kit/Plot'
import { FLOOR, LORENZ_SEED, lorenzFlow, resetLorenz, silk } from './kit/shared'

/** the gap (system units) at which the eye sees two paths */
const VISIBLE = 3

const superscript = (n: number) =>
  String(n)
    .split('')
    .map((ch) => (ch === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(ch)]))
    .join('')

function formatGap(g: number): string {
  if (!Number.isFinite(g)) return ''
  if (g >= 1) return g.toFixed(1)
  if (g >= 0.01) return g.toFixed(3)
  const e = Math.floor(Math.log10(g))
  return `${(g / Math.pow(10, e)).toFixed(1)} × 10${superscript(e)}`
}

const twins: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const sys = getSystem('lorenz')
  const P = sys.params.map((p) => p.default)
  const flow = lorenzFlow(engine)
  const blue = rampColor(palette, 0.26).multiplyScalar(2.6)
  const amber = rampColor(palette, 0.78).multiplyScalar(1.7)
  const paths = new Paths(sys, P, [blue, amber], 1.5)
  root.add(paths.object)

  let gap0 = 1e-6
  let gapKey = '1e-6'
  let plot: Plot | null = null
  /** log10(gap) samples for the chart */
  const history: number[] = []
  let sampleClock = 0
  let running = false
  /** the two have visibly parted since the last launch */
  let parted = false

  const launch = (gap: number, history_ = 1100) => {
    gap0 = gap
    const b: Vec3 = [LORENZ_SEED[0] + gap, LORENZ_SEED[1], LORENZ_SEED[2]]
    paths.start([LORENZ_SEED, b], history_, true)
    history.length = 0
    running = true
    parted = false
  }

  /** set the pace so the two part company `seconds` from now */
  const paceToSplit = (seconds: number) => {
    const t = timeToSplit(sys, P, LORENZ_SEED, gap0, VISIBLE)
    paths.rate = (t - paths.time) / Math.max(2, seconds)
  }

  const drawPlot = () => {
    if (!plot) return
    const { g, width: w, height: h } = plot
    plot.clear()
    const x0 = 6
    const y0 = h - 8
    const top = 8
    // from the starting gap up to the size of the attractor
    const lo = Math.log10(gap0)
    const hi = 1.7
    const yOf = (v: number) => y0 - ((v - lo) / (hi - lo)) * (y0 - top)
    g.lineWidth = 1
    g.strokeStyle = plot.ink(0.22)
    g.beginPath()
    g.moveTo(x0, top)
    g.lineTo(x0, y0)
    g.lineTo(w, y0)
    g.stroke()
    // the ceiling: as far apart as two points on the butterfly can be
    g.setLineDash([2, 4])
    g.beginPath()
    g.moveTo(x0, yOf(1.55))
    g.lineTo(w, yOf(1.55))
    g.stroke()
    g.setLineDash([])
    if (history.length < 2) return
    g.strokeStyle = plot.ink(0.95)
    g.lineWidth = 1.5
    g.beginPath()
    const span = Math.max(history.length - 1, 110)
    history.forEach((v, i) => {
      const x = x0 + (i / span) * (w - x0 - 4)
      const y = yOf(Math.min(hi, Math.max(lo, v)))
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    })
    g.stroke()
  }

  return {
    enter(from) {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      if (dust.source !== flow) {
        resetLorenz(flow)
        void dust.morphTo(flow, { ...silk(palette, flow.speedNorm), gain: 0.1 }, { seconds: 2.6 })
      } else {
        // carried over from the prologue: let the butterfly sink back to a ghost
        const g0 = dust.look.gain
        ctx.tween(2.5, (u) => (dust.look.gain = g0 + (0.1 - g0) * u))
      }
      rig.shot({ target: [0, -0.24, 0], distance: 3.65, azimuth: from === 'rounding' ? undefined : 30, elevation: 12, orbit: 2.2, aperture: 0.003 }, 2.5)
    },

    cues: [
      at(1, () => {
        launch(1e-6)
        paceToSplit(ctx.until(4) + 0.4)
        plot = new Plot(engine.labels.root, 'br', 220, 120, 'the gap between them')
      }),
      at(6, () => {
        paths.rate = 1.6
      }),
      // "So start them a thousand times closer."
      at(7, () => {
        launch(1e-9)
        paceToSplit(ctx.until(9) + 1.2)
      }),
    ],

    explore() {
      launch(1e-6)
      paths.rate = 2
      plot = new Plot(engine.labels.root, 'br', 220, 120, 'the gap between them')
    },

    update(dt) {
      paths.update(dt, engine.renderer.getPixelRatio())
      if (running) {
        if (!parted && paths.gap > VISIBLE) {
          parted = true
          sound.sfx('split', 0.45)
        }
        plot?.setValue(formatGap(paths.gap))
        sampleClock += dt * paths.rate
        if (sampleClock > 0.15) {
          sampleClock = 0
          if (paths.gap > 0) history.push(Math.log10(paths.gap))
          if (history.length > 400) history.shift()
          drawPlot()
        }
      }
    },

    exit() {
      plot?.remove()
      ctx.tween(1.4, (u) => (paths.opacity = 1 - u))
    },

    dispose() {
      plot?.remove()
      paths.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Starting gap',
        options: [
          { value: '1e-3', label: '10⁻³' },
          { value: '1e-6', label: '10⁻⁶' },
          { value: '1e-9', label: '10⁻⁹' },
          { value: '1e-12', label: '10⁻¹²' },
        ],
        get: () => gapKey,
        set: (v) => {
          gapKey = v
          launch(Number(v))
          paths.rate = 2
          if (!plot) plot = new Plot(engine.labels.root, 'br', 220, 120, 'the gap between them')
        },
      },
      { kind: 'readout', label: 'Gap now', get: () => formatGap(paths.gap) },
      { kind: 'readout', label: 'Time', get: () => paths.time.toFixed(1) },
    ],
    notes: [
      'Both copies obey exactly the same equations. They start one millionth of a unit apart, far less than any instrument could resolve, and for a while they are indistinguishable.',
      'The gap grows exponentially: it doubles about every 0.77 units of time. Starting a thousand times closer therefore buys only ten more doublings, about eight units. That arithmetic is the butterfly effect, and it is why improving your measurements a thousandfold extends a weather forecast by days, not years.',
    ],
  }
}

export default twins
