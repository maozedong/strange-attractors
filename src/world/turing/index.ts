/**
 * Wing V ─ Turing patterns: Gray–Scott reaction–diffusion on a sphere, read as an animal's coat.
 *
 * Framing (fov 40°, sphere at the origin, radius 1.3, pole up): the sphere fills
 * tan(asin(r / d)) / tan 20° of the frame height from distance d:
 *   d = 3.9 → 97 % (the current turingPose: edge to edge)   d = 4.5 → 83 %
 *   d = 5.0 → 74 % (recommended: a big subject, clear of the vignette)   d = 5.4 → 68 %   d = 6.0 → 61 %
 * A spot is ~7 texels (0.05 units) across, ~1/150 of the circumference: ~20 px at the centre of a
 * 1080 px tall view from d = 5.
 *
 * Gray–Scott reorganises slowly: a coat takes ~3 s (spots) to ~15 s (mitosis) at the default
 * 720 steps/s to become a new pattern after the dials move, and spot fields never turn into
 * stripes (verify.ts, the transition matrix).
 *
 * Numbers for the narration: pnpm tsx src/world/turing/verify.ts [--sphere]
 */
export { TuringSphere, type TuringSphereProps } from './TuringSphere'
export { TURING_PRESETS, type TuringPreset } from './presets'
