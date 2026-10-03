/**
 * The chaos-game stage (iterated function systems): the GPU collage of 262,144 points, the
 * simulation behind it, and the preset systems with their published coefficients and frames.
 */
export { ChaosGame, PRESET_LABELS, chaosGameStatus, type ChaosGameProps } from './ChaosGame'
export { IfsSim, RESPAWN_BOUND, SCATTER_TONE } from './IfsSim'
export {
  IFS_PRESETS,
  IFS_PRESET_ORDER,
  MAP_COUNT_MAX,
  VARIATION_ROTATION,
  VARIATION_SCALE,
  createIfsUniforms,
  presetUniforms,
  slotTone,
  stageFrame,
  stageMap,
  type IfsFrame,
  type IfsMap,
  type IfsPresetDef,
  type IfsUniforms,
  type StageMap,
} from './presets'
