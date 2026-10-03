import type { ReactNode } from 'react'
import type { AppState } from '../store'
import type { Stage } from '../fractal/types'
import type { Cue, Director } from '../director/director'
import { easeInOut, easeOut } from '../director/director'
import { useStore } from '../store'
import { getSystem } from '../systems'
import { audio } from '../audio/engine'
import { cameraDirector, type CameraPose, type FollowFn } from '../scene/cameraDirector'
import { TwinsInstrument } from '../ui/instruments/TwinsInstrument'
import { SwarmInstrument } from '../ui/instruments/SwarmInstrument'
import { ShapeInstrument } from '../ui/instruments/ShapeInstrument'
import { HeatDial } from '../ui/instruments/HeatDial'
import { Zoo } from '../ui/instruments/Zoo'
import { Epilogue } from '../ui/instruments/Epilogue'
import { TapInstrument } from '../ui/instruments/TapInstrument'
import { FeigenbaumTable } from '../ui/instruments/FeigenbaumTable'
import { ZoomInstrument } from '../ui/instruments/ZoomInstrument'
import { JuliaInstrument } from '../ui/instruments/JuliaInstrument'
import { FernInstrument } from '../ui/instruments/FernInstrument'
import { CoastInstrument, boxTheButterfly } from '../ui/instruments/CoastInstrument'
import { BulbInstrument } from '../ui/instruments/BulbInstrument'
import { CatInstrument } from '../ui/instruments/CatInstrument'
import { RichardsonChart } from '../ui/RichardsonChart'
import { PendulumInstrument } from '../ui/instruments/PendulumInstrument'
import { ForecastInstrument } from '../ui/instruments/ForecastInstrument'
import { VoiceInstrument } from '../ui/instruments/VoiceInstrument'
import { HyperionInstrument } from '../ui/instruments/HyperionInstrument'
import { HoldInstrument } from '../ui/instruments/HoldInstrument'
import { ForecastChart } from '../ui/ForecastChart'
import { CAT_PERIOD, getCatStep } from '../fractal/cat'
import { loadBritain } from '../fractal/coast'
import { hyperionLive } from '../world/hyperion'
import { SeparationChart } from '../ui/SeparationChart'
import { MANDEL_TARGETS } from '../fractal/mandel/targets'
import { animateMandelTo } from '../fractal/mandel/MandelbrotPlane'
import { cancelMandelFlight } from '../fractal/mandel/tween'
import { PERIOD3_WINDOW, prebuildBifurcation } from '../fractal/logistic'
import { FLESH_LAYOUT, LOGISTIC_LAYOUT, SHADOW_LAYOUT, WORLD_LAYOUT, cascadePose } from '../scene/layouts'

export type WingId = 'butterfly' | 'order' | 'flesh' | 'world' | 'emergence'

export interface Wing {
  id: WingId
  numeral: string
  title: string
  tagline: string
}

export const WINGS: Wing[] = [
  { id: 'butterfly', numeral: 'I', title: 'The butterfly', tagline: 'Lorenz, the butterfly effect, and the shape chaos lives on.' },
  { id: 'order', numeral: 'II', title: 'Order inside chaos', tagline: 'A dripping tap, one universal number, and the Mandelbrot set.' },
  {
    id: 'flesh',
    numeral: 'III',
    title: 'Fractals in the flesh',
    tagline: 'A fern from dice, a coastline that never adds up, a fractal with a body, and a cat that comes back.',
  },
  {
    id: 'world',
    numeral: 'IV',
    title: 'Chaos in the world',
    tagline: 'A hundred pendulums, the two-week wall, your own voice, a tumbling moon, and chaos put to work.',
  },
  {
    id: 'emergence',
    numeral: 'V',
    title: 'Order from nothing',
    tagline: "Starlings, the leopard's spots, creatures nobody drew, fireflies in step, and a pile of sand.",
  },
]

export interface Chapter {
  id: string
  wing: WingId
  title: string
  body: ReactNode
  /** rendered inside the panel under the text */
  instrument?: () => ReactNode
  /** rendered on the right-hand side, outside the panel */
  aside?: () => ReactNode
  /** which stage set is on */
  stage: Stage
  /** camera distance (render units) the rig eases toward when no pose is scripted */
  distance: number
  /** degrees per second of idle orbit */
  autoRotate: number
  /** scripted opening camera pose */
  pose?: CameraPose
  onEnter: (s: AppState) => void
  /** autoplay, timed to the narration */
  cues?: Cue[]
}

export const CLOUD_RADIUS = 1e-3

const lorenzSeed = () => getSystem('lorenz').seed(getSystem('lorenz').params.map((p) => p.default))

function toLorenz(s: AppState) {
  if (s.systemId !== 'lorenz') s.setSystem('lorenz')
  else s.resetParams()
}

/** common reset for chapters that use the particle stage */
function swarmStage(s: AppState) {
  cancelMandelFlight()
  s.setCoast({ box: 0 })
  s.setStage('swarm')
  s.setPaused(false)
  s.setSpeed(1)
  s.setFreePlay(false)
  cameraDirector.release()
}

/** common reset for chapters that use a fractal stage */
function fractalStage(s: AppState, stage: Stage) {
  cancelMandelFlight()
  s.setCoast({ box: 0 })
  s.setStage(stage)
  s.setPaused(false)
  s.setFreePlay(false)
  s.setSwarmVisible(false)
  s.setTrajVisible(false)
  s.pushTraj({ type: 'clear' })
  s.setShowFixedPoints(false)
}

export function startTwins(s: AppState, nudge: number) {
  s.setTwinNudge(nudge)
  s.setPaused(false)
  s.pushTraj({ type: 'start', count: 2, origin: lorenzSeed(), nudge, history: 3000, fade: true })
}

export function releaseSwarm(s: AppState) {
  if (!s.paused) return
  void audio.sfx('release')
  s.setPaused(false)
}

/** tween the Lorenz ρ parameter (index 1) */
function tweenRho(d: Parameters<Cue['run']>[1], s: AppState, to: number, seconds: number) {
  const from = s.params[1] ?? 28
  d.tween('rho', from, to, seconds, (v) => s.setParam(1, Math.round(v * 100) / 100))
}

function tweenR(d: Parameters<Cue['run']>[1], s: AppState, to: number, seconds: number) {
  const from = s.fractal.r
  d.tween('r', from, to, seconds, (v) => s.setFractal({ r: v }))
}

function tweenJulia(d: Parameters<Cue['run']>[1], s: AppState, to: [number, number], seconds: number) {
  const { cx, cy } = s.fractal.julia
  d.tween('julia', 0, 1, seconds, (u) => s.setFractal({ julia: { cx: cx + (to[0] - cx) * u, cy: cy + (to[1] - cy) * u } }), easeInOut)
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'title',
    wing: 'butterfly',
    title: 'Strange Attractors',
    body: null,
    stage: 'swarm',
    distance: 3.1,
    autoRotate: 1.2,
    onEnter(s) {
      swarmStage(s)
      toLorenz(s)
      s.setTrajVisible(false)
      s.pushTraj({ type: 'clear' })
      s.setColorMode('speed')
      s.setSwarmVisible(true)
      s.setSwarmOpacity(0.7)
      s.setShowFixedPoints(false)
    },
  },

  // ───────────────────────────── Wing I: The butterfly ─────────────────────────────
  {
    id: 'rounding',
    wing: 'butterfly',
    title: 'A rounding error',
    body: (
      <>
        <p>
          Winter, 1961. Edward Lorenz, a meteorologist at MIT, wanted another look at part of a
          weather simulation. To save time he restarted it halfway through, typing the numbers in
          from a printout. The printout said 0.506. The computer had been holding 0.506127.
        </p>
        <p>
          The new run shadowed the old one for a while, then drifted into completely different
          weather. A difference of one part in ten thousand had not stayed small. It had grown
          until it <em>was</em> the forecast.
        </p>
        <p>
          The path drawing itself here is the toy he distilled from that afternoon: three equations
          for warm air rising through a cold layer. It never repeats, and it never stops.
        </p>
      </>
    ),
    stage: 'swarm',
    distance: 2.9,
    autoRotate: 2,
    onEnter(s) {
      swarmStage(s)
      toLorenz(s)
      s.setSwarmVisible(false)
      s.setColorMode('speed')
      s.setShowFixedPoints(false)
      s.setTrajVisible(true)
      s.pushTraj({ type: 'start', count: 1, origin: lorenzSeed(), nudge: 0, history: 7000, fade: false })
    },
  },
  {
    id: 'twins',
    wing: 'butterfly',
    title: 'Twins',
    body: (
      <>
        <p>
          Two copies of the same system, started one millionth of a unit apart. That is far closer
          than Lorenz's rounding error, and far closer than any thermometer can measure.
        </p>
        <p>
          They track each other so exactly that you see a single path. Then, on some lap, they
          choose different wings. From that moment on they have nothing in common.
        </p>
        <p>
          The gap between them doesn't creep. It doubles, and doubles again, about every 0.77 units
          of time. Make the nudge a thousand times smaller and you buy only eight more units of
          agreement. That arithmetic is the butterfly effect, and it is why weather forecasts go
          blind after about two weeks however good the computers get.
        </p>
      </>
    ),
    instrument: () => <TwinsInstrument />,
    aside: () => <SeparationChart />,
    stage: 'swarm',
    distance: 2.9,
    autoRotate: 1.5,
    onEnter(s) {
      swarmStage(s)
      toLorenz(s)
      s.setSwarmVisible(false)
      s.setShowFixedPoints(false)
      s.setTrajVisible(true)
      startTwins(s, 1e-6)
    },
    cues: [
      {
        at: 'Make the nudge a thousand times smaller',
        run: (s) => {
          if (s.twinNudge === 1e-6) startTwins(s, 1e-9)
        },
      },
    ],
  },
  {
    id: 'swarm',
    wing: 'butterfly',
    title: 'The swarm',
    body: (
      <>
        <p>
          Now take a quarter of a million starting points and pack them into a ball a thousandth of
          a unit across, smaller than a pixel at this zoom. Each one is painted by where it sits in
          the ball.
        </p>
        <p>
          Release them. The ball stretches into a thread, the thread folds over on itself, and the
          fold stretches again, like taffy on a pulling machine. Within a few dozen units of time
          the colours are scrambled across the whole shape. Points that began as neighbours end up
          anywhere at all.
        </p>
        <p>
          Nothing random is happening. Stretching and folding simply erase the information in your
          starting point, a little at a time, until none is left.
        </p>
      </>
    ),
    instrument: () => <SwarmInstrument />,
    stage: 'swarm',
    distance: 3.0,
    autoRotate: 1,
    onEnter(s) {
      swarmStage(s)
      toLorenz(s)
      s.setTrajVisible(false)
      s.pushTraj({ type: 'clear' })
      s.setShowFixedPoints(false)
      s.setColorMode('origin')
      s.setSwarmVisible(true)
      s.setSwarmOpacity(1)
      s.pushSwarm({ type: 'spawnCloud', center: lorenzSeed(), radius: CLOUD_RADIUS })
      s.setPaused(true)
    },
    cues: [{ at: 'Release them.', run: (s) => releaseSwarm(s) }],
  },
  {
    id: 'shape',
    wing: 'butterfly',
    title: "The shape it can't leave",
    body: (
      <>
        <p>
          Here is the twist. However wildly a path wanders, it never leaves this butterfly. Start
          anywhere nearby and you are pulled onto it. Once on it, you circle forever.
        </p>
        <p>
          A shape that pulls paths in is an <em>attractor</em>. This one is <em>strange</em>: it is
          made of infinitely many sheets stacked like filo pastry, so that its dimension comes out
          at about 2.06. More than a surface, less than a solid.
        </p>
        <p>
          The two eyes of the butterfly are places where the fluid could sit perfectly still. It
          never does. At these settings the eyes push paths away, and every path spirals out of
          them. No two paths ever cross, either: the equations allow exactly one future per point.
        </p>
      </>
    ),
    instrument: () => <ShapeInstrument />,
    stage: 'swarm',
    distance: 2.8,
    autoRotate: 1.5,
    onEnter(s) {
      swarmStage(s)
      toLorenz(s)
      s.setTrajVisible(false)
      s.pushTraj({ type: 'clear' })
      s.setColorMode('speed')
      s.setSwarmVisible(true)
      s.setSwarmOpacity(1)
      s.pushSwarm({ type: 'spawnAttractor' })
      s.setShowFixedPoints(false)
    },
    cues: [
      {
        at: 'Start anywhere nearby',
        run: (s) => {
          // a wide ball of starting points, all of them pulled onto the butterfly
          const sys = getSystem(s.systemId)
          const frame = sys.frame(s.params)
          s.pushSwarm({ type: 'spawnCloud', center: frame.center, radius: 1.1 / frame.scale })
          s.setColorMode('speed')
        },
      },
      { at: 'The two eyes', run: (s) => s.setShowFixedPoints(true) },
    ],
  },
  {
    id: 'heat',
    wing: 'butterfly',
    title: 'Turn up the heat',
    body: (
      <>
        <p>
          Lorenz's equations describe a layer of fluid warmed from below. The dial ρ is how hard
          you warm it.
        </p>
        <p>
          Cold, nothing moves, and every path dies at the centre. Warm it a little and the fluid
          settles into one of two steady rolls, the eyes. Past ρ ≈ 24.74 the rolls lose their grip
          and the butterfly appears. Keep going and you find windows of perfect, repeating order
          hiding inside the chaos.
        </p>
        <p>
          One number, turned slowly, takes the same three equations from stillness to chaos and
          back. There is no switch anywhere that says "chaos".
        </p>
      </>
    ),
    instrument: () => <HeatDial />,
    stage: 'swarm',
    distance: 3.0,
    autoRotate: 1.2,
    onEnter(s) {
      swarmStage(s)
      toLorenz(s)
      s.setTrajVisible(false)
      s.pushTraj({ type: 'clear' })
      s.setColorMode('speed')
      s.setSwarmVisible(true)
      s.setSwarmOpacity(1)
      s.setShowFixedPoints(true)
    },
    cues: [
      { at: 'Cold, nothing moves', run: (s, d) => tweenRho(d, s, 0.6, 1.5) },
      { at: 'Warm it a little', run: (s, d) => tweenRho(d, s, 15, 2) },
      { at: 'Past rho of about', run: (s, d) => tweenRho(d, s, 28, 2.5) },
      { at: 'Keep going', run: (s, d) => tweenRho(d, s, 100, 5) },
      { at: 'One number, turned slowly', run: (s, d) => tweenRho(d, s, 28, 6) },
    ],
  },
  {
    id: 'zoo',
    wing: 'butterfly',
    title: 'The zoo',
    body: (
      <>
        <p>
          Lorenz's butterfly was only the first. Once people knew what to look for, strange
          attractors turned up in chemistry, electronics, lasers, and in equations invented purely
          to see what would happen. Pick one, and the swarm flows from the shape it is on into the
          new one.
        </p>
      </>
    ),
    instrument: () => <Zoo />,
    stage: 'swarm',
    distance: 3.0,
    autoRotate: 1.5,
    onEnter(s) {
      swarmStage(s)
      s.setTrajVisible(false)
      s.pushTraj({ type: 'clear' })
      s.setColorMode('speed')
      s.setSwarmVisible(true)
      s.setSwarmOpacity(1)
      s.setShowFixedPoints(false)
    },
    cues: [
      { at: 'in chemistry', run: (s) => switchTo(s, 'rossler') },
      { at: 'in electronics', run: (s) => switchTo(s, 'chua') },
      { at: 'in lasers', run: (s) => switchTo(s, 'thomas') },
      { at: 'invented purely', run: (s) => switchTo(s, 'sprottB') },
    ],
  },
  {
    id: 'everywhere',
    wing: 'butterfly',
    title: 'Chaos, everywhere',
    body: (
      <>
        <p>
          Dripping taps. Double pendulums. A heart in fibrillation. The storms of Jupiter. The
          orbits of the inner planets, which forget where they were after about five million years.
          None of it is random, and all of it is this.
        </p>
        <p>
          The lesson Lorenz left is not that the world is unknowable. It is that determinism and
          prediction are different things, and that the gap between them has a precise and rather
          beautiful shape.
        </p>
      </>
    ),
    instrument: () => <Epilogue />,
    stage: 'swarm',
    distance: 3.1,
    autoRotate: 1.2,
    onEnter(s) {
      swarmStage(s)
      s.setTrajVisible(false)
      s.pushTraj({ type: 'clear' })
      s.setSwarmVisible(true)
      s.setSwarmOpacity(1)
      s.setShowFixedPoints(false)
      // the next wing's diagram takes a moment to build; start now
      prebuildBifurcation()
    },
  },

  // ───────────────────────────── Wing II: Order inside chaos ─────────────────────────────
  {
    id: 'tap',
    wing: 'order',
    title: 'The dripping tap',
    body: (
      <>
        <p>
          A tap, dripping. Turn it up and the drips come faster, still evenly spaced. Turn it up
          more and the rhythm splits: long gap, short gap. Then four gaps repeating, then eight,
          then sixteen, the splits arriving faster and faster, until there is no rhythm at all.
        </p>
        <p>
          This is the logistic map, the simplest equation that can do this: each drip depends on
          the last by the rule x → r x (1 − x). In 1976 Robert May asked that every student be
          taught it, so that nobody would again assume simple rules mean simple behaviour.
        </p>
        <p>
          Lay every rhythm out against the dial and you get the bifurcation diagram: one line
          splitting into two, into four, into a cloud, and inside the cloud, windows where the
          rhythm comes back.
        </p>
      </>
    ),
    instrument: () => <TapInstrument />,
    stage: 'logistic',
    distance: 3.2,
    autoRotate: 0,
    pose: LOGISTIC_LAYOUT.tapPose,
    onEnter(s) {
      fractalStage(s, 'logistic')
      s.setFractal({ r: 2.9, reveal: 0 })
      cameraDirector.goTo(LOGISTIC_LAYOUT.tapPose, 1.5)
    },
    cues: [
      { at: 'Turn it up a little,', run: (s, d) => tweenR(d, s, 3.2, 1.5) },
      { at: 'Turn it up a little more', run: (s, d) => tweenR(d, s, 3.45, 1.5) },
      { at: 'Turn again', run: (s, d) => tweenR(d, s, 3.54, 1) },
      { at: 'Then eight', run: (s, d) => tweenR(d, s, 3.562, 0.8) },
      { at: 'Then sixteen', run: (s, d) => tweenR(d, s, 3.5675, 0.8) },
      { at: 'until there is no rhythm', run: (s, d) => tweenR(d, s, 3.72, 2) },
      {
        at: 'Now lay every rhythm out',
        run: (s, d) => {
          cameraDirector.goTo(LOGISTIC_LAYOUT.diagramPose, 3)
          void audio.sfx('rise', 0.6)
          d.tween('reveal', 2.5, 4, 7, (v) => s.setFractal({ reveal: v }), easeOut)
        },
      },
      { at: 'windows where the rhythm comes back', run: (s, d) => tweenR(d, s, (PERIOD3_WINDOW[0] + PERIOD3_WINDOW[1]) / 2, 1.5) },
    ],
  },
  {
    id: 'feigenbaum',
    wing: 'order',
    title: 'The same number everywhere',
    body: (
      <>
        <p>
          Look at where the splits happen: r = 3, then 3.449, then 3.544, then 3.564. Each gap is
          shorter than the last by the same factor, 4.669. Mitchell Feigenbaum found that number in
          1975 on a pocket calculator and could not believe it.
        </p>
        <p>
          Then it turned up in a dripping tap. In an electronic circuit. In a convecting fluid. In
          the Lorenz equations. The same 4.669, every time, in systems that share nothing but the
          shape of a hump. There is only one way to go from order to chaos by doubling, and it has
          a number.
        </p>
      </>
    ),
    instrument: () => <FeigenbaumTable />,
    stage: 'logistic',
    distance: 3.2,
    autoRotate: 0,
    pose: LOGISTIC_LAYOUT.diagramPose,
    onEnter(s) {
      fractalStage(s, 'logistic')
      s.setFractal({ r: 3.5, reveal: 4 })
      cameraDirector.goTo(LOGISTIC_LAYOUT.diagramPose, 1.5)
    },
    cues: [
      { at: 'The first at r equals three', run: () => cameraDirector.goTo(cascadePose(0), 2) },
      { at: 'The next at three point four four nine', run: () => cameraDirector.goTo(cascadePose(1), 2) },
      { at: 'Then three point five four four', run: () => cameraDirector.goTo(cascadePose(2), 2) },
      { at: 'then three point five six four', run: () => cameraDirector.goTo(cascadePose(3), 2) },
      { at: 'Each gap is shorter', run: () => cameraDirector.goTo(cascadePose(4), 3) },
      {
        at: 'Then it turned up in a dripping tap',
        run: (s, d) => {
          cameraDirector.goTo(LOGISTIC_LAYOUT.diagramPose, 3)
          tweenR(d, s, 3.5, 1)
        },
      },
    ],
  },
  {
    id: 'shadow',
    wing: 'order',
    title: 'The shadow of the Mandelbrot set',
    body: (
      <>
        <p>
          A different equation, from a different world: z → z² + c, with complex numbers. Colour
          each point c by how fast it escapes and you get the most famous picture in mathematics.
          Benoit Mandelbrot first printed it in 1980, on a line printer.
        </p>
        <p>
          Here is the thing nobody tells you. Lay the bifurcation diagram along the axis of
          symmetry and they line up. The big cardioid is the steady drip, the circle beside it the
          split into two, the next bulb four, and so on down to the tip. The logistic map is the
          Mandelbrot set seen edge-on.
        </p>
        <p>
          And along that line, deep inside the chaos where the rhythm came back, there is a tiny,
          perfect copy of the whole set. Inside that, another.
        </p>
      </>
    ),
    instrument: () => <ZoomInstrument />,
    stage: 'mandelbrot',
    distance: 3.2,
    autoRotate: 0,
    pose: SHADOW_LAYOUT.topPose,
    onEnter(s) {
      fractalStage(s, 'mandelbrot')
      s.setFractal({ mandel: MANDEL_TARGETS.overview, reveal: 0, mandelInteractive: false, juliaPickable: false })
      cameraDirector.goTo(SHADOW_LAYOUT.topPose, 1.5)
    },
    cues: [
      {
        at: 'Lay the bifurcation diagram',
        run: (s, d) => {
          cameraDirector.goTo(SHADOW_LAYOUT.threeQuarterPose, 3)
          void audio.sfx('rise', 0.6)
          d.tween('reveal', 2.5, 4, 5, (v) => s.setFractal({ reveal: v }), easeOut)
        },
      },
      {
        at: 'deep inside the chaos',
        run: (s, d) => {
          cameraDirector.goTo(SHADOW_LAYOUT.zoomPose, 2.5)
          d.tween('reveal', s.fractal.reveal, 0, 1.5, (v) => s.setFractal({ reveal: v }))
          animateMandelTo(MANDEL_TARGETS.period3, 9)
        },
      },
      { at: 'Zoom in further', run: () => animateMandelTo(MANDEL_TARGETS.period3deep, 7) },
      { at: 'Zoom in further', delay: 7.5, run: (s) => s.setFractal({ mandelInteractive: true }) },
    ],
  },
  {
    id: 'julia',
    wing: 'order',
    title: 'A fractal in every point',
    body: (
      <>
        <p>
          Every point in that picture has a shape of its own. Pick a c and ask instead which
          starting points stay bounded: that is the Julia set of c. Inside the Mandelbrot set the
          Julia set is one connected piece. Step outside and it shatters into dust.
        </p>
        <p>
          Gaston Julia worked all of this out in 1918, recovering from a war wound, without ever
          seeing a single picture of it.
        </p>
      </>
    ),
    instrument: () => <JuliaInstrument />,
    stage: 'mandelbrot',
    distance: 4.2,
    autoRotate: 0,
    pose: SHADOW_LAYOUT.juliaPose,
    onEnter(s) {
      fractalStage(s, 'mandelbrot')
      s.setFractal({
        mandel: { cx: -0.6, cy: 0, scale: 1.3 },
        reveal: 0,
        mandelInteractive: false,
        juliaPickable: false,
        julia: { cx: -0.5, cy: 0.05 },
      })
      cameraDirector.goTo(SHADOW_LAYOUT.juliaPose, 1.5)
    },
    cues: [
      { at: 'Pick a c', run: (s, d) => tweenJulia(d, s, [-0.123, 0.745], 3) },
      { at: 'Step outside', run: (s, d) => tweenJulia(d, s, [0.36, 0.62], 2.5) },
      { at: 'spirals', run: (s, d) => tweenJulia(d, s, [-0.7269, 0.1889], 2) },
      { at: 'dendrites', run: (s, d) => tweenJulia(d, s, [0, 1], 2) },
      { at: 'rabbits', run: (s, d) => tweenJulia(d, s, [-0.123, 0.745], 2) },
      { at: 'seahorses', run: (s, d) => tweenJulia(d, s, [-0.745, 0.113], 2.5) },
      { at: 'Now drag the point yourself', run: (s) => s.setFractal({ juliaPickable: true }) },
      { at: 0, run: () => void loadBritain() },
    ],
  },

  // ───────────────────────────── Wing III: Fractals in the flesh ─────────────────────────────
  {
    id: 'roll',
    wing: 'flesh',
    title: 'Roll the dice',
    body: (
      <>
        <p>
          A game. Three corners of a triangle and a dot anywhere you like. Roll a die: one or two,
          move halfway to the first corner; three or four, halfway to the second; five or six, the
          third. Mark where you land and roll again. After a few dozen rolls every point lands on
          Sierpinski's triangle, holes at every scale.
        </p>
        <p>
          Change the rules to four moves, each a squeeze and a turn chosen with different odds,
          and the same random game draws a fern. Michael Barnsley found those four moves in 1988:
          twenty-eight numbers, and out comes a plant. The randomness isn't drawing the fern, it
          is only exploring it. The fern is the attractor of the rules, exactly as the butterfly
          was the attractor of Lorenz's equations.
        </p>
      </>
    ),
    instrument: () => <FernInstrument />,
    stage: 'ifs',
    distance: 4.6,
    autoRotate: 0,
    pose: FLESH_LAYOUT.ifsPose,
    onEnter(s) {
      fractalStage(s, 'ifs')
      s.setIfs({ preset: 'sierpinski', rate: 0, variation: 0, resetSerial: s.ifs.resetSerial + 1 })
      cameraDirector.goTo(FLESH_LAYOUT.ifsPose, 1.5)
    },
    cues: [
      { at: 'Roll a die.', run: (s) => s.setIfs({ rate: 1 }) },
      { at: 'Mark where you land', run: (s) => s.setIfs({ rate: 2 }) },
      { at: 'after a few dozen rolls', run: (s) => s.setIfs({ rate: 24 }) },
      { at: 'Now change the rules', run: (s) => s.setIfs({ preset: 'fern', rate: 1.5 }) },
      { at: 'now draws… a fern', run: (s) => s.setIfs({ rate: 24 }) },
      {
        at: 'Nudge one number',
        run: (s, d) =>
          d.tween('variation', 0, 0.8, 3, (v) => s.setIfs({ variation: v }), easeInOut, () =>
            d.tween('variation', 0.8, -0.6, 4, (v) => useStore.getState().setIfs({ variation: v })),
          ),
      },
    ],
  },
  {
    id: 'coast',
    wing: 'flesh',
    title: 'How long is the coastline of Britain?',
    body: (
      <>
        <p>
          Walk the coast with a 200-kilometre ruler and you get about 2,200 kilometres. Use a
          100-kilometre ruler: 2,800. Fifty: 3,700. The shorter the ruler, the more bays and
          headlands it finds, and the total never settles. Lewis Fry Richardson noticed this in
          the 1950s and nobody cared. Benoit Mandelbrot read it in 1967 and realised the coast has
          a dimension of its own: not 1 like a line, not 2 like a map, but about 1.25 (this coast,
          from Natural Earth's data, measures 1.3).
        </p>
        <p>
          The same trick works on the butterfly. Cover it with boxes, count the ones it touches,
          shrink the boxes and count again. The count grows faster than it would for a sheet and
          slower than for a solid. Take the boxes all the way down and the butterfly comes out at
          2.06 dimensional. That number is what "strange" means.
        </p>
      </>
    ),
    instrument: () => <CoastInstrument />,
    aside: () => <RichardsonChart />,
    stage: 'coast',
    distance: 4.9,
    autoRotate: 0,
    pose: FLESH_LAYOUT.coastPose,
    onEnter(s) {
      fractalStage(s, 'coast')
      s.setCoast({ ruler: 0, walk: 0, box: 0 })
      void loadBritain()
      cameraDirector.goTo(FLESH_LAYOUT.coastPose, 1.5)
    },
    cues: [
      { at: 'two-hundred-kilometre ruler', run: (s, d) => walkRuler(s, d, 200, 4) },
      { at: 'a hundred-kilometre ruler', run: (s, d) => walkRuler(s, d, 100, 4) },
      { at: 'Fifty', run: (s, d) => walkRuler(s, d, 50, 5) },
      { at: 'The same trick works on the butterfly', run: () => boxTheButterfly() },
      { at: 'shrink the boxes and count again', run: (s) => s.setCoast({ box: 0.125 }) },
      { at: 'shrink the boxes and count again', delay: 2.5, run: (s) => s.setCoast({ box: 0.0625 }) },
      { at: 'Take the boxes all the way down', run: (s) => s.setCoast({ box: 0.03125 }) },
    ],
  },
  {
    id: 'bulb',
    wing: 'flesh',
    title: 'A fractal with a body',
    body: (
      <>
        <p>
          For eighty years fractals lived on paper, flat. People tried to lift the Mandelbrot set
          into three dimensions and got nothing worth looking at. Then in 2009 Daniel White and
          Paul Nylander tried a different trick: raise a point to a power not by multiplying but by
          spinning it, through two angles at once, the way you would on a globe.
        </p>
        <p>
          Power eight gives the Mandelbulb. Nobody designed it and there is no file for it. It is
          computed fresh for every pixel by firing a ray and asking the equation, over and over,
          how far it is to the surface. Every bud has buds, and those have buds, as far down as
          you care to go.
        </p>
      </>
    ),
    instrument: () => <BulbInstrument />,
    stage: 'bulb',
    distance: 3.4,
    autoRotate: 2,
    pose: FLESH_LAYOUT.bulbPose,
    onEnter(s) {
      fractalStage(s, 'bulb')
      s.setBulb({ power: 2, interactive: false })
      cameraDirector.goTo(FLESH_LAYOUT.bulbPose, 1.5)
    },
    cues: [
      { at: 'Power two gives', run: (s) => s.setBulb({ power: 2 }) },
      { at: 'Power eight gives this', run: (s, d) => d.tween('power', s.bulb.power, 8, 4, (v) => s.setBulb({ power: v })) },
      { at: 'Turn it.', run: (s) => s.setBulb({ interactive: true }) },
      { at: 'as far down as you care to go', run: () => cameraDirector.goTo(FLESH_LAYOUT.bulbDivePose, 7) },
    ],
  },
  {
    id: 'cat',
    wing: 'flesh',
    title: "Arnold's cat",
    body: (
      <>
        <p>
          Take a picture. Stretch it, shear it, and wrap whatever spills over the edge back round
          to the other side. Do it again. After a few steps the picture is noise: every pixel
          scattered, no trace of a cat. Keep going and nothing changes, step after step, and then,
          suddenly, there she is. Exact. Every pixel back where it started.
        </p>
        <p>
          Vladimir Arnold used this map in the 1960s to show what mixing really is. No information
          was ever lost, it was only moved, and since there are only so many pixels the moves must
          eventually repeat. Chaos is deterministic. It just has a very good memory for things we
          cannot keep track of.
        </p>
      </>
    ),
    instrument: () => <CatInstrument />,
    stage: 'cat',
    distance: 4.1,
    autoRotate: 0,
    pose: FLESH_LAYOUT.catPose,
    onEnter(s) {
      fractalStage(s, 'cat')
      s.setCat({ rate: 0, stopAt: null, source: s.cat.source, resetSerial: s.cat.resetSerial + 1 })
      cameraDirector.goTo(FLESH_LAYOUT.catPose, 1.5)
    },
    cues: [
      { at: 'Stretch it, shear it', run: (s) => s.setCat({ rate: 1, stopAt: 1 }) },
      { at: 'Do it again.', run: (s) => s.setCat({ rate: 1, stopAt: 2 }) },
      { at: 'After a few steps', run: (s) => s.setCat({ rate: 3, stopAt: 12 }) },
      {
        at: 'Keep going.',
        run: (s, d) => {
          // land the recurrence exactly on "there she is"
          const arrive = d.timeOf('there she is')
          const remaining = CAT_PERIOD - (getCatStep() % CAT_PERIOD)
          const seconds = Math.max(2, (Number.isFinite(arrive) ? arrive : d.time + 12) - d.time - 0.3)
          s.setCat({ rate: remaining / seconds, stopAt: CAT_PERIOD })
        },
      },
      { at: 'there she is', run: (s) => s.setCat({ rate: 0, stopAt: CAT_PERIOD }) },
    ],
  },
  // ───────────────────────────── Wing IV: Chaos in the world ─────────────────────────────
  {
    id: 'pendulums',
    wing: 'world',
    title: 'A hundred pendulums',
    body: (
      <>
        <p>
          A pendulum is the most predictable thing in physics. Hang a second pendulum from the end
          of the first and you get one of the least. Here are a hundred of them, released together,
          each differing from its neighbour by a millionth of a degree. For a few swings they move
          as one. Then the fan opens, and within a few more they are doing a hundred different
          things. No two will ever agree again.
        </p>
        <p>
          There is nothing special in the equations: two rods, two weights, gravity. You cannot
          build this and have it do the same thing twice, because you cannot set it up the same
          way twice. Not to a millionth of a degree. Not to a trillionth.
        </p>
      </>
    ),
    instrument: () => <PendulumInstrument />,
    stage: 'pendulum',
    distance: 4.6,
    autoRotate: 0,
    pose: WORLD_LAYOUT.pendulumPose,
    onEnter(s) {
      fractalStage(s, 'pendulum')
      s.setPendulum({ count: 100, nudge: pendulumNudge(1e-6, 100), running: false, resetSerial: s.pendulum.resetSerial + 1 })
      cameraDirector.goTo(WORLD_LAYOUT.pendulumPose, 1.5)
    },
    cues: [
      // a millionth of a degree between neighbours takes about ten seconds to show; release
      // early enough that the fan opens on the words
      { at: 'Then the fan opens', delay: -10, run: (s) => s.setPendulum({ running: true }) },
      { at: 'Then the fan opens', run: () => cameraDirector.goTo(WORLD_LAYOUT.pendulumSidePose, 6) },
      { at: 'There is nothing special', run: () => cameraDirector.goTo(WORLD_LAYOUT.pendulumPose, 5) },
    ],
  },
  {
    id: 'forecast',
    wing: 'world',
    title: 'Why forecasts come in bulk',
    body: (
      <>
        <p>
          In 1992 the European forecasting centre stopped running its weather model once. It now
          runs fifty-one copies, each started from a slightly different guess at today's
          atmosphere, because today's atmosphere is never known exactly.
        </p>
        <p>
          Here is a toy version, a model Lorenz built in 1996: forty weather stations around a
          ring. Day one, the copies agree. Day three, they fray. By day ten the fan is as wide as
          the weather itself and the forecast has nothing left to say. The spread is the forecast.
          And there is a wall, somewhere around two weeks, that no computer will ever get past,
          because the doubling never stops.
        </p>
      </>
    ),
    instrument: () => <ForecastInstrument />,
    aside: () => <ForecastChart />,
    stage: 'forecast',
    distance: 5.25,
    autoRotate: 0.8,
    pose: WORLD_LAYOUT.forecastPose,
    onEnter(s) {
      fractalStage(s, 'forecast')
      s.setForecast({ running: false, speed: 1, members: 50, perturbation: 0.1, resetSerial: s.forecast.resetSerial + 1 })
      cameraDirector.goTo(WORLD_LAYOUT.forecastPose, 1.5)
    },
    cues: [
      {
        at: 'Watch the fifty copies.',
        run: (s, d) => {
          // pace the model so day three and day ten land on the words
          const t3 = d.timeOf('Day three') - d.time
          const t10 = d.timeOf('By day ten') - d.time
          const speed = Number.isFinite(t3) && t3 > 0.5 ? 3 / t3 : 1
          s.setForecast({ running: true, speed: Math.min(4, Math.max(0.5, speed)) })
          if (Number.isFinite(t10) && t10 > t3 + 0.5) {
            window.setTimeout(() => {
              const now = useStore.getState()
              if (CHAPTERS[now.chapter]?.id === 'forecast') now.setForecast({ speed: Math.min(4, Math.max(0.5, 7 / (t10 - t3))) })
            }, t3 * 1000)
          }
        },
      },
      { at: 'By day ten', run: (s) => s.setForecast({ speed: 1.2 }) },
      { at: 'And there is a wall', run: () => cameraDirector.goTo(WORLD_LAYOUT.forecastTopPose, 4) },
    ],
  },
  {
    id: 'voice',
    wing: 'world',
    title: 'Your voice is an attractor',
    body: (
      <>
        <p>
          The sound of a voice, drawn as a wave, is a jittery scribble. Plot that wave against
          itself a few milliseconds ago, and again a few milliseconds before that, and the
          scribble unfolds into a shape in three dimensions.
        </p>
        <p>
          This is Takens's trick, from 1981: you do not need to measure everything about a system.
          One signal, delayed against itself, rebuilds the shape of the whole thing. A steady vowel
          is a loop. A rougher sound is a tangle. The shape on screen now is the narrator's voice.
          Try yours.
        </p>
      </>
    ),
    instrument: () => <VoiceInstrument />,
    stage: 'voice',
    distance: 5.2,
    autoRotate: 1.5,
    pose: WORLD_LAYOUT.voicePose,
    onEnter(s) {
      fractalStage(s, 'voice')
      s.setVoice({ source: 'narration', delayMs: 1.6 })
      cameraDirector.goTo(WORLD_LAYOUT.voicePose, 1.5)
    },
    cues: [
      {
        at: 'Try yours.',
        delay: 2.5,
        run: (s) => {
          // once the narrator stops, keep a shape on screen until the visitor picks a source
          if (s.voice.source === 'narration') s.setVoice({ source: 'tone' })
        },
      },
    ],
  },
  {
    id: 'hyperion',
    wing: 'world',
    title: 'The moon that tumbles',
    body: (
      <>
        <p>
          Saturn has a moon shaped like a potato. Hyperion, 360 kilometres long, is the only known
          body in the solar system that tumbles chaotically. Its orbit is slightly stretched, so
          Saturn's pull on that lumpy shape changes on every pass, and the kicks never quite
          repeat. Jack Wisdom predicted this in 1984, before any spacecraft had a good look.
        </p>
        <p>
          Here are two Hyperions started a tenth of a degree apart. Within a few months they face
          different ways, and nobody can say which face of the real Hyperion will point at Saturn
          a year from now. Not because we lack the data. Because the data cannot be had.
        </p>
      </>
    ),
    instrument: () => <HyperionInstrument />,
    stage: 'hyperion',
    distance: 6.5,
    autoRotate: 0.6,
    pose: WORLD_LAYOUT.hyperionPose,
    onEnter(s) {
      fractalStage(s, 'hyperion')
      s.setHyperion({ running: false, twin: true, speed: 0.1, resetSerial: s.hyperion.resetSerial + 1 })
      cameraDirector.goTo(WORLD_LAYOUT.hyperionPose, 1.5)
    },
    cues: [
      // the tumble needs a dozen orbits to show; start it at once, quietly
      { at: 0, run: (s) => s.setHyperion({ running: true, speed: 0.25 }) },
      // the moon is a fifth of Saturn's size: ride alongside it so the tumble is visible
      { at: 'Hyperion:', run: () => cameraDirector.followTarget(hyperionFollow(false, WORLD_LAYOUT.hyperionFollowClose), 3) },
      { at: 'Here are two Hyperions', run: (s) => s.setHyperion({ twin: true }) },
      { at: 'Here are two Hyperions', delay: 0.2, run: () => cameraDirector.followTarget(hyperionFollow(true, WORLD_LAYOUT.hyperionFollowWide), 2) },
      { at: 'Count the orbits.', run: (s) => s.setHyperion({ speed: 1.5 }) },
      { at: 'Not because we lack the data', run: (s) => s.setHyperion({ speed: 0.3 }) },
    ],
  },
  {
    id: 'hold',
    wing: 'world',
    title: 'Chaos you can hold',
    body: (
      <>
        <p>
          A taffy puller is a chaos machine: three rods, turning, stretching the sugar and folding
          it back thousands of times an hour, because stretch-and-fold is the fastest way to mix
          anything. The same geometry kneads bread and mixes chemicals on a chip.
        </p>
        <p>
          In an office in San Francisco a wall of a hundred lava lamps is photographed over and
          over, and the wobble of the wax becomes the random numbers that lock a large slice of
          the internet. And in the 1990s physicists learned to tame chaos: with tiny, well-timed
          nudges a chaotic laser, a fibrillating heart, even the butterfly can be held on any of
          the loops hidden inside it. What makes chaos unpredictable is what makes it
          controllable. A small push goes a long way.
        </p>
      </>
    ),
    instrument: () => <HoldInstrument />,
    stage: 'taffy',
    distance: 3.9,
    autoRotate: 0,
    pose: WORLD_LAYOUT.taffyPose,
    onEnter(s) {
      fractalStage(s, 'taffy')
      s.setTaffy({ running: false, lamps: false, speed: 0.5, resetSerial: s.taffy.resetSerial + 1 })
      cameraDirector.goTo(WORLD_LAYOUT.taffyPose, 1.5)
    },
    cues: [
      { at: 'three rods, turning', run: (s) => s.setTaffy({ running: true }) },
      {
        at: 'In an office in San Francisco',
        run: (s) => {
          s.setTaffy({ lamps: true })
          cameraDirector.goTo(WORLD_LAYOUT.lampsPose, 2)
        },
      },
      {
        at: 'even the butterfly',
        run: (s) => {
          // the callback: the swarm comes back for the closing line
          swarmStage(s)
          toLorenz(s)
          s.setColorMode('speed')
          s.setSwarmVisible(true)
          s.setSwarmOpacity(1)
          s.pushSwarm({ type: 'spawnAttractor' })
        },
      },
    ],
  },
]

/**
 * Ride alongside Hyperion: look at the moon (or the midpoint of the pair) from a point
 * further out from Saturn, a little above the ring plane and to the side, so the planet and
 * its rings stay in the background while the moon tumbles in the foreground.
 */
export function hyperionFollow(pair: boolean, spec: { dist: number; up: number; side: number }): FollowFn {
  return (target, cam) => {
    const m = hyperionLive.moon
    const t = hyperionLive.twin
    target.x = pair ? (m.x + t.x) / 2 : m.x
    target.y = pair ? (m.y + t.y) / 2 : m.y
    target.z = pair ? (m.z + t.z) / 2 : m.z
    // outward (radial) direction in the ring plane and its sideways perpendicular
    const r = Math.hypot(m.x, m.z) || 1
    const ox = m.x / r
    const oz = m.z / r
    cam.x = target.x + ox * spec.dist - oz * spec.side
    cam.y = target.y + spec.up
    cam.z = target.z + oz * spec.dist + ox * spec.side
  }
}

/** half-spread of the initial angle, radians, for `degPerNeighbour` degrees between neighbours */
export function pendulumNudge(degPerNeighbour: number, count: number): number {
  return ((degPerNeighbour * Math.max(1, count - 1)) / 2) * (Math.PI / 180)
}

function walkRuler(s: AppState, d: Director, ruler: number, seconds: number) {
  d.cancel('walk')
  s.setCoast({ ruler, walk: 0 })
  d.tween('walk', 0, 1, seconds, (v) => useStore.getState().setCoast({ walk: v }), easeInOut)
}

function switchTo(s: AppState, id: Parameters<AppState['setSystem']>[0]) {
  if (s.systemId === id) return
  void audio.sfx('shimmer', 0.7)
  s.setSystem(id)
}

export const chapterIndex = (id: string) => CHAPTERS.findIndex((c) => c.id === id)
export const wingOf = (id: WingId) => WINGS.find((w) => w.id === id)!
export const chaptersOfWing = (id: WingId) => CHAPTERS.filter((c) => c.wing === id && c.id !== 'title')
