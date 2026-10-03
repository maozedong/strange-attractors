import type { MandelView } from '../types'

/**
 * Places worth flying to. `scale` is complex units per render unit of plane width, so the
 * framing depends on the plane: these assume a plane on which `overview` shows the whole set
 * (the 4 x 3 stage plane spans 4.4 x 3.3 at scale 1.1). The two copies are framed exactly as
 * `overview` frames the whole set, so each reads as the same picture again.
 *
 * Checked by `pnpm tsx src/fractal/mandel/verify-targets.ts`:
 *
 *  overview     inside the main cardioid.
 *  seahorse     within 2e-16 of the nucleus of a period-998 mini-brot (inside the set; the
 *               mini-brot is about 6e-16 across, sub-pixel at this zoom). Iterations in view
 *               run from about 1970 to the 4000 budget.
 *  period3      the period-3 copy on the real axis: nucleus -1.7548776662466927, cusp -1.75,
 *               antenna tip -1.7903274919993457 (0.0403 wide, 1/55.8 of the whole set).
 *  period3deep  the period-27 copy: the period-3 copy's own period-3 copy's period-3 copy
 *               (nucleus -1.786429858055761, cusp -1.7864282526906992,
 *               tip -1.7864415279055113; 1.33e-5 wide).
 *  elephant     the Misiurewicz point M(45,1) in elephant valley: z_45 lands exactly on the
 *               repelling fixed point, so the picture is a spiral that repeats at every depth.
 *               It lies on the boundary of the set, so an orbit started anywhere near it escapes
 *               (about 1500 iterations here) and no nearby point survives the 5000-iteration
 *               membership test. Iterations in view run from about 580 to 3350.
 */
export const MANDEL_TARGETS = {
  overview: { cx: -0.6, cy: 0, scale: 1.1 },
  seahorse: { cx: -0.7436438870371587, cy: 0.1318259042053119, scale: 1e-12 },
  period3: { cx: -1.765234830310864, cy: 0, scale: 0.0197 },
  period3deep: { cx: -1.7864332677718504, cy: 0, scale: 6.5e-6 },
  elephant: { cx: 0.2549870375144766, cy: -0.0005679790528461, scale: 1e-9 },
} satisfies Record<string, MandelView>

export type MandelTargetName = keyof typeof MANDEL_TARGETS
