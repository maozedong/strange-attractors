import type { ForecastState } from '../../fractal/types'
import { FORECAST_CAP, resetForecastSeries, worldTele } from '../telemetry'
import { L96Ensemble, L96_DT, L96_N, MAX_MEMBERS, STEPS_PER_DAY, l96Tendency } from './lorenz96'
import { CROWN_FLOATS, writeCrown, type CrownRing } from './crown'

/**
 * The forecast stage's clock and drawing state, separate from React and three.js so verify.ts
 * can drive real frames. One `advanceForecast` call per frame: restart on a new run, step the
 * model at `speed` days per real second, publish telemetry, and (when anything moved) fill
 * `view` with the states to draw.
 *
 * The model steps in 6-hour jumps; the drawing is a cubic Hermite blend across the last step,
 * using the model's own tendencies at both ends, so motion is continuous in position and
 * velocity at any speed. The drawn time trails the telemetry's day by less than one step.
 *
 * Nothing here allocates after createForecastSim (a restart passes one small object).
 */

/** longest frame the clock honours (a stalled tab must not fast-forward the weather) */
export const MAX_DELTA = 0.1
/** at most this many 6-hour steps per frame; any further backlog is dropped */
export const MAX_STEPS_PER_FRAME = 48
/** drawing slots: 0 is the truth, k + 1 is member k */
export const SLOTS = MAX_MEMBERS + 1

const N = L96_N

export function createForecastSim() {
  return {
    ens: new L96Ensemble(),
    /** what the running ensemble was started with; NaN forces a start on the first frame */
    serial: NaN,
    members: -1,
    perturbation: NaN,
    /** fractional steps owed to the clock; also how far the drawing is across the last step */
    acc: 0,
    /** false until the first step after a start: nothing to blend from, draw the states as they are */
    hasPrev: false,
    /** the states one step before the current ones (by slot) and the tendencies at both ends */
    x0: new Float64Array(SLOTS * N),
    f0: new Float64Array(SLOTS * N),
    f1: new Float64Array(SLOTS * N),
    /** what is drawn: the blended states (by slot) and the mean of the blended members */
    view: new Float64Array(SLOTS * N),
    viewMean: new Float64Array(N),
  }
}

export type ForecastSim = ReturnType<typeof createForecastSim>

export function clampMembers(m: number): number {
  return Math.max(0, Math.min(MAX_MEMBERS, Math.round(m) || 0))
}

/** Publish the current numbers and append them to the series (one sample per 6-hour step). */
function record(ens: L96Ensemble) {
  const day = ens.day
  worldTele.forecastDay = day
  worldTele.forecastSpread = ens.spread
  worldTele.forecastError = ens.error
  const c = worldTele.forecastCount
  if (c < FORECAST_CAP) {
    worldTele.forecastT[c] = day
    worldTele.forecastS[c] = ens.spread
    worldTele.forecastE[c] = ens.error
    worldTele.forecastCount = c + 1
  }
}

function restart(sim: ForecastSim, serial: number, members: number, perturbation: number) {
  sim.ens.start({ serial, members, perturbation })
  sim.serial = serial
  sim.members = members
  sim.perturbation = perturbation
  sim.acc = 0
  sim.hasPrev = false
  resetForecastSeries()
  record(sim.ens) // day 0
}

/** Copy the current states into `x0` (unless null) and their tendencies into `f`, by slot. */
function captureStates(sim: ForecastSim, x0: Float64Array | null, f: Float64Array) {
  const { ens } = sim
  if (x0) x0.set(ens.truth)
  l96Tendency(ens.truth, 0, f, 0)
  for (let k = 0; k < ens.count; k++) {
    const src = k * N
    const dst = (k + 1) * N
    if (x0) for (let i = 0; i < N; i++) x0[dst + i] = ens.members[src + i]
    l96Tendency(ens.members, src, f, dst)
  }
}

/**
 * Fill `view` with the states the fraction `acc` of the way across the last step, and
 * `viewMean`. (Reads acc from the sim: a double passed to a function this size gets boxed.)
 */
export function blendForecast(sim: ForecastSim) {
  const { ens, view, viewMean, x0, f0, f1, hasPrev } = sim
  const u = sim.acc
  const m = ens.count
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = (u3 - 2 * u2 + u) * L96_DT
  const h01 = -2 * u3 + 3 * u2
  const h11 = (u3 - u2) * L96_DT
  for (let q = 0; q <= m; q++) {
    const o = q * N
    const x1 = q === 0 ? ens.truth : ens.members
    const src = q === 0 ? 0 : (q - 1) * N
    if (hasPrev) {
      for (let i = 0; i < N; i++) view[o + i] = h00 * x0[o + i] + h10 * f0[o + i] + h01 * x1[src + i] + h11 * f1[o + i]
    } else {
      for (let i = 0; i < N; i++) view[o + i] = x1[src + i]
    }
  }
  if (m === 0) {
    for (let i = 0; i < N; i++) viewMean[i] = view[i]
    return
  }
  viewMean.fill(0)
  for (let q = 1; q <= m; q++) {
    const o = q * N
    for (let i = 0; i < N; i++) viewMean[i] += view[o + i]
  }
  const inv = 1 / m
  for (let i = 0; i < N; i++) viewMean[i] *= inv
}

/**
 * One frame. Returns true when `view` was refilled (a restart, or the clock moved), i.e. when
 * the drawing must be rewritten.
 */
export function advanceForecast(sim: ForecastSim, f: ForecastState, delta: number): boolean {
  let moved = false
  const members = clampMembers(f.members)
  if (!Object.is(f.resetSerial, sim.serial) || members !== sim.members || !Object.is(f.perturbation, sim.perturbation)) {
    restart(sim, f.resetSerial, members, f.perturbation)
    moved = true
  }

  const speed = Number.isFinite(f.speed) ? Math.max(0, f.speed) : 0
  const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_DELTA) : 0
  if (f.running && speed > 0 && dt > 0) {
    sim.acc += speed * STEPS_PER_DAY * dt
    let n = Math.floor(sim.acc)
    sim.acc -= n
    if (n > MAX_STEPS_PER_FRAME) n = MAX_STEPS_PER_FRAME
    for (let i = 0; i < n; i++) {
      // the blend runs across the last step of the frame: remember where it starts
      if (i === n - 1) captureStates(sim, sim.x0, sim.f0)
      sim.ens.step()
      record(sim.ens)
    }
    if (n > 0) {
      captureStates(sim, null, sim.f1)
      sim.hasPrev = true
    }
    moved = true
  }

  if (moved) blendForecast(sim)
  return moved
}

/**
 * Write the drawn crowns into segment buffers: every member (member k at k·CROWN_FLOATS), the
 * mean of the drawn members, and the truth. Returns the member count.
 */
export function writeForecastCrowns(
  sim: ForecastSim,
  ring: CrownRing,
  members: Float32Array,
  mean: Float32Array,
  truth: Float32Array,
): number {
  const m = sim.ens.count
  const view = sim.view
  for (let k = 0; k < m; k++) writeCrown(view, (k + 1) * N, ring, members, k * CROWN_FLOATS)
  writeCrown(sim.viewMean, 0, ring, mean, 0)
  writeCrown(view, 0, ring, truth, 0)
  return m
}
