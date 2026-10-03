/**
 * Gray–Scott coats: feed f and kill k for each kind of pattern. verify.ts checks every label on a
 * flat 128 × 128 periodic grid (same Du, Dv, dt and seeding as the sphere) and on the sphere.
 *
 * Gray–Scott is multistable: the coat you get depends on the coat you start from, not only on
 * (f, k). So each preset is checked twice: grown from the seeds, and reached from every other
 * preset's finished coat with the dials gliding the way TuringSphere glides them (glide.ts). The
 * classic values that failed the second test were moved:
 *  - spots 0.030 / 0.062 (Pearson's "solitons") starves a live labyrinth to bare skin, and
 *    eased into from a labyrinth it leaves worm fragments; 0.032 / 0.0625 shatters the labyrinth
 *    into round spots within ~3 s and still grows spots from the seeds;
 *  - stripes 0.046 / 0.063 grows blobs with holes, and 0.046 / 0.064, eased into, leaves a
 *    labyrinth a labyrinth; 0.039 / 0.063 grows separate worms from the seeds and cuts a labyrinth
 *    (of any age, abruptly or eased) into ~20 separate stripes;
 *  - mitosis 0.028 / 0.062 is indistinguishable from spots; at 0.036 / 0.064 a labyrinth falls
 *    apart into a few dozen cells that keep dividing for ~15 s until they fill the coat.
 * A settled spot field stays a spot field at the stripes and mitosis presets (spots are stable
 * across that whole region); that is the model, not a tuning failure.
 */
export interface TuringPreset {
  id: string
  label: string
  feed: number
  kill: number
}

export const TURING_PRESETS: TuringPreset[] = [
  // many small round components, settled once the coat is full
  { id: 'spots', label: 'Spots', feed: 0.032, kill: 0.0625 },
  // separate long components, none wrapping, no holes
  { id: 'stripes', label: 'Stripes', feed: 0.039, kill: 0.063 },
  // one connected maze that wraps the coat
  { id: 'labyrinth', label: 'Labyrinth', feed: 0.037, kill: 0.06 },
  // round cells whose number keeps growing as they divide
  { id: 'mitosis', label: 'Mitosis', feed: 0.036, kill: 0.064 },
  // the negative of spots: one connected sea with many round holes
  { id: 'holes', label: 'Holes', feed: 0.039, kill: 0.058 },
]
