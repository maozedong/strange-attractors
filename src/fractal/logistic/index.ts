/**
 * The logistic-map stage: the bifurcation diagram (in logistic or Mandelbrot coordinates),
 * the dripping tap that plays its rhythm, and the numbers and frames the chapters quote.
 */
export { Bifurcation, type BifurcationProps } from './Bifurcation'
export { DripTap, type DripTapProps } from './DripTap'
export {
  C_MAX,
  C_MIN,
  FEIGENBAUM_ALPHA,
  FEIGENBAUM_DELTA,
  FEIGENBAUM_POINT,
  PERIOD3_WINDOW,
  PERIOD_DOUBLINGS,
  R_MAX,
  R_MIN,
  Z_MAX,
  Z_MIN,
  cToX,
  cascadeFrame,
  forkPoint,
  logistic,
  plotX,
  plotY,
  rToC,
  rToX,
  xToY,
  xToZ,
  zToY,
  type CascadeFrame,
  type Coord,
} from './math'
export { prebuildBifurcation } from './cloudLoader'
