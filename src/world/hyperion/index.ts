/**
 * Wing IV ─ Hyperion, the moon that tumbles.
 *
 * Framing (fov 40°, stage at the origin, Saturn radius 0.9, ring to 2.1, orbit a = 3, e = 0.1):
 *  - the whole orbit (6 units across) fits a 16:9 frame from ~6–6.5 units away. The ring plane
 *    is tilted 26° toward +Z and the sun sits at (+5, +2, +3), so cameras on the +Z side above
 *    the ring see its sunlit face. A camera auto-rotating about +Y at elevation φ sees the ring
 *    opened by φ − 26° … φ + 26°: at 21° it crosses the ring plane on the −Z side (and briefly
 *    sees the unlit face); above 26° it never does, ~35° keeps the ring open by ≥ 9°.
 *  - the moon is ~0.5 long; from 6.5 units it is ~8–21 % of the frame height depending on
 *    where it is on the orbit. A static close-up cannot follow it: use `hyperionLive.moon`.
 *
 * Numbers for the narration (pnpm tsx src/world/hyperion/verify.ts): see TWIN_OFFSET_RAD and
 * the verify output; the Lyapunov (e-folding) time of the tumble is about one orbit, 21 days.
 */
export { HyperionStage, HYPERION_ORBIT_A, HYPERION_SUN, HYPERION_TILT, hyperionLive, type HyperionStageProps } from './Hyperion'
export {
  HYPERION_DT,
  HYPERION_ECCENTRICITY,
  HYPERION_MOMENTS,
  HYPERION_PERIOD_DAYS,
  HYPERION_SEMI_AXES,
  INITIAL_TILT_RAD,
  TWIN_OFFSET_RAD,
} from './dynamics'
