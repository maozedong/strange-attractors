/**
 * The same number, everywhere. The forks of the diagram crowd together toward the edge of
 * chaos, and they crowd at a fixed rate: zoom in on one fork so the next fills the frame, and
 * the picture you get is the one you started from. Three zooms in a row by the same factors,
 * δ = 4.669 across and α = 2.503 up, each ending on the same picture. Then back out, and the
 * places the number has turned up since.
 */
import * as THREE from 'three'
import { at, easeInOut, type SceneFactory } from '../../film/types'
import { sound } from '../../sound/audio'
import { FEIGENBAUM_DELTA, PERIOD_DOUBLINGS, forkPoint } from '../../fractal/logistic/math'
import { DIAGRAM, diagramLook, placeDiagram } from '../kit/bifurcation'
import { plate, readout } from '../kit/hud'
import { logisticSource } from '../kit/LogisticSource'
import { FLOOR } from '../kit/shared'
import { Rings } from './Rings'

interface Frame {
  dial: [number, number]
  value: [number, number]
}

const WHOLE: Frame = { dial: [DIAGRAM.dial[0], DIAGRAM.dial[1]], value: [0, 1] }

/**
 * The view centred on the k-th fork: 2.5 times its doubling window across and 1.75 times the
 * step to the next fork up, so successive frames shrink by δ across and by α up.
 */
function forkFrame(k: number): Frame {
  const r0 = PERIOD_DOUBLINGS[k]
  const hw = 2.5 * (PERIOD_DOUBLINGS[k + 1] - r0)
  const x0 = forkPoint(k)
  const hh = 1.75 * Math.abs(forkPoint(k + 1) - x0)
  return { dial: [r0 - hw, r0 + hw], value: [x0 - hh, x0 + hh] }
}

/** one end of a range moving so that the width changes geometrically: a zoom at constant speed */
function zoomRange(a: [number, number], b: [number, number], u: number): [number, number] {
  const ratio = (b[1] - b[0]) / (a[1] - a[0])
  const w = Math.abs(ratio - 1) < 1e-4 ? u : (1 - Math.pow(ratio, u)) / (1 - ratio)
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]
}

const FORKS = 4
/** every zoom takes the same time */
const ZOOM = 1.9
/** how many times the gaps between forks shrink, measured from the first five forks */
const RATIOS = [0, 1, 2].map((k) => (PERIOD_DOUBLINGS[k + 1] - PERIOD_DOUBLINGS[k]) / (PERIOD_DOUBLINGS[k + 2] - PERIOD_DOUBLINGS[k + 1]))

const feigenbaum: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const logi = logisticSource(engine)
  const rings = new Rings(FORKS, palette)
  root.add(rings.object)
  const p = new THREE.Vector3()

  let view: Frame = { dial: logi.dialRange, value: logi.valueRange }
  let choice = 'whole'
  let info: ReturnType<typeof ctx.label> | null = null
  let name: ReturnType<typeof ctx.label> | null = null
  let big: ReturnType<typeof ctx.label> | null = null
  /** what the readout says: the fork values, or how far in the view is */
  let readoutMode: 'forks' | 'zoom' | 'none' = 'none'
  let forksShown = 0

  const apply = (f: Frame) => {
    view = f
    logi.setDial(f.dial[0], f.dial[1])
    logi.setValue(f.value[0], f.value[1])
  }

  const zoomTo = (to: Frame, seconds: number, done?: () => void) => {
    const from: Frame = { dial: [...view.dial], value: [...view.value] }
    const deep = (f: Frame) => (f.dial[1] - f.dial[0]) < 1.1
    const f0 = logi.feather
    const f1 = deep(to) ? 0.07 : 0
    ctx.tween(
      seconds,
      (u) => {
        apply({ dial: zoomRange(from.dial, to.dial, u), value: zoomRange(from.value, to.value, u) })
        logi.feather = f0 + (f1 - f0) * Math.min(1, u * 1.5)
      },
      { ease: easeInOut, tag: 'zoom', done },
    )
  }

  const showBig = (text: string, seconds: number, where: [number, number]) => {
    big?.remove()
    const l = ctx.label(text, { kind: 'big', at: { screen: where }, align: 'center' })
    big = l
    ctx.after(seconds, () => {
      l.remove()
      if (big === l) big = null
    })
  }

  /** plates replace one another in the same place: the old one clears before the new one comes up */
  const dropName = () => {
    if (!name) return false
    name.el.style.transition = 'opacity 0.25s ease-out'
    name.remove()
    name = null
    return true
  }
  const showName = (title: string, sub: string) => {
    const wait = dropName() ? 0.28 : 0
    ctx.after(wait, () => {
      dropName()
      name = plate(ctx, title, sub)
    })
  }

  const ringIn = (k: number) => {
    ctx.tween(0.5, (u) => (rings.on[k] = u))
    forksShown = k + 1
    sound.note([523.25, 659.25, 783.99, 1046.5][k], { gain: 0.07, seconds: 1.4, pan: -0.2 + 0.15 * k })
  }

  /** how far in the view is, counted from the first fork's frame */
  const START = forkFrame(0)
  const magnification = () => (START.dial[1] - START.dial[0]) / (view.dial[1] - view.dial[0])

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      const look = diagramLook(palette, logi, ctx.portrait)
      if (dust.source === logi) {
        // the tap left the diagram standing: let go of its band of light
        const s0 = logi.spot.gain
        ctx.tween(1.6, (u) => (logi.spot.gain = s0 * (1 - u)), { tag: 'spot' })
        logi.pool = null
        logi.reveal = 1
        logi.setPalette(palette)
        view = { dial: logi.dialRange, value: logi.valueRange }
        if (view.dial[0] !== WHOLE.dial[0] || view.dial[1] !== WHOLE.dial[1] || view.value[0] !== 0 || view.value[1] !== 1) zoomTo(WHOLE, 2)
      } else {
        placeDiagram(logi, palette)
        logi.pool = null
        logi.reveal = 1
        logi.spot.gain = 0
        logi.feather = 0
        view = { ...WHOLE }
        void dust.morphTo(logi, look, { seconds: 2.6, swirl: 0.6 })
      }
      logi.orderGain = 0.14
      rig.shot({ target: [0, DIAGRAM.centre[1] - 0.04, 0], distance: 3.3, azimuth: 0, elevation: 1.5, orbit: 0, aperture: 0.002, focusOffset: 0, portrait: { distance: 3.55 } }, 2.8)
    },

    cues: [
      // "Look at where the forks are."
      at(0, () => {
        readoutMode = 'forks'
        info = readout(ctx)
        for (let k = 0; k < FORKS; k++) ctx.after(0.05 + 0.38 * k, () => ringIn(k))
      }),
      // "Each stretch between them is shorter than the one before." Three zooms, all alike.
      at(0, 1.2, () => zoomTo(forkFrame(0), 0.8)),
      at(1, () => {
        ctx.tween(0.6, (u) => {
          for (let k = 0; k < FORKS; k++) rings.on[k] = Math.min(rings.on[k], 1 - u)
        })
        readoutMode = 'zoom'
        zoomTo(forkFrame(1), ZOOM)
      }),
      at(1, 'before', () => zoomTo(forkFrame(2), ZOOM)),
      at(2, 'factor', () => zoomTo(forkFrame(3), ZOOM)),
      // "…by the same factor, every time: 4.669."
      at(2, 'four point', () => showBig('4.669', 4, [0.5, 0.2])),
      // "Mitchell Feigenbaum found it in 1975, on a pocket calculator."
      at(3, () => {
        readoutMode = 'none'
        info?.remove()
        info = null
        showName('Mitchell Feigenbaum', 'Los Alamos, 1975')
      }),
      // "Then he tried a different equation, and got the same number." Back out to the whole diagram.
      at(4, 0.4, () => {
        readoutMode = 'none'
        info?.remove()
        info = null
        zoomTo(WHOLE, Math.max(3.5, ctx.until(5, 'dripping') - 0.3))
      }),
      at(4, 'same number', () => dropName()),
      // "It has since turned up in dripping taps. In electronic circuits. In liquid helium, heated from below."
      at(5, 'dripping', () => showName('a dripping tap', 'Shaw and colleagues, Santa Cruz, 1980s')),
      at(5, 'electronic', () => showName('an electronic circuit', 'Linsay, MIT, 1981')),
      at(5, 'liquid helium', () => showName('liquid helium', 'Libchaber and Maurer, Paris, 1980')),
      // "Systems with nothing in common, falling into chaos at exactly the same rate."
      at(6, () => {
        rig.shot({ target: [0, DIAGRAM.centre[1] - 0.02, 0], distance: 3.5, azimuth: -10, elevation: 3, orbit: -0.6, aperture: 0.004, portrait: { distance: 3.7 } }, 5)
      }),
      at(6, 'same rate', () => dropName()),
      // "It is a constant of nature, like pi. And nobody knew it was there."
      at(7, 'constant', -0.3, () => showBig('4.669201…', Math.max(3, ctx.until(7, 'there') + 0.6), [0.36, 0.2])),
    ],

    // the whole diagram is the starting point; the zooms are in the drawer
    explore() {},

    update() {
      // rings stay on the forks however the view moves
      for (let k = 0; k < FORKS; k++) rings.set(k, logi.toWorld(PERIOD_DOUBLINGS[k], forkPoint(k), p))
      rings.commit(Math.min(30, engine.width * 0.055) * engine.renderer.getPixelRatio())
      if (info && readoutMode === 'forks') {
        const vals = PERIOD_DOUBLINGS.slice(0, forksShown).map((r, i) => (i === 0 ? '3' : r.toFixed(3)))
        info.set(`forks at r =  ${vals.join('   ')}`)
      } else if (info && readoutMode === 'zoom') {
        const m = magnification()
        info.set(`zoom  ×${Math.max(1, m).toFixed(m < 100 ? 1 : 0)}`)
      }
    },

    exit() {
      ctx.cancel('zoom')
      ctx.tween(1.2, (u) => (rings.opacity = 1 - u))
      // the next scene gets the whole diagram, as it was handed over
      apply(WHOLE)
      logi.feather = 0
      logi.spot.gain = 0
    },

    dispose() {
      rings.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Zoom to',
        options: [
          { value: 'whole', label: 'Whole diagram' },
          { value: '0', label: 'Fork 1' },
          { value: '1', label: 'Fork 2' },
          { value: '2', label: 'Fork 3' },
          { value: '3', label: 'Fork 4' },
        ],
        get: () => choice,
        set: (v) => {
          choice = v
          zoomTo(v === 'whole' ? WHOLE : forkFrame(Number(v)), 2.4)
        },
      },
      { kind: 'readout', label: 'Gap 1 ÷ gap 2', get: () => RATIOS[0].toFixed(3) },
      { kind: 'readout', label: 'Gap 2 ÷ gap 3', get: () => RATIOS[1].toFixed(3) },
      { kind: 'readout', label: 'Gap 3 ÷ gap 4', get: () => RATIOS[2].toFixed(3) },
      { kind: 'readout', label: 'Zoom, from the first fork', get: () => `×${Math.max(1, magnification()).toFixed(1)}` },
    ],
    notes: [
      `The tap's rhythm doubles at r = 3, 3.449, 3.544, 3.564, 3.569… Each gap is about ${FEIGENBAUM_DELTA.toFixed(3)} times shorter than the one before, so the doublings pile up at r ≈ 3.5699, where chaos begins. The ratio of the first gaps is 4.751, then 4.656, then 4.668, closing in on 4.6692016…`,
      'In 1975 Mitchell Feigenbaum, working at Los Alamos with a programmable pocket calculator, noticed the ratio while waiting for the slow machine. When he tried a different map, a sine instead of a parabola, the forks fell at different places but closed in at the same rate. He then showed why: near the edge of chaos any map with a single smooth hump looks the same once rescaled, so the number cannot depend on the details. There is a second constant, 2.5029, for how the branches shrink up the page; the zooms here use both.',
      'Experiments followed. Libchaber and Maurer saw the doublings in a tiny cell of liquid helium heated from below, Linsay in a driven electronic circuit, and Shaw and his colleagues in a dripping tap. Where the gaps could be measured, the ratios came out close to the same number.',
    ],
  }
}

export default feigenbaum
