import type { AppState } from '../store'
import { useStore } from '../store'
import type { Chapter } from './chapters'
import { CHAPTERS } from './chapters'
import { cameraDirector } from '../scene/cameraDirector'
import { EMERGENCE_LAYOUT } from '../scene/layouts'
import { cancelMandelFlight } from '../fractal/mandel/tween'
import type { Stage } from '../fractal/types'
import { FlockInstrument } from '../ui/instruments/FlockInstrument'
import { TuringInstrument } from '../ui/instruments/TuringInstrument'
import { LeniaInstrument } from '../ui/instruments/LeniaInstrument'
import { FirefliesInstrument } from '../ui/instruments/FirefliesInstrument'
import { SandpileInstrument } from '../ui/instruments/SandpileInstrument'
import { FirefliesChart } from '../ui/FirefliesChart'
import { SandpileChart } from '../ui/SandpileChart'
import { TURING_PRESETS } from '../world/turing'
import { LENIA_SPECIES } from '../world/lenia'
import { easeInOut } from '../director/director'

function stage(s: AppState, st: Stage) {
  cancelMandelFlight()
  s.setCoast({ box: 0 })
  s.setStage(st)
  s.setPaused(false)
  s.setFreePlay(false)
  s.setSwarmVisible(false)
  s.setTrajVisible(false)
  s.pushTraj({ type: 'clear' })
  s.setShowFixedPoints(false)
}

const preset = (id: string) => TURING_PRESETS.find((p) => p.id === id) ?? TURING_PRESETS[0]

function tweenCoat(d: Parameters<NonNullable<Chapter['cues']>[number]['run']>[1], s: AppState, id: string, seconds = 2) {
  const p = preset(id)
  const { feed, kill } = s.turing
  d.tween('feed', feed, p.feed, seconds, (v) => useStore.getState().setTuring({ feed: v }), easeInOut)
  d.tween('kill', kill, p.kill, seconds, (v) => useStore.getState().setTuring({ kill: v }), easeInOut)
}

export const WING5_CHAPTERS: Chapter[] = [
  {
    id: 'murmuration',
    wing: 'emergence',
    title: 'Ten thousand starlings',
    body: (
      <>
        <p>
          Ten thousand starlings and no leader. Three rules: don't crowd your neighbours, fly the
          way they fly, stay close to them. That is all. Craig Reynolds wrote those rules down in
          1986 to animate birds for films, and the flock that appeared behaved like a real one: it
          splits round a hawk and heals, it turns as a wave, it never collides.
        </p>
        <p>
          Nobody is in charge. The shape of the flock has no address in any bird. Order of this
          kind is called emergence, and it is the mirror image of chaos: there, simple rules make
          motion nobody can predict; here, simple rules make a thing that looks designed.
        </p>
      </>
    ),
    instrument: () => <FlockInstrument />,
    stage: 'flock',
    distance: 7.0,
    autoRotate: 0.8,
    pose: EMERGENCE_LAYOUT.flockPose,
    onEnter(s) {
      stage(s, 'flock')
      s.setFlock({ count: 10000, hawk: false, rules: 'all', running: true, resetSerial: s.flock.resetSerial + 1 })
      cameraDirector.goTo(EMERGENCE_LAYOUT.flockPose, 1.5)
    },
    cues: [
      { at: "don't crowd your neighbours", run: (s) => s.setFlock({ rules: 'noSeparation' }) },
      { at: 'fly the way they fly', run: (s) => s.setFlock({ rules: 'noAlignment' }) },
      { at: 'stay close to them', run: (s) => s.setFlock({ rules: 'noCohesion' }) },
      { at: 'That is all.', run: (s) => s.setFlock({ rules: 'all' }) },
      { at: 'it splits round a hawk', run: (s) => s.setFlock({ hawk: true }) },
      { at: 'Nobody is in charge', run: (s) => s.setFlock({ hawk: false }) },
    ],
  },
  {
    id: 'turing',
    wing: 'emergence',
    title: "The leopard's spots",
    body: (
      <>
        <p>
          In 1952, two years before he died, Alan Turing asked how the leopard gets its spots. His
          answer: two chemicals spreading through the skin at different speeds, one making more
          of itself, the other killing it off. Where the slow one wins, a spot. Where it loses,
          bare skin. Start them off uniform, with the smallest flicker of noise, and the pattern
          invents itself.
        </p>
        <p>
          Now turn two dials and watch. The labyrinth straightens into stripes. Push a little
          further and the stripes break into cells that divide, and divide again. Further still
          and the dividing settles into spots. The leopard's spots and the zebra's stripes are the
          same equation with the dial in a different place. It took nearly forty years before
          anyone saw it happen in a dish.
        </p>
      </>
    ),
    instrument: () => <TuringInstrument />,
    stage: 'turing',
    distance: 5.0,
    autoRotate: 0,
    pose: EMERGENCE_LAYOUT.turingPose,
    onEnter(s) {
      stage(s, 'turing')
      const p = preset('labyrinth')
      s.setTuring({ feed: p.feed, kill: p.kill, running: true, resetSerial: s.turing.resetSerial + 1 })
      cameraDirector.goTo(EMERGENCE_LAYOUT.turingPose, 1.5)
    },
    // order matters: Gray–Scott cannot turn a spot field into stripes or dividing cells
    // (spots are stable across that whole region), so the tour goes labyrinth → stripes →
    // mitosis → spots, each given a few seconds to reorganise
    cues: [
      { at: 'Start them off', run: (s) => s.setTuring({ resetSerial: s.turing.resetSerial + 1 }) },
      { at: 'straightens into stripes', run: (s, d) => tweenCoat(d, s, 'stripes', 1.5) },
      { at: 'break into cells that divide', run: (s, d) => tweenCoat(d, s, 'mitosis', 1.5) },
      { at: 'settles into spots', run: (s, d) => tweenCoat(d, s, 'spots', 1.5) },
    ],
  },
  {
    id: 'lenia',
    wing: 'emergence',
    title: 'Creatures nobody drew',
    body: (
      <>
        <p>
          Conway's Game of Life ran on a grid of squares, each alive or dead. In 2019 Bert Chan
          asked what happens if you make it smooth: cells that are a little bit alive,
          neighbourhoods shaped like rings, time that flows instead of ticking. He called it
          Lenia.
        </p>
        <p>
          Something nobody designed showed up: creatures. They swim. They keep their shape. There
          are hundreds of species now, catalogued like beetles, and not one of them was drawn by
          anybody. They are solutions. The rule found them.
        </p>
      </>
    ),
    instrument: () => <LeniaInstrument />,
    stage: 'lenia',
    distance: 5.0,
    autoRotate: 0,
    pose: EMERGENCE_LAYOUT.leniaPose,
    onEnter(s) {
      stage(s, 'lenia')
      s.setLenia({ species: LENIA_SPECIES[0]?.id ?? 'orbium', speed: 10, running: true, resetSerial: s.lenia.resetSerial + 1 })
      cameraDirector.goTo(EMERGENCE_LAYOUT.leniaPose, 1.5)
    },
    cues: [
      {
        at: 'There are hundreds of species now',
        run: (s) => {
          const next = LENIA_SPECIES[1]
          if (next) s.setLenia({ species: next.id, resetSerial: s.lenia.resetSerial + 1 })
        },
      },
      {
        at: 'They are solutions.',
        run: (s) => {
          const next = LENIA_SPECIES[2] ?? LENIA_SPECIES[0]
          if (next) s.setLenia({ species: next.id, resetSerial: s.lenia.resetSerial + 1 })
        },
      },
    ],
  },
  {
    id: 'fireflies',
    wing: 'emergence',
    title: 'Falling into step',
    body: (
      <>
        <p>
          On the riverbanks of Thailand, whole trees of fireflies flash together. Each one only
          sees its neighbours and nudges its own timing a little toward theirs. From that, within
          minutes, the entire tree blinks as one.
        </p>
        <p>
          Yoshiki Kuramoto wrote down the equation in 1975: a crowd of oscillators, each pulling
          the others into step. Below a certain coupling they ignore each other and the flashing
          is noise. Above it, they lock. Not all at once: a core forms and grows, and the
          stragglers fall in. The pacemaker cells in your heart do this. So did the Millennium
          Bridge in London on its opening day, when a thousand footsteps fell into step and the
          whole bridge began to sway. This is the opposite of the butterfly effect, and it comes
          from the same kind of equation.
        </p>
      </>
    ),
    instrument: () => <FirefliesInstrument />,
    aside: () => <FirefliesChart />,
    stage: 'fireflies',
    distance: 5.0,
    autoRotate: 0.5,
    pose: EMERGENCE_LAYOUT.firefliesPose,
    onEnter(s) {
      stage(s, 'fireflies')
      s.setFireflies({ coupling: 0, count: 1500, running: true, resetSerial: s.fireflies.resetSerial + 1 })
      cameraDirector.goTo(EMERGENCE_LAYOUT.firefliesPose, 1.5)
    },
    cues: [
      // timings from src/world/fireflies/verify.ts: 2.0 locks the tree in ~13 s, in time for "blinks as one"
      { at: 'nudges its own timing', run: (s, d) => d.tween('coupling', s.fireflies.coupling, 2.0, 2, (v) => useStore.getState().setFireflies({ coupling: v })) },
      // a locked tree takes too long to fall apart on its own; scramble the clocks for the second act
      { at: 'Below a certain coupling', run: (s) => s.setFireflies({ coupling: 0.2, resetSerial: s.fireflies.resetSerial + 1 }) },
      { at: 'Above it, they lock.', run: (s, d) => d.tween('coupling', s.fireflies.coupling, 1.6, 1.5, (v) => useStore.getState().setFireflies({ coupling: v })) },
    ],
  },
  {
    id: 'sandpile',
    wing: 'emergence',
    title: 'The edge of collapse',
    body: (
      <>
        <p>
          Drop sand one grain at a time onto a pile. Mostly nothing happens. Now and then a grain
          tips its neighbour, which tips its neighbours, and an avalanche runs down the whole
          slope. Per Bak, Chao Tang and Kurt Wiesenfeld built this toy in 1987 and found that the
          avalanches have no typical size: small ones are common, enormous ones rare, and the rule
          connecting them is the rule that connects small earthquakes to great ones.
        </p>
        <p>
          The pile organises itself to the edge of collapse and stays there. Nobody tunes it. And
          if you pour every grain onto the same spot, with perfect patience, starting from
          nothing, the pile settles into a fractal.
        </p>
      </>
    ),
    instrument: () => <SandpileInstrument />,
    aside: () => <SandpileChart />,
    stage: 'sandpile',
    distance: 4.75,
    autoRotate: 0,
    pose: EMERGENCE_LAYOUT.sandpilePose,
    onEnter(s) {
      stage(s, 'sandpile')
      s.setSandpile({ running: true, rate: 20, mode: 'random', identity: false, resetSerial: s.sandpile.resetSerial + 1 })
      cameraDirector.goTo(EMERGENCE_LAYOUT.sandpilePose, 1.5)
    },
    cues: [
      // above a few hundred grains a second the flashes wash the picture out
      { at: 'Now and then a grain tips', run: (s) => s.setSandpile({ rate: 120 }) },
      { at: 'and an avalanche runs down', run: (s) => s.setSandpile({ rate: 400 }) },
      { at: 'The pile organises itself', run: (s) => s.setSandpile({ rate: 200 }) },
      { at: 'And if you pour every grain onto the same spot', run: (s) => s.setSandpile({ identity: true }) },
    ],
  },
]

/** chapters are appended at module load so the rest of the app sees one list */
export function registerWing5() {
  if (!CHAPTERS.some((c) => c.wing === 'emergence')) CHAPTERS.push(...WING5_CHAPTERS)
}
