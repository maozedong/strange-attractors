/**
 * The coastline stage: how long is the coast of Britain (Richardson's ruler walks over the
 * Natural Earth coastline) and box counting on the Lorenz butterfly, with the numbers the
 * chapters quote.
 */
export { Coastline, type CoastlineProps } from './Coastline'
export { BoxCount, type BoxCountProps } from './BoxCount'
export {
  RULERS,
  britainData,
  coastDimension,
  loadBritain,
  walkInfo,
  type Britain,
  type BritainWalk,
  type WalkInfo,
} from './britain'
export {
  BOX_SAMPLE_COUNT,
  MAX_BOXES,
  boxCounts,
  boxDimension,
  lorenzSample,
  type BoxTally,
} from './boxCounting'
