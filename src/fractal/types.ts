/** A view into the complex plane: centre (JS doubles) and complex units per render unit. */
export interface MandelView {
  cx: number
  cy: number
  /** complex-plane width covered by one render unit of the plane; smaller = deeper zoom */
  scale: number
}

export interface FractalState {
  /** logistic map parameter r (2.5 .. 4) */
  r: number
  /** bifurcation diagram is drawn only for r below this (0 hides it, 4 shows all) */
  reveal: number
  mandel: MandelView
  /** the Julia parameter c, which is also the cursor on the Mandelbrot plane */
  julia: { cx: number; cy: number }
  /** the Mandelbrot plane accepts wheel-zoom and drag-pan */
  mandelInteractive: boolean
  /** clicks / drags on the Mandelbrot plane move the Julia cursor */
  juliaPickable: boolean
}

export const DEFAULT_FRACTAL: FractalState = {
  r: 2.9,
  reveal: 0,
  mandel: { cx: -0.6, cy: 0, scale: 1.1 },
  julia: { cx: -0.8, cy: 0.156 },
  mandelInteractive: false,
  juliaPickable: false,
}

/** Which stage set is on: the particle swarm, the logistic map, or the complex plane. */
export type Stage =
  | 'swarm'
  | 'logistic'
  | 'mandelbrot'
  | 'ifs'
  | 'coast'
  | 'bulb'
  | 'cat'
  | 'pendulum'
  | 'forecast'
  | 'voice'
  | 'hyperion'
  | 'taffy'
  | 'flock'
  | 'turing'
  | 'lenia'
  | 'fireflies'
  | 'sandpile'

/** Wing III ─ the chaos game (iterated function systems) */
export type IfsPreset = 'sierpinski' | 'fern' | 'dragon' | 'leaf' | 'spiral'

export interface IfsState {
  preset: IfsPreset
  /** iterations per second; 0 = frozen */
  rate: number
  /** −1..1, bends the preset's maps a little (a different "species") */
  variation: number
  /** scatter every point uniformly again (bump to trigger) */
  resetSerial: number
}

/** Wing III ─ the coastline and box counting */
export interface CoastState {
  /** ruler length in km; 0 = no ruler shown */
  ruler: number
  /** how far along the walk the animation is, 0..1 */
  walk: number
  /** box edge in render units for the Lorenz box count; 0 = no boxes */
  box: number
}

/** Wing III ─ the Mandelbulb */
export interface BulbState {
  /** exponent n in the spherical power map; 8 is the classic */
  power: number
  /** camera may orbit / zoom */
  interactive: boolean
}

/** Wing III ─ Arnold's cat map */
export interface CatState {
  /** iterations applied so far */
  step: number
  /** iterations per second; 0 = frozen */
  rate: number
  /** 'cat' = bundled photo, 'camera' = the visitor's webcam snapshot */
  source: 'cat' | 'camera'
  /** bump to reset to step 0 */
  resetSerial: number
  /** when set, never step past this count (so the recurrence lands exactly) */
  stopAt: number | null
}

export const DEFAULT_IFS: IfsState = { preset: 'sierpinski', rate: 0, variation: 0, resetSerial: 0 }
export const DEFAULT_COAST: CoastState = { ruler: 0, walk: 0, box: 0 }
export const DEFAULT_BULB: BulbState = { power: 8, interactive: false }
export const DEFAULT_CAT: CatState = { step: 0, rate: 0, source: 'cat', resetSerial: 0, stopAt: null }

/* ───────────────────────── Wing IV ─ chaos in the world ───────────────────────── */

export interface PendulumState {
  /** number of double pendulums released together */
  count: number
  /** spread of the initial angle across the copies, radians */
  nudge: number
  running: boolean
  resetSerial: number
}

export interface ForecastState {
  running: boolean
  resetSerial: number
  /** ensemble members besides the truth */
  members: number
  /** standard deviation of the initial-condition error */
  perturbation: number
  /** simulated days per real second */
  speed: number
}

export interface VoiceState {
  /** what the attractor listens to */
  source: 'narration' | 'mic' | 'tone'
  /** embedding delay in milliseconds */
  delayMs: number
}

export interface HyperionState {
  running: boolean
  resetSerial: number
  /** draw a second Hyperion started a hair apart */
  twin: boolean
  /** orbits per real second */
  speed: number
}

export interface TaffyState {
  running: boolean
  resetSerial: number
  /** pulls per real second */
  speed: number
  /** show the lava-lamp wall instead of the puller */
  lamps: boolean
}

export const DEFAULT_PENDULUM: PendulumState = { count: 100, nudge: 1e-6, running: false, resetSerial: 0 }
export const DEFAULT_FORECAST: ForecastState = { running: false, resetSerial: 0, members: 50, perturbation: 0.1, speed: 1 }
export const DEFAULT_VOICE: VoiceState = { source: 'narration', delayMs: 1.6 }
export const DEFAULT_HYPERION: HyperionState = { running: false, resetSerial: 0, twin: true, speed: 0.1 }
export const DEFAULT_TAFFY: TaffyState = { running: false, resetSerial: 0, speed: 0.5, lamps: false }

/* ───────────────────────── Wing V ─ order from nothing ───────────────────────── */

export interface FlockState {
  count: number
  /** a predator flies through the flock */
  hawk: boolean
  /** which rules are on: 'all', or one switched off to show what it did */
  rules: 'all' | 'noAlignment' | 'noCohesion' | 'noSeparation'
  running: boolean
  resetSerial: number
}

export interface TuringState {
  /** Gray–Scott feed and kill rates */
  feed: number
  kill: number
  running: boolean
  resetSerial: number
}

export interface LeniaState {
  /** species id from the catalogue in src/world/lenia */
  species: string
  running: boolean
  resetSerial: number
  /** generations per real second */
  speed: number
}

export interface FirefliesState {
  /** Kuramoto coupling strength */
  coupling: number
  count: number
  running: boolean
  resetSerial: number
}

export interface SandpileState {
  running: boolean
  /** grains dropped per real second */
  rate: number
  /** where the grains fall */
  mode: 'random' | 'centre'
  /** show the precomputed single-source pattern instead of the live pile */
  identity: boolean
  resetSerial: number
}

export const DEFAULT_FLOCK: FlockState = { count: 10000, hawk: false, rules: 'all', running: true, resetSerial: 0 }
export const DEFAULT_TURING: TuringState = { feed: 0.037, kill: 0.06, running: true, resetSerial: 0 }
export const DEFAULT_LENIA: LeniaState = { species: 'orbium', running: true, resetSerial: 0, speed: 10 }
export const DEFAULT_FIREFLIES: FirefliesState = { coupling: 0, count: 1500, running: true, resetSerial: 0 }
export const DEFAULT_SANDPILE: SandpileState = { running: false, rate: 200, mode: 'random', identity: false, resetSerial: 0 }
