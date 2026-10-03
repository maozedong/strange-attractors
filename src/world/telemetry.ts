/**
 * Live numbers from the Wing IV simulations, written every frame by the stages and read by
 * HUD, instruments and charts on their own cadence. Outside zustand on purpose.
 */
export const FORECAST_CAP = 2048

export const worldTele = {
  /** double pendulums: seconds since release, and the spread (std dev, render units) of the tips */
  pendulumTime: 0,
  pendulumSpread: 0,
  /** forecast: simulated days since the start, ensemble spread (RMS across members, model units),
   *  error of the ensemble mean against the truth, sampled every 6 hours into the rings */
  forecastDay: 0,
  forecastSpread: 0,
  forecastError: 0,
  forecastT: new Float32Array(FORECAST_CAP),
  forecastS: new Float32Array(FORECAST_CAP),
  forecastE: new Float32Array(FORECAST_CAP),
  forecastCount: 0,
  /** voice: input level 0..1 and the estimated pitch in Hz (0 when silent) */
  voiceLevel: 0,
  voicePitch: 0,
  /** hyperion: simulated days since the start, orbits completed, and the angle between the two
   *  bodies' long axes in degrees (NaN without a twin) */
  hyperionDays: 0,
  hyperionOrbits: 0,
  hyperionTwinAngle: NaN,
  /** taffy: pulls completed */
  taffyPulls: 0,
  /** flock: birds simulated, mean alignment 0..1 (how parallel neighbours fly) */
  flockCount: 0,
  flockAlignment: 0,
  /** turing: simulated steps */
  turingSteps: 0,
  /** lenia: generations, total mass, number of separate blobs */
  leniaGeneration: 0,
  leniaMass: 0,
  leniaBlobs: 0,
  /** fireflies: Kuramoto order parameter 0..1, sampled into a ring every 0.1 s with the time */
  firefliesOrder: 0,
  firefliesT: new Float32Array(2048),
  firefliesR: new Float32Array(2048),
  firefliesCount: 0,
  /** sandpile: grains dropped, the last avalanche's size, and a log-binned histogram of sizes
   *  (bin i holds avalanches of size in [2^i, 2^(i+1))) */
  sandGrains: 0,
  sandLastAvalanche: 0,
  sandHistogram: new Float64Array(24),
}

export function resetFirefliesSeries() {
  worldTele.firefliesCount = 0
  worldTele.firefliesOrder = 0
}

export function resetSandHistogram() {
  worldTele.sandHistogram.fill(0)
  worldTele.sandGrains = 0
  worldTele.sandLastAvalanche = 0
}

export function resetForecastSeries() {
  worldTele.forecastCount = 0
  worldTele.forecastDay = 0
  worldTele.forecastSpread = 0
  worldTele.forecastError = 0
}
