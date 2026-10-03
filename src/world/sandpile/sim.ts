/**
 * The live pile's frame step, kept free of three.js so `verify.ts` can drive it exactly as the
 * stage does. Everything is preallocated; nothing here allocates per frame.
 */
import type { SandpileState } from '../../fractal/types'
import { resetSandHistogram, worldTele } from '../telemetry'
import { addGrain, centreIndex, createPile, loadInterior, mulberry32, randomSite, relaxStack, SAND_N, type Pile } from './pile'

/** Most grains dropped in one frame, and the most owed at once: a larger backlog is dropped. */
export const MAX_GRAINS_PER_FRAME = 5000
/**
 * Most topplings in one frame (~2.6 ms at ~13 ns per toppling on a desktop). The critical pile
 * averages ~2,300 topplings a grain but now and then one grain sets off close to a million; such
 * an avalanche runs on over the next frames (its front visibly spreading) instead of stalling
 * one, and the grains owed meanwhile wait. Sustains ~5k grains/s at 60 fps.
 */
export const MAX_TOPPLINGS_PER_FRAME = 200_000
/** A frame longer than this (tab switch, hitch) is counted as this long. */
export const MAX_DT = 0.1
/** A toppled site's flash fades from full to nothing over this many seconds. */
export const FLASH_SECONDS = 0.4

export interface SandSim {
  pile: Pile
  /** per padded site: 1 when it topples, falling linearly to 0 over FLASH_SECONDS */
  heat: Float32Array
  /** drop positions for 'random' mode (re-seeded with the pile) */
  rand: () => number
  /** grains owed (with the fraction), at most MAX_GRAINS_PER_FRAME */
  acc: number
  /** topplings so far of the avalanche in progress (pile.top > 0) */
  avalanche: number
  /** flash fade time, seconds */
  flashSeconds: number
  /** resetSerial whose pile is loaded; −1 before the first */
  serial: number
  /** a pile is loaded and grains may fall (false while a fresh pile is on its way) */
  ready: boolean
  /** heights or heat changed since the last texture write */
  dirty: boolean
  /** some heat is still fading */
  hot: boolean
  /** this frame: grains dropped and topplings */
  grains: number
  topplings: number
}

export function createSim(n = SAND_N): SandSim {
  const pile = createPile(n)
  return {
    pile,
    heat: new Float32Array(pile.h.length),
    rand: mulberry32(1),
    acc: 0,
    avalanche: 0,
    flashSeconds: FLASH_SECONDS,
    serial: -1,
    ready: false,
    dirty: true,
    hot: false,
    grains: 0,
    topplings: 0,
  }
}

/** Seed for the pile of reset number `serial` (deterministic, well spread). */
export function seedFor(serial: number): number {
  return (0x5a17_c0de ^ Math.imul(serial + 1, 0x9e37_79b1)) >>> 0
}

/**
 * Start over from `grid` (a stable n x n grid, e.g. buildCriticalPile's), as reset number
 * `serial`: flashes cleared, drop positions re-seeded, histogram and counters reset.
 */
export function loadPile(sim: SandSim, grid: ArrayLike<number>, serial: number): void {
  loadInterior(sim.pile, grid)
  sim.heat.fill(0)
  sim.rand = mulberry32(seedFor(serial) ^ 0x2545_f491)
  sim.acc = 0
  sim.avalanche = 0
  sim.serial = serial
  sim.ready = true
  sim.dirty = true
  sim.hot = false
  resetSandHistogram()
}

/** A reset was asked for and its pile is not here yet: stop pouring, clear flashes and counts. */
export function holdForReset(sim: SandSim): void {
  sim.ready = false
  sim.acc = 0
  sim.avalanche = 0
  sim.pile.top = 0 // the old pile stands still as it is
  sim.heat.fill(0)
  sim.hot = false
  sim.dirty = true
  resetSandHistogram()
}

/** Absorbs float error in rate·dt sums, so e.g. 200 grains/s for 10 s is exactly 2000 grains. */
const OWED_EPS = 1e-7

/**
 * One frame. First the avalanche in progress, if any, runs on. Then, while `running`, the frame
 * owes `rate·dt` more grains (dt capped at MAX_DT; the backlog capped at MAX_GRAINS_PER_FRAME),
 * dropped on random sites or the centre, each one's avalanche relaxed before the next grain
 * falls, until the grains or MAX_TOPPLINGS_PER_FRAME run out. Telemetry: `sandGrains++` per grain;
 * each finished avalanche (≥ 1 toppling) goes into `sandHistogram[floor(log2 size)]` and
 * `sandLastAvalanche`. Pausing stops the grains, not an avalanche already running.
 */
export function stepSim(sim: SandSim, sp: SandpileState, delta: number): void {
  sim.grains = 0
  sim.topplings = 0
  if (!sim.ready) return
  if (sp.running) {
    const rate = sp.rate > 0 && Number.isFinite(sp.rate) ? sp.rate : 0
    const dt = delta > 0 ? Math.min(delta, MAX_DT) : 0
    sim.acc = Math.min(sim.acc + rate * dt, MAX_GRAINS_PER_FRAME)
  } else sim.acc = 0 // resuming starts clean, no burst of grains saved up while paused

  const p = sim.pile
  const heat = sim.heat
  const centre = sp.mode === 'centre'
  const site = centreIndex(p)
  const hist = worldTele.sandHistogram
  const lastBin = hist.length - 1
  let budget = MAX_TOPPLINGS_PER_FRAME
  for (;;) {
    if (p.top > 0) {
      const done = relaxStack(p, heat, budget)
      sim.avalanche += done
      sim.topplings += done
      budget -= done
      if (p.top > 0) break // out of budget: it runs on next frame
      const size = sim.avalanche
      sim.avalanche = 0
      const bin = 31 - Math.clz32(size)
      hist[bin < lastBin ? bin : lastBin]++
      worldTele.sandLastAvalanche = size
    }
    if (sim.acc + OWED_EPS < 1 || budget <= 0) break
    sim.acc -= 1
    sim.grains++
    worldTele.sandGrains++
    addGrain(p, centre ? site : randomSite(p, sim.rand)) // an avalanche it starts is relaxed above
  }
  if (sim.acc < 0) sim.acc = 0
  if (sim.grains > 0 || sim.topplings > 0) sim.dirty = true
  if (sim.topplings > 0) sim.hot = true
}

/**
 * Write the grid into an n x n RGBA8 texture: R = grains·85 (0, 85, 170, 255; a site still
 * waiting to topple mid-avalanche shows as 3), G = flash 0..255; B and A are left alone. Then fade
 * every flash by dt/flashSeconds. Returns false (and writes nothing) when nothing changed since
 * the last write.
 */
export function writeTexture(sim: SandSim, data: Uint8Array, delta: number): boolean {
  if (!sim.dirty && !sim.hot) return false
  const { n, w, h } = sim.pile
  const heat = sim.heat
  const fade = (delta > 0 ? Math.min(delta, MAX_DT) : 0) / Math.max(1e-3, sim.flashSeconds)
  let hot = false
  for (let y = 0; y < n; y++) {
    let i = (y + 1) * w + 1
    let k = y * n * 4
    for (let x = 0; x < n; x++, i++, k += 4) {
      const v = h[i]
      data[k] = v < 3 ? v * 85 : 255
      const q = heat[i]
      if (q > 0) {
        data[k + 1] = (q * 255 + 0.5) | 0
        const next = q - fade
        heat[i] = next > 0 ? next : 0
        hot = true // even if it just reached 0: the next write must clear what this one drew
      } else data[k + 1] = 0
    }
  }
  sim.hot = hot
  sim.dirty = false
  return true
}

/** Write a compact n x n grid (the single-source pattern) into an RGBA8 texture, R = grains·85. */
export function writeGridTexture(grid: ArrayLike<number>, data: Uint8Array): void {
  for (let i = 0, k = 0; i < grid.length; i++, k += 4) {
    data[k] = grid[i] * 85
    data[k + 1] = 0
    data[k + 2] = 0
    data[k + 3] = 255
  }
}
