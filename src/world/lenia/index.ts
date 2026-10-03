/**
 * Wing IV ─ Lenia, the continuous Game of Life (Bert Wang-Chak Chan, 2019).
 *
 * <Lenia size? opacity? /> draws a size × size dish (256 × 256 cells, a torus) in the group's
 * local XY plane facing +Z; the parent positions the group. A cell is size / 256 units.
 *
 * Framing at fov 40° (vertical), camera on the dish's axis: the dish exactly fills the frame
 * height from size / (2 tan 20°) ≈ 1.37 · size. For size 3: 4.1 units fills it, 5.5 leaves
 * it at 75 % of the frame height (recommended), 6.5 at 63 %.
 * Creatures are small against the dish: an Orbium is ~20 cells (0.23 units at size 3), the
 * three-ring glider ~36 cells (0.42). A single creature fills ~40 % of the frame height from
 * ~0.8 units (Orbium) or ~1.4 units (three-ring glider).
 * Orbium glides 0.615 cells per generation: at the default speed (10 generations per second)
 * 0.072 units per second at size 3, across the dish in ~42 s.
 *
 * Numbers for the narration: pnpm tsx src/world/lenia/verify.ts  (--layout for the start)
 */
export { Lenia, leniaStatus, type LeniaProps } from './Lenia'
export { LENIA_SPECIES, getSpecies, type LeniaSpecies } from './species'
