# Writing a scene

Strange Attractors is a sixteen-minute narrated film rendered live in the browser. This is the
contract every scene is written against. Read it, then read two finished scenes end to end
before writing one: `src/scenes/swarm.ts` (dust-native, a gate, lab controls) and
`src/scenes/twins.ts` (CPU paths, pacing to the narration, a small chart).

## The idea

Everything in the film is made of one field of dust: 262,144 particles (65,536 on phones) that
flow from one subject to the next. A scene does not own particles. It gives the dust a
**source** (where each particle should be) and a **look** (how it is drawn), and the dust flies
there from wherever the previous scene left it. Where a subject truly is a solid object (a
planet, a ray-marched fractal) a scene may add a **prop**, an ordinary three.js object, and the
dust becomes atmosphere around it.

The film must feel like one piece of work by one hand. That is the whole reason for the rules
below. Nothing in a scene chooses its own colours, typeface, or motion style.

## Anatomy

```
src/scenes/<id>.ts            default export: SceneFactory   (or src/scenes/<id>/index.ts)
src/film/screenplay.ts        the words. Read-only: propose changes, do not make them
src/film/types.ts             SceneContext, Scene, Cue, at(), LabControl, easings
src/engine/Dust.ts            DustSource, DustLook, morphTo / setSource / bake
src/engine/sources.ts         FlowSource (attractors), PointsSource (CPU), textPoints, Blit, floatTarget
src/engine/palettes.ts        the colour script: PALETTES[act], rampColor(palette, t)
src/engine/CameraRig.ts       rig.shot(...), rig.track(...)
src/engine/Labels.ts          label kinds
src/scenes/kit/               shared.ts (looks, FLOOR, lorenzFlow, motes, veil), hud.ts, Paths.ts, Plot.ts
src/sound/audio.ts            sound.sfx(), sound.note()
```

A scene is a function `(ctx) => Scene`. It is called once when the film reaches the scene and
its `dispose()` is called a few seconds after the film has left it.

```ts
const scene: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  return {
    enter(from) {},        // build the opening picture; `from` = id of the scene being left
    cues: [at(2, () => {})], // things that happen on the narrator's words
    gates: { name() {} },  // what a gate does when the visitor (or its timeout) opens it
    update(dt, t) {},      // every frame; t = seconds since this scene's first word
    exit() {},             // start fading props; the next scene takes the dust
    dispose() {},          // free GPU resources
    lab: [],               // dials for the "Explore this scene" drawer
    notes: [],             // 2-3 paragraphs of depth for the drawer
  }
}
export default scene
```

Things made through `ctx` belong to the scene and need no cleanup: `ctx.tween`, `ctx.after`,
`ctx.label`, `ctx.onPointer`, and objects added to `ctx.root`. Things you `new` yourself
(sources, geometries, materials, render targets, DOM you append) you free in `dispose()`.

### Time

- `at(line, fn)` fires when spoken line `line` starts (0-based, gates not counted; the lines are
  in `screenplay.ts`). `at(line, 'a phrase', fn)` fires when that phrase is spoken.
  `at(line, -2.5, fn)` fires 2.5 s earlier. `at('end', fn)` fires after the last word.
- `ctx.until(line, phrase?)` is the number of seconds until that moment. Use it to pace a
  simulation so an event lands on a word: `rate = remaining / ctx.until(5)`. Timings come from
  forced alignment of the recorded narration (`public/vo/timing.json`), so they are exact.
- `ctx.tween(seconds, u => ..., { ease, tag })` and `ctx.after(seconds, fn)` run on film time:
  they stop when the film is paused. Never use `setTimeout` or `performance.now()` for anything
  the picture depends on. A tween with a `tag` replaces an earlier tween with the same tag.
- `dt` in `update` is 0 while paused. Simulations must stand still when `dt` is 0.
- In the lab (`ctx.lab` is true) the narration and cues are stopped but `update` keeps running
  with real `dt`: the simulation stays alive under the visitor's hands.

### The dust

```ts
interface DustSource {
  texture: THREE.Texture          // size×size float RGBA: xyz position in source space, w = aux
  prevTexture: THREE.Texture|null // last frame's state, for motion streaks; null = round points
  matrix: THREE.Matrix4           // source space → world
  update?(dt, time): void         // advance the simulation
}
```

- `dust.morphTo(source, look, { seconds, swirl })` flies every particle to the new source. Use it
  in `enter()` unless you are continuing the same source as the previous scene
  (`dust.source === mySource`), in which case tween the look instead.
- `dust.setSource(dust.bake(), { ...dust.look })` freezes the current picture into a still
  source. Do this before you re-seed a simulation that is on screen, then `morphTo` the
  re-seeded source: the particles are seen flying to their new places instead of popping.
- `ctx.size` is the texture size (512 on desktop, 256 on phones, sometimes 1024). Never assume.
- `PointsSource(size, motion?)`: write xyz+aux into `src.data` (Float32Array, size²×4), call
  `src.commit()`. `src.fill(points, stride, jitter)` spreads a few thousand points over the
  whole dust. With `motion = true` the previous commit is kept and moving points streak.
- A GPU source owns its own ping-pong float targets (`floatTarget(size)`), like
  `FlowSource`. Save and restore renderer state around your passes (see `Blit`).
- World units: a subject fills roughly the unit ball around the origin, +y up. The floor, when
  on, is at `FLOOR` (−1.05). Set `dust.floorY = FLOOR` (reflection on) or `null` (off) and
  `engine.backdrop.floor = 1 | 0` to match, in `enter()`.

Looks (start from `silk`, `ink`, `haze` in `kit/shared.ts`, then adjust fields):

| field | meaning |
|---|---|
| `size`, `minPx` | particle radius in world units, and its floor in device pixels |
| `gain`, `opacity` | brightness of one particle. Light is additive: a quarter of a million particles in one place need a gain around 1e-3, spread over a shape around 0.5 |
| `streak` | how many frames of motion a particle is smeared along (0 = round) |
| `tone` | where its place on the act's colour ramp comes from: `'speed'` (aux ÷ `speedNorm`), `'aux'` (aux is already 0..1), `'seed'` (a random per-particle value), `'motion'` (world speed ÷ `speedNorm`) |
| `toneBias`, `toneScale` | ramp position = bias + scale × raw tone. The cold end of every ramp is dark, so tone doubles as brightness |
| `paint`, `paintMix` | optional size×size texture of per-particle colour (linear RGB), and how much of it shows |
| `twinkle` | 0..1 shimmer |

### Colour

Every act has one five-stop ramp, cold to hot, and three backdrop tones (`engine.palette`,
also `ctx.palette`). Anything that glows takes its colour from `rampColor(palette, t)`:
lines, props' emission, markers. Multiply by 1.5-2.6 for things that should bloom (the render
target is HDR; values above 1 glow). No hex colours in scenes, with one exception: real-world
subjects with a true colour (Saturn, a photograph) keep it, graded warm.

Props: `toneMapped: false`, colours in linear space, write depth so the dust is hidden behind
them, and expose an opacity you fade in `enter` and out in `exit` (within 3 s). Light them from
one key direction, upper left, toward the camera; no three.js lights unless the old code already
uses them. The frame is tone-mapped (ACES) after two blooms, so mid-greys darken: check on
screen, not in your head.

### Camera

`rig.shot({ target, distance, azimuth, elevation, fov, orbit, aperture }, seconds)` eases to a
framing; unspecified fields keep their value. `orbit` is degrees per second of idle drift.
`aperture` is depth of field (0.002 flat and sharp, 0.006 a hint of depth, 0.02 very shallow).
`rig.track(fn)` keeps the target on something that moves (call it after `shot`, which clears it).
On tall screens the rig pulls back by itself; give a `portrait: { ... }` override when a shot
needs different framing on a phone.

Every scene opens with an eased shot of at least 2 seconds, and moves the camera with intent:
a move per idea, not constant motion. The visitor can drag to orbit at any time; if your scene
uses the pointer (`ctx.onPointer`) call `e.claim()` on the drags you take.

### Words on screen

The narrator carries the story; the caption line shows what is said. Words in the picture are
for figures and names only.

- Captions own the bottom centre. The scene title owns the top left for its first four seconds.
- Live figures go bottom-left: `readout(ctx)` from `kit/hud.ts`. Names go bottom-left as a
  plate: `plate(ctx, title, sub)`.
- A figure the scene is about (`4.669`, `2.06`) may sit centre screen as `kind: 'big'` for up to
  four seconds while the narrator says it.
- Annotations pinned to things in the scene: `ctx.label(text, { kind: 'note', at: vec3, align, dx, dy, leader })`.
  A ring round a point: a label with class `label--ring`.
- One small chart at most, bottom-right: `new Plot(engine.labels.root, 'br', 220, 120, caption)`.
- At most three labels on screen at once. Sentence case. No boxes, no all-caps, no arrows.

### Sound

`sound.note(freq, { gain, seconds, pan })` plays a soft plucked sine through the hall reverb:
use it to make events audible (a drip, a tick, a flash locking into step), quietly (gain ≤ 0.2)
and never more than a few per second. `sound.sfx('release' | 'shimmer' | 'rise' | 'drip' | 'tick' | 'turn' | 'split')`
plays a recorded effect. The score and the mix are handled centrally.

### The lab and the notes

Every scene has `notes`: two or three plain paragraphs that go deeper than the narration (the
old wall text in `src/content/chapters.tsx` / `wing5.tsx` is the starting point; keep it
accurate). And `lab`: the handful of dials worth playing with (the old instruments in
`src/ui/instruments/` show which). Controls call straight into your simulation; make them safe
to use at any moment.

## Old code

`src/fractal/*`, `src/world/*`, `src/sim`, `src/systems` and `src/scene/trajectories` hold the
verified simulation code from the previous version. Files with no React import are yours to
use as they are. The `.tsx` files are the old renderers: read them for the driving logic
(how many steps per frame, when to reset) and port that into your scene; do not import them,
and do not import the zustand store (`src/store.ts`), `@react-three/*` or anything under
`src/ui`, `src/content`, `src/director`, `src/audio`. A few "pure" files read the old store
(`fractal/cat/sources.ts`, `fractal/mandel/tween.ts`): copy what you need out of them.

## Checking your work

Run nothing on port 5199 or 9344 (they belong to the lead). You are given your own Chrome
debugging port and browser session name in your brief.

```sh
# one-off: a GPU-backed headless Chrome of your own (muted)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --mute-audio \
  --use-angle=metal --ignore-gpu-blocklist --enable-gpu --force-device-scale-factor=1 \
  --remote-debugging-port=<PORT> --user-data-dir=/tmp/sa-<NAME> --window-size=1280,800 \
  --autoplay-policy=no-user-gesture-required about:blank &
agent-browser --session <NAME> connect <PORT>

# the shared dev server (hot reload is off: reload the page to pick up edits)
http://localhost:5210/?scene=<id>              # starts the film at your scene, narrated, real time
http://localhost:5210/?scene=<id>&speed=3      # silent, three times faster, for layout checks only

agent-browser --session <NAME> open "http://localhost:5210/?scene=<id>"
agent-browser --session <NAME> set viewport 1280 800
agent-browser --session <NAME> screenshot /tmp/sa-<NAME>/<id>-12s.png     # then Read the png
agent-browser --session <NAME> console                                      # shader and runtime errors
agent-browser --session <NAME> eval "strangeAttractors.film.setLab(true)"   # open the lab drawer
agent-browser --session <NAME> open about:blank                             # ALWAYS when done looking: frees the GPU
```

`window.strangeAttractors` is `{ film, engine, sound, state }`. Screenshots are the only way
to know what the scene looks like: take one for every line of the narration at the moment it is
spoken, look at each, and fix what you see. Check a phone frame too (`set viewport 390 844`).
Always confirm a screenshot is yours (1280×800) before trusting it. `pnpm exec tsc --noEmit`
must be clean for your files (other people's files may be mid-edit; ignore their errors).

A scene is done when, watched at real speed with the narration:

1. every cue lands on its words, and nothing important happens off screen or under the caption;
2. it could be a frame from the same film as `swarm` and `twins`: same light, same colour
   discipline, same restraint with words;
3. entering from the previous scene and leaving to the next both look intended (try both:
   `strangeAttractors.film.goto(index)` from the scene before);
4. the lab controls work and nothing breaks when they are used during a transition;
5. it holds 60 fps at 1280×800 on this machine, and the console is clean;
6. the phone frame is composed, not just smaller.
