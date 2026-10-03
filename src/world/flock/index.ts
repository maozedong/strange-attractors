/**
 * Wing V ─ the murmuration: Reynolds's boids, ten thousand starlings and three rules.
 *
 * Framing (fov 40°, flock round the origin): 98 % of the birds stay within 2.0 of the origin
 * (all within ~2.5); a camera ~7 units away has the flock fill ~70 % of the frame height,
 * ~8.6 keeps the whole ball in frame. The hawk crosses the centre HAWK_ENTRY_TIME (3.5 s)
 * after `flock.hawk` turns on, then every HAWK_PERIOD / 2 (7 s).
 *
 * Numbers for the narration: pnpm tsx src/world/flock/verify.ts
 */
export { Murmuration, murmurationLive, type MurmurationProps } from './Murmuration'
export {
  ALIGNMENT_WEIGHT,
  COHESION_WEIGHT,
  HAWK_ENTRY_TIME,
  HAWK_PERIOD,
  HAWK_RADIUS,
  HAWK_REACH,
  MAX_BOIDS,
  MAX_SPEED,
  MIN_SPEED,
  NEIGHBOURS,
  PERCEPTION,
  SEPARATION_DISTANCE,
  SEPARATION_WEIGHT,
} from './boids'
