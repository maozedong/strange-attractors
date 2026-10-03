import { create } from 'zustand'
import type { SwarmCommand, SystemId, TrajCommand } from './types'
import { defaultParams, getSystem } from './systems'
import {
  DEFAULT_BULB,
  DEFAULT_CAT,
  DEFAULT_COAST,
  DEFAULT_FIREFLIES,
  DEFAULT_FLOCK,
  DEFAULT_FORECAST,
  DEFAULT_FRACTAL,
  DEFAULT_HYPERION,
  DEFAULT_IFS,
  DEFAULT_LENIA,
  DEFAULT_PENDULUM,
  DEFAULT_SANDPILE,
  DEFAULT_TAFFY,
  DEFAULT_TURING,
  DEFAULT_VOICE,
  type BulbState,
  type CatState,
  type CoastState,
  type FirefliesState,
  type FlockState,
  type ForecastState,
  type FractalState,
  type HyperionState,
  type IfsState,
  type LeniaState,
  type PendulumState,
  type SandpileState,
  type Stage,
  type TaffyState,
  type TuringState,
  type VoiceState,
} from './fractal/types'

export type ColorMode = 'speed' | 'origin'

export interface AppState {
  chapter: number
  setChapter: (c: number) => void

  systemId: SystemId
  params: number[]
  /** switch systems: resets params to defaults and asks the swarm to remap into the new frame */
  setSystem: (id: SystemId) => void
  setParam: (index: number, value: number) => void
  resetParams: () => void

  /** playback multiplier applied on top of the system's own rate */
  speed: number
  setSpeed: (s: number) => void
  paused: boolean
  setPaused: (p: boolean) => void

  colorMode: ColorMode
  setColorMode: (m: ColorMode) => void

  swarmVisible: boolean
  setSwarmVisible: (v: boolean) => void
  /** 0..1 multiplier on particle brightness, for cinematic dimming behind text */
  swarmOpacity: number
  setSwarmOpacity: (o: number) => void

  trajVisible: boolean
  setTrajVisible: (v: boolean) => void

  showFixedPoints: boolean
  setShowFixedPoints: (v: boolean) => void

  freePlay: boolean
  setFreePlay: (v: boolean) => void

  /** starting gap for the twins experiment (system units) */
  twinNudge: number
  setTwinNudge: (n: number) => void

  /** which stage set is shown; chapters switch it on entry */
  stage: Stage
  setStage: (s: Stage) => void

  fractal: FractalState
  setFractal: (patch: Partial<FractalState>) => void
  resetFractal: () => void

  ifs: IfsState
  setIfs: (patch: Partial<IfsState>) => void
  coast: CoastState
  setCoast: (patch: Partial<CoastState>) => void
  bulb: BulbState
  setBulb: (patch: Partial<BulbState>) => void
  cat: CatState
  setCat: (patch: Partial<CatState>) => void

  pendulum: PendulumState
  setPendulum: (patch: Partial<PendulumState>) => void
  forecast: ForecastState
  setForecast: (patch: Partial<ForecastState>) => void
  voice: VoiceState
  setVoice: (patch: Partial<VoiceState>) => void
  hyperion: HyperionState
  setHyperion: (patch: Partial<HyperionState>) => void
  taffy: TaffyState
  setTaffy: (patch: Partial<TaffyState>) => void

  flock: FlockState
  setFlock: (patch: Partial<FlockState>) => void
  turing: TuringState
  setTuring: (patch: Partial<TuringState>) => void
  lenia: LeniaState
  setLenia: (patch: Partial<LeniaState>) => void
  fireflies: FirefliesState
  setFireflies: (patch: Partial<FirefliesState>) => void
  sandpile: SandpileState
  setSandpile: (patch: Partial<SandpileState>) => void

  /** master sound switch (ambient, effects, narration) */
  sound: boolean
  setSound: (v: boolean) => void
  /** spoken narration on chapter entry */
  narration: boolean
  setNarration: (v: boolean) => void

  /** command queues drained by the scene each frame (read with getState(), never subscribe) */
  swarmQueue: SwarmCommand[]
  trajQueue: TrajCommand[]
  pushSwarm: (c: SwarmCommand) => void
  pushTraj: (c: TrajCommand) => void
  drainSwarm: () => SwarmCommand[]
  drainTraj: () => TrajCommand[]
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`strange-attractors:${key}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(`strange-attractors:${key}`, value ? '1' : '0')
  } catch {
    /* private mode */
  }
}

export const useStore = create<AppState>((set, get) => ({
  chapter: 0,
  setChapter: (chapter) => set({ chapter }),

  systemId: 'lorenz',
  params: defaultParams(getSystem('lorenz')),
  setSystem: (id) => {
    const { systemId, params } = get()
    if (id === systemId) return
    const from = getSystem(systemId).frame(params)
    const next = getSystem(id)
    const nextParams = defaultParams(next)
    const to = next.frame(nextParams)
    set((s) => ({
      systemId: id,
      params: nextParams,
      swarmQueue: [...s.swarmQueue, { type: 'switchSystem', from, to }],
    }))
  },
  setParam: (index, value) =>
    set((s) => {
      const params = s.params.slice()
      params[index] = value
      return { params }
    }),
  resetParams: () => set((s) => ({ params: defaultParams(getSystem(s.systemId)) })),

  speed: 1,
  setSpeed: (speed) => set({ speed }),
  paused: false,
  setPaused: (paused) => set({ paused }),

  colorMode: 'speed',
  setColorMode: (colorMode) => set({ colorMode }),

  swarmVisible: true,
  setSwarmVisible: (swarmVisible) => set({ swarmVisible }),
  swarmOpacity: 1,
  setSwarmOpacity: (swarmOpacity) => set({ swarmOpacity }),

  trajVisible: false,
  setTrajVisible: (trajVisible) => set({ trajVisible }),

  showFixedPoints: false,
  setShowFixedPoints: (showFixedPoints) => set({ showFixedPoints }),

  freePlay: false,
  setFreePlay: (freePlay) => set({ freePlay }),

  twinNudge: 1e-6,
  setTwinNudge: (twinNudge) => set({ twinNudge }),

  stage: 'swarm',
  setStage: (stage) => set({ stage }),

  fractal: DEFAULT_FRACTAL,
  setFractal: (patch) => set((s) => ({ fractal: { ...s.fractal, ...patch } })),
  resetFractal: () => set({ fractal: DEFAULT_FRACTAL }),

  ifs: DEFAULT_IFS,
  setIfs: (patch) => set((s) => ({ ifs: { ...s.ifs, ...patch } })),
  coast: DEFAULT_COAST,
  setCoast: (patch) => set((s) => ({ coast: { ...s.coast, ...patch } })),
  bulb: DEFAULT_BULB,
  setBulb: (patch) => set((s) => ({ bulb: { ...s.bulb, ...patch } })),
  cat: DEFAULT_CAT,
  setCat: (patch) => set((s) => ({ cat: { ...s.cat, ...patch } })),

  pendulum: DEFAULT_PENDULUM,
  setPendulum: (patch) => set((s) => ({ pendulum: { ...s.pendulum, ...patch } })),
  forecast: DEFAULT_FORECAST,
  setForecast: (patch) => set((s) => ({ forecast: { ...s.forecast, ...patch } })),
  voice: DEFAULT_VOICE,
  setVoice: (patch) => set((s) => ({ voice: { ...s.voice, ...patch } })),
  hyperion: DEFAULT_HYPERION,
  setHyperion: (patch) => set((s) => ({ hyperion: { ...s.hyperion, ...patch } })),
  taffy: DEFAULT_TAFFY,
  setTaffy: (patch) => set((s) => ({ taffy: { ...s.taffy, ...patch } })),

  flock: DEFAULT_FLOCK,
  setFlock: (patch) => set((s) => ({ flock: { ...s.flock, ...patch } })),
  turing: DEFAULT_TURING,
  setTuring: (patch) => set((s) => ({ turing: { ...s.turing, ...patch } })),
  lenia: DEFAULT_LENIA,
  setLenia: (patch) => set((s) => ({ lenia: { ...s.lenia, ...patch } })),
  fireflies: DEFAULT_FIREFLIES,
  setFireflies: (patch) => set((s) => ({ fireflies: { ...s.fireflies, ...patch } })),
  sandpile: DEFAULT_SANDPILE,
  setSandpile: (patch) => set((s) => ({ sandpile: { ...s.sandpile, ...patch } })),

  sound: readPref('sound', true),
  setSound: (sound) => {
    // one switch for everything the visitor hears: effects, ambience and narration
    writePref('sound', sound)
    writePref('narration', sound)
    set({ sound, narration: sound })
  },
  narration: readPref('narration', true),
  setNarration: (narration) => {
    writePref('narration', narration)
    set({ narration })
  },

  swarmQueue: [],
  trajQueue: [],
  pushSwarm: (c) => set((s) => ({ swarmQueue: [...s.swarmQueue, c] })),
  pushTraj: (c) => set((s) => ({ trajQueue: [...s.trajQueue, c] })),
  drainSwarm: () => {
    const q = get().swarmQueue
    if (q.length) set({ swarmQueue: [] })
    return q
  },
  drainTraj: () => {
    const q = get().trajQueue
    if (q.length) set({ trajQueue: [] })
    return q
  },
}))

/** Convenience for non-React code */
export const store = useStore
