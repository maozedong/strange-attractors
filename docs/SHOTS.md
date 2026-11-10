# Shot lists

What each scene shows, line by line. Line numbers are the 0-based spoken lines in
`src/film/screenplay.ts`. These are direction, not code: where a number turns out wrong on
screen (a pace, a distance) fix it; where an idea turns out weak, do the stronger thing in the
same spirit and say so in your report. The contract in `docs/SCENES.md` is not negotiable.

Acts and their colours: II water and ink (teal to bone), III moss and chalk, IV brass at dusk,
V phosphor. Use `ctx.palette`; never name a colour.

---

## Act II

### tap — "The dripping tap" (9 lines)

Subject: a rhythm turning into chaos, then every rhythm laid side by side.

- Set: still dark water. `dust.floorY = FLOOR`, floor on. Drops fall from a small point of
  light near the top of frame (no tap model) onto the mirror floor and ring it: each landing
  spreads one or two thin expanding rings (a prop: ring meshes or a small shader on a floor
  plane, in ramp colours, fading in about 2 s). Each landing plays `sound.sfx('drip', gain, rate)`
  with the rate following the gap (longer gap, lower pitch).
- The drip sim is in `src/fractal/logistic/DripTap.tsx` (`createSim`, `releaseDrop`: each drop
  does `x = logistic(r, x)`, next gap `0.22 + 0.9 x` seconds). Port it.
- The rhythm made visible: beside the falling drops, each drip leaves a mark at height
  proportional to its gap, in a strip that slides slowly left, the newest 48 kept (dust:
  a PointsSource; each mark a small bright cluster, older ones dimmer via aux tone). One rhythm
  is one row of marks; a split is two rows; then four; then scatter. This is the bifurcation
  diagram being discovered one column at a time, so place it where the diagram will later stand.
- Bottom-left readout: `tap  r = 3.20`.
- L0 r = 2.9 (even). L1 r → 2.95 a touch faster. L2 → 3.2 (two rows). L3 → 3.5 (four), then on
  "Then eight" 3.56, "Then sixteen" 3.567. L4 → 3.72 (no rhythm). L5: pinned note near the strip,
  the rule itself: `next = r × x × (1 − x)`.
- L6 "Now lay every rhythm side by side": the dust morphs into the whole diagram (see
  LogisticSource below), revealed left to right over about 7 s with `sound.sfx('rise')`;
  camera pulls back and pans with the reveal. The drops stop; the water stays.
- L7 "One line. Two. Four. Then a cloud.": the camera's attention travels along it.
- L8: ease toward the period-3 window (`PERIOD3_WINDOW` in `fractal/logistic/math.ts`), note
  pinned there: "the rhythm comes back".

**LogisticSource** (build it in `src/scenes/kit/LogisticSource.ts`, shared with feigenbaum and
shadow): a GPU DustSource. Each particle owns a fixed `u` in 0..1 (from its texel x plus a
sub-texel jitter from its y, so columns are not visible) mapped to `r = rMin + u (rMax − rMin)`,
and iterates `x ← r x (1 − x)` several times a frame (8-16; it must reconverge quickly when the
range changes). Position = `(u, x, tiny z jitter)` in a unit square that the source's matrix
places in the world. Uniforms: the r range (so a zoom is a change of range, with endless
detail), a reveal position 0..1 (particles beyond it wait on the reveal edge, making a bright
scanning line), and an x range for vertical zoom. Aux = x. No prevTexture (round points; they
jump every frame, and at 60 Hz the eye reads the density, which is the point). Keep one
instance for the film (`WeakMap<Engine, ...>` as in `kit/shared.ts`).

Lab: slider r (2.8 to 4), toggle between the drops and the diagram.

### feigenbaum — "The same number, everywhere" (8 lines)

Subject: the forks arrive at a fixed ratio.

- Continues the diagram (same LogisticSource; if entered cold, morph to it fully revealed).
- L0 small ring labels on the first four forks with their r values (`PERIOD_DOUBLINGS`): 3,
  3.449, 3.544, 3.564.
- L1-L2: the zoom that proves it. Three times in a row, change the source's ranges so the view
  closes on the next fork by the same factors each time: horizontally by 4.669 and vertically
  by 2.503 (Feigenbaum's second constant; `cascadeFrame(k)` gives the frames). Each zoom takes
  the same time and ends on a picture that looks like the one before it. That sameness is the
  whole point; do not decorate it. On L2 show `4.669` as a `big` figure for 4 s.
- L3 pinned note bottom-left as a plate: "Mitchell Feigenbaum", "Los Alamos, 1975".
- L4-L5: ease back out to the whole diagram. As the narrator lists them, three plates replace
  one another bottom-left: "a dripping tap", "an electronic circuit", "liquid helium".
- L7: `big` figure `4.669201…` for the last line, then it leaves.

Lab: choice "zoom to fork 1/2/3/4, whole diagram", readout of the three measured gap ratios
(4.751, 4.656, 4.668 from the old `FeigenbaumTable`).

### shadow — "The shadow of the Mandelbrot set" (9 lines)

Subject: the diagram is the Mandelbrot set seen edge on.

- Prop: the Mandelbrot set lying flat on the floor as a luminous relief, not a picture in a
  rectangle. Reuse `FractalSurface` (`src/fractal/mandel`) for the iteration (it supports
  perturbation deep zoom), but write a new display shader: interior a black mirror; exterior
  coloured from the smooth escape count along the act ramp (bone near the boundary falling to
  the cold end and then to nothing), with the plane's alpha falling to zero well inside its
  edges so no rectangle is ever visible. The boundary should glow (values > 1).
- L0-L2: the set fades up on the floor, camera high and three-quarter. L1 note pinned near it:
  `z → z² + c`.
- L3 "stand the last diagram up": the dust (LogisticSource, full range) morphs to stand
  vertically on the set's real axis. `rToC`, `cToX`, `xToZ` in `fractal/logistic/math.ts` give
  the mapping: fork positions must sit exactly over the bulbs. Camera comes down to see both.
- L4-L5: three ring labels on the set as named: "one rhythm" (the cardioid), "two" (the disc),
  "four" (the next bud).
- L6: hold on the alignment, slow orbit.
- L7: fly along the axis to the period-3 window (c ≈ −1.75); the diagram thins out and the
  camera goes down toward the plane as the surface zooms (`MANDEL_TARGETS.period3`, then
  `period3deep` on L8; `flightPath` and `flightEase` give a good zoom curve). The mini-set must
  be centred and sharp by the end of L7, the smaller one by the end of L8. The outro holds it.

Lab: choice of targets (whole set, the copy on the axis, seahorse valley, elephant valley),
wheel/pinch zoom on the plane if it comes cheaply, readout magnification.

### julia — "A fractal in every point" (7 lines)

Subject: every point c of the Mandelbrot set has its own Julia set.

- Two luminous planes side by side, same shading language as shadow: the Mandelbrot set left,
  the Julia set of the current c right (`JuliaPlane` logic; iteration uniform `uC`). On a phone,
  stack them. A ring label marks c on the left plane; bottom-left readout `c = −0.123 + 0.745i`.
- L1: c glides to the rabbit (−0.123, 0.745). L2: stays inside (the Julia set is whole).
  L3 "Step over the edge": c crosses the boundary to (0.36, 0.62): the Julia set shatters.
  L4: along the border, one target per word: spirals (−0.7269, 0.1889), lightning (0, 1),
  seahorses (−0.745, 0.113).
- L5: plate "Gaston Julia", "Paris, 1918".
- Outro (5 s) and lab: the visitor drags c on the left plane (`ctx.onPointer`, ray against the
  plane, `e.claim()`); a note pinned by the ring says "drag me" until they do.

---

## Act III

### roll — "Roll the dice" (9 lines)

Subject: random moves, a definite shape.

- `IfsSim` (`src/fractal/ifs`) wrapped as a DustSource: it keeps current and previous roll and
  the old shader blended them by a phase; do that blend in a small resolve pass so the dust
  gets one texture (plus last frame's for streaks). Driving logic is in `ChaosGame.tsx`.
- L0: three corner rings (labels) and one bright dot. L1-L2: only that dot plays: it hops
  halfway to a corner each roll (about one roll a second), leaving a faint mark at each landing;
  the chosen corner's ring pulses and a soft `sound.note` ticks. Twelve or so hops.
- L3 "So keep rolling": the whole dust scatters over the plane (bake + morph) and plays the
  game together, rate rising 1 → 4 → 24 a second; the triangle condenses out of noise.
- L4: plate "Sierpiński's triangle", "1915". Camera pushes slowly into a corner to show the
  triangles inside triangles.
- L5 "change the moves": preset → fern (`presetUniforms`), rate back to 1.5 for two rolls, then
  24. L6: plate "Barnsley's fern", "1988".
- L7-L8: slow rise along the fern; on L8 the "species" variation glides (0 → 0.8 → −0.6).

Lab: presets (triangle, fern, dragon, maple leaf, spiral), species slider, rolls per second,
"scatter again".

### coast — "How long is the coast of Britain?" (10 lines)

Subject: length depends on the ruler; dimension is the fix.

- `loadBritain()` (`src/fractal/coast/britain.ts`) gives the coast in km. The coast is drawn in
  dust (PointsSource, points spread evenly along the line with a little jitter, a few percent
  scattered just offshore as surf), lying flat on a dark sea, seen from the south at about 50°.
- L1-L3: the ruler walks. For each ruler (200, 100, 50 km: `walkInfo`, precomputed walks) a
  bright chord line steps round the coast (a `Line2` with the house line material, one chord
  per ~0.12 s, a quiet tick per chord). Bottom-left readout while walking: `200 km × 11 = 2,200 km`
  (use the real counts and totals from the data). The three totals stay listed in a plate.
- L4: chart bottom-right: total length against ruler, three points and the line through them.
- L5: `big` "≈ 1.25" for 4 s (this data measures 1.3: say that in the notes, not on screen).
- L6 "The butterfly can be measured the same way": the dust morphs to the Lorenz butterfly
  (`lorenzFlow`, `resetLorenz`, `silk`), floor on. Boxes: `boxLattice(edge)` gives the occupied
  cells; draw them as thin additive wire cubes (instanced) that light up in a sweep. L7: halve
  the edge twice (0.125 → 0.0625 → 0.03125). Readout: `boxes 1,204` and the edge.
- L8: `big` "2.06". L9: boxes fade, butterfly alone.

Lab: ruler choice (six lengths), box size, readouts.

### bulb — "A fractal with a body" (9 lines)

Subject: the Mandelbulb.

- Prop: `BulbRenderer` (`src/fractal/bulb`). Its lighting is in `shaders.ts`; restyle it for
  this film: surface colour along the act ramp driven by the orbit trap / iteration it already
  computes, ambient occlusion kept, one key light upper left, a rim light in the ramp's hot
  end, and an emissive lift in the deep creases so they glow rather than go black. No flat
  purple. Dust: `motes` haze round it; floor on with the bulb's reflection if cheap (a second
  render mirrored is fine), else floor off.
- L0-L2: power 2 (a smooth lump), slow orbit. L3 "Raise the power": 2 → 8 over about 5 s
  (`approachPower`). L4: plate "Mandelbulb", "White and Nylander, 2009".
- L5-L6: orbit, a slow push in. L7 "Go closer": dive to a bud (`FLESH_LAYOUT.bulbDivePose` in
  `src/scene/layouts.ts` is a known good target; convert to `rig.shot`). L8: closer still.
- It must hold 60 fps: keep the adaptive-resolution governor.

Lab: power slider (2 to 12), "take the camera" is automatic (drag anytime).

### cat — "Arnold's cat" (9 lines)

Subject: mixing loses nothing.

- The picture is made of dust: one particle per pixel of the 256×256 photo (on 512² dust, four
  per pixel; on 256², one), `paint` = the photo's colours (linear, lifted a little so it glows),
  `paintMix: 1`, `streak: 0`. `loadCatPixels()` is in `src/fractal/cat/sources.ts` (it reads the
  old store in places: copy out what you need). The map is in `catMap.ts`.
- A step is shown as what it is: each particle slides along the shear (x += y), wraps, slides
  along the second shear (y += x), wraps. For the first two steps animate the slide over about
  1.5 s each so the stretch and the fold-back are seen. After that step faster (the particles
  just jump; with dust that reads as scrambling).
- L0: the cat, whole. One step on "Stretch it, shear it". L1: one more. L2: steps to 12, about
  three a second. L3-L4: keep going at exactly the rate that lands step 192 (`CAT_PERIOD`) on
  "there she is" (L5): `rate = stepsLeft / ctx.until(5, 'there she is')`.
- L5: she is back; stop. Bottom-left readout throughout: `step 37 of 192`.
- L6-L8: hold, slow push in.

Lab: steps per second, "start again", "use my face" (camera capture, as the old
`captureCamera`; the picture never leaves the page: say so in the notes).

---

## Act IV

### pendulums — "A hundred pendulums" (9 lines)

- `src/world/pendulum/stage.ts` is already plain three.js (`createRig`, `createSim`, `advance`).
  Recolour from the palette (rods cold end, bobs and trails hot end), floor on, haze dust.
- L0: one single pendulum swinging gently (a plain one: only the first arm visible, or the
  ensemble held with count 1), dead regular. L1: the second arm appears on it.
- L2 "let go together": 100 copies released (`pendulumNudge(1e-6, 100)` as in the old chapter),
  timed so the fan opens on L5: it opens 9.4 s after release, so release at
  `ctx.until(5) − 9.4` (use a cue with a negative offset).
- L5 "Then the fan opens": camera moves to three-quarter. Readout bottom-left: `released 12.3 s`.
- L6-L8: full bloom of trails; pull back.
- Sound: a soft tick per swing of the leading pendulum while they agree.

Lab: copies (10/100/200), difference between neighbours (1e-3°, 1e-6°, 1e-9°), "let go",
"line them up again".

### forecast — "Why forecasts come in bulk" (9 lines)

- Lorenz-96 ensemble (`src/world/forecast`): 40 stations round a ring, 50 members as crown
  lines (`writeForecastCrowns`). House line material, members in the ramp's middle, their mean
  hot, the truth run white-hot.
- L0-L2: the ring and one line (the truth run) breathing. L3: fifty copies appear on it.
- L4 "Day one": running; they agree. L5 "Day three": they fray. L6 "By day ten": pace the model
  so the days land on the words (`ctx.until`), as the old chapter did.
- Bottom-left readout `day 3.2`. Chart bottom-right: spread against day, with a dashed line at
  the spread of the weather itself.
- L8 "a wall": camera rises to look down on the ring; a pinned note on the chart at day 14:
  "two weeks".

Lab: members, days per second, "start a new forecast".

### voice — "Your voice is an attractor" (8 lines)

- Dust-native: `VoiceCurve` (`src/world/voice`) gives up to 6000 points of the delay embedding
  each frame. Feed them to a `PointsSource(size, true)` (`fill` with a little jitter, aux =
  brightness), `tone: 'aux'`, a short streak. The input is the narrator: an `AnalyserNode` on
  `sound.voiceTap` (`sound.context` is the AudioContext; both exist once sound is unlocked).
- L0-L1: start with the raw wave as a flat scrolling trace (the same points laid out as
  amplitude against time). L2 "plot that wave against itself": the trace folds up into three
  dimensions: blend each point from (t, x(t), 0) to (x(t), x(t−τ), x(t−2τ)) over about 4 s.
- L4: it loops on vowels and tangles on consonants as he speaks: let it be seen, slow orbit.
- L7 "Lend it yours": after the last word a button-like prompt is wrong here (no gate in the
  script). Instead pin a note under the shape, "press V, or open the lab, to use your
  microphone", and bind V. With the mic on, the shape follows the visitor. Nothing is recorded
  or sent: say so in the notes.

Lab: source (the narrator, my microphone, a steady tone), delay slider, readouts level/pitch.

### hyperion — "The moon that tumbles" (9 lines)

- Dynamics in `src/world/hyperion` (`createPair`, `TumbleSim`, `orbitPosition`, `buildMoonShape`).
- Saturn is a prop and must look like Saturn photographed: soft banded butterscotch, a soft
  terminator with a thin warm rim, the ring's shadow across the globe and the globe's shadow
  across the rings. The old shaders are a start; improve them.
- The rings are dust: a PointsSource of ring particles on Kepler orbits (density following the
  real ring profile: C ring faint, B ring dense, Cassini division, A ring, Encke gap), slowly
  turning, `tone: 'aux'` for brightness. This is the scene's signature image.
- Hyperion: the mesh from `buildMoonShape`, with a sponge-like cratered surface (noise in the
  normal or vertex shade), lit by the same sun as Saturn, casting no shadow.
- L0: wide, Saturn and rings, the small moon a point on its orbit. L1: ride alongside the moon
  (`rig.track` on its position, distance small enough that it is a body, Saturn behind).
- L2-L3: watch it tumble (orbits pass at about 0.25 a second).
- L4: a second Hyperion appears beside it, a ghost in the ramp's cold end, 0.1° apart.
- L5 "Give them a few months": speed up; readout bottom-left `day 86   apart by 34°`.
- L6-L8: slow down, pull back to Saturn.

Lab: orbits per second, show the copy, camera (Saturn / ride with the moon), "start over".

### hold — "Chaos, put to work" (9 lines)

- L0-L2 the taffy puller. `TaffySim` (`src/world/taffy`) keeps 512² particle positions in a
  float texture: that is a DustSource almost as it stands (xy in the domain, colour id in z).
  Paint by colour id with two inks (cold and hot ends of the ramp) so the stretch and fold are
  seen; the three rods as small bright discs (labels or meshes) moving on `rodKinematics`.
  Readout `pulls 3.2`.
- L3-L4 the wall of lava lamps: a prop (`lava.ts`, `lavaShaders.ts`), fewer and larger lamps
  than before (a 6 × 4 wall), glass with a soft highlight, wax in the ramp's hot colours.
  Bottom-left readout: a running hex string from `lavaKey`.
- L5-L6 "chaos can be steered": the dust morphs to the Lorenz butterfly (`lorenzFlow`), then
  gathers onto a single closed loop and stays on it: a PointsSource of points along an unstable
  periodic orbit, each drifting round it. The shortest one for ρ = 28 starts near
  (−13.7636, −19.5788, 27.0) with period ≈ 1.5587; verify by integrating one period with
  `rk4Step` and checking it closes, and refine with a few Newton or bisection steps if it does
  not. Note pinned by the loop: "one loop of the infinitely many inside it".
- L7: hold on the loop. L8 "easy to steer": let go: morph back to the free flow; the swarm
  spills off the loop over the whole butterfly within a few seconds.

Lab: pulls per second, "fresh taffy", "hold the loop / let go".

---

## Act V

### murmuration — "Ten thousand starlings" (9 lines)

- Boids on the CPU (`src/world/flock/boids.ts`: `createFlock`, `stepFlock`). Dust-native: a
  `PointsSource(size, true)`; each particle follows boid `i mod n` with a small fixed offset
  along and across the bird's heading (so every bird is a short dark-tipped dash, a few dozen
  particles), streak along the motion. `tone: 'aux'`, birds toward the hot end against a dusk
  sky. No floor; raise `engine.backdrop.level` a little so the sky reads as evening.
- L0: the last scene's dust becomes the flock. L1-L3: it turns and folds.
- L2: three plates in turn as the rules are named: "don't crowd", "fly their way", "stay close".
- L4 "It splits around a hawk": the hawk comes through (`hawk` in the flock state): a single
  bright point with a longer streak; camera follows the gap closing.
- L5-L8: wide; slow orbit. Readout bottom-left: `flying together 96%`.

Lab: each rule on/off, send in a hawk, birds (2,000 / 10,000 / 20,000), "scatter them".

### turing — "The leopard's spots" (9 lines)

- Prop: `TuringSim` (`src/world/turing`, reaction-diffusion on a sphere) with a new coat
  shader: pattern mapped to the act ramp (substance hot, bare skin cold), a soft sheen, one key
  light, rim in the hot end; `toneMapped: false`. Dust: `motes` haze, floor on with a soft
  reflection if cheap.
- L0-L2: the sphere bare, slowly turning. L3-L4 "the pattern invents itself": it grows out of
  noise into a labyrinth (start the sim on L3; speed so it is formed by the end of L4).
- L5: glide the dials to stripes (`glideDials`, `TURING_PRESETS`). L6: on to mitosis (cells
  dividing), then spots by the end of the line.
- Readout bottom-left: `feed 0.037   kill 0.060`.
- L7-L8: hold; slow push.

Lab: presets, feed and kill sliders, "start from bare skin", freeze.

### lenia — "Creatures nobody drew" (8 lines)

- Prop: `LeniaSim` (`src/world/lenia`). Not a framed square: the field lies on the floor like
  a pond seen at a low angle, its edge dissolving (alpha falls off toward the border and the
  wrap-around is hidden), creatures glowing in the ramp's hot end with a soft halo
  (`haloTexture`), water dark. Dust: haze above it.
- L0-L1: start as a hard-edged grid of live and dead squares (a few seconds of Conway's Life
  is ideal if cheap; otherwise the Lenia field shown coarsely pixelated), then on L2 it turns
  smooth.
- L3 "And these turned up": orbium gliders swimming. Camera low, following one (track its
  centre of mass from `sampleStats`, if available, else a slow pan).
- L4: plate "Orbium", "Lenia, 2019". L6: cut through two more species (`LENIA_SPECIES`).
- L7: back to orbium, wide.

Lab: species, generations per second, "hatch them again".

### fireflies — "Falling into step" (8 lines)

- Kuramoto oscillators on a tree (`src/world/fireflies`: `createStage`, `advanceStage`,
  `buildTree`). All dust: branch points (dim, `aux` low) and fireflies (each a small cluster
  whose `aux` is its flash), `tone: 'aux'`, `twinkle: 0`. Floor on: the tree stands on dark
  water and the flashes reflect. Night: lower `engine.backdrop.level`.
- L0-L1: coupling 0: scattered flashing. A quiet `sound.note` per flash of a few chosen
  fireflies (not all: at most 6 notes a second), pitches from one chord.
- L3 "Turn that nudge up, slowly": coupling ramps past critical (`criticalCoupling()`) over
  L3-L5 so the order parameter crosses 50% on L4 and passes 90% by "one light" (L5).
  The notes fall into unison with the lights.
- Chart bottom-right: "flashing together" against time. Readout: `in step 82%`.
- L6-L7: the whole tree pulsing; slow orbit.

Lab: coupling slider, "scramble their clocks".

### sandpile — "The edge of collapse" (9 lines)

- `src/world/sandpile` (`createSim`, `stepSim`, worker-built piles). Dust-native: one particle
  per cell (four on 512²), position on the grid with height from the cell's grains, `aux` =
  brightness (grains, plus a flash when a cell topples), seen at a low angle so avalanches read
  as light running across a field. A soft `sound.note` per avalanche, pitch falling with size.
- L0-L1: grains dropping one at a time (each a falling spark), nothing happening.
- L2: a big avalanche (drive the pile to one; `loadCriticalPile` gives a pile on the edge).
- L3: chart bottom-right: avalanche sizes, log-log, falling on a line. L4: hold.
- L5: wide, the pile flickering at the edge of collapse.
- L6-L7 "drop every grain on the same spot": the dust re-forms into the single-source pattern
  (`loadSandpileIdentity` / the 100,000-grain pattern), camera rising to look straight down; the
  four grain counts take four tones of the ramp. L8: hold, slow turn.

Lab: grains per second, drop anywhere / on the middle, "fresh pile", the pattern.
