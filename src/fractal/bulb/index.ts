/**
 * Wing III ─ the Mandelbulb.
 *
 * Framing (fov 40°, bulb at the origin, default radius; scale distances by radius / 1.25):
 *  - the power-8 bulb fills ~70% of the view height from about 3.3 to 3.5 units away from its
 *    centre (it is 2.2 across; 1.1 / (0.35 · tan 20°) = 3.45); 2.6 frames it tightly, 5 leaves
 *    room for the text panel. At n = 2 its body is smaller (median radius 0.66 vs 0.86) but a
 *    few spikes reach 1.78.
 *  - dives: OrbitControls' minDistance is measured to the target, not to the surface. Keep the
 *    camera's bulbDistance() above ~0.01 (floats break up below ~1e-5 in fractal units; the
 *    picture stays crisp above ~0.1 and softens, without speckle, between 0.1 and 0.01). Never
 *    put the camera inside the set (bulbDistance ≤ 0): the view fills with one surface point.
 */
export { Mandelbulb, type MandelbulbProps } from './Mandelbulb'
export { BULB_RADIUS, bulbBound, bulbDistance } from './de'
export { MAX_SCALE, MIN_SCALE } from './governor'
export { bulbStats } from './BulbRenderer'
