/**
 * The ensemble-forecast stage: Lorenz-96 weather on a ring of 40 stations, the truth and a
 * fan of perturbed copies, and the numbers the chapter quotes. Checks: pnpm tsx src/world/forecast/verify.ts
 */
export { Ensemble, ENSEMBLE_RADIUS, type EnsembleProps } from './Ensemble'
export {
  CLIMATE_MEAN,
  CLIMATE_SPREAD,
  DAYS_PER_STEP,
  L96_DT,
  L96_F,
  L96_N,
  MAX_MEMBERS,
  STEPS_PER_DAY,
  L96Ensemble,
  type EnsembleStart,
} from './lorenz96'
export { CROWN_RADIAL, CROWN_RISE } from './crown'
