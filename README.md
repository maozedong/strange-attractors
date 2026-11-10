# Strange Attractors

A sixteen-minute narrated film about chaos, fractals and emergence, rendered live in the
browser. Everything on screen is made of one field of dust, a quarter of a million particles
that flow from Lorenz's butterfly into a bifurcation diagram, a fern, a coastline, Saturn's
rings, a flock of starlings. Every picture is computed as you watch; nothing is video.

Two ways to see it: **Watch** (the narrator drives, and the film waits when it asks you to do
something) and **Explore** (no narration: every scene with its dials and notes in your hands).

```
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # typecheck + production build
pnpm narrate      # record the narration and its word timings   (needs ELEVEN_API_KEY)
pnpm score        # generate the music beds                     (needs ELEVEN_API_KEY)
```

`?scene=<id>` starts at a scene; `?speed=3` runs the film clock silently and faster (for
checking layouts); `?n=256|512|1024` sets the dust's texture size.

## How it is made

- **The dust** (`src/engine/Dust.ts`). Scenes never own particles. A scene hands the dust a
  *source* (a float texture of positions plus a matrix) and a *look*; the dust flies there from
  wherever the last scene left it. The flight is stateless: the vertex shader samples both
  sources and blends, so both ends keep moving in flight and the arrival is exact. Particles
  are camera-facing quads with a thin-lens depth of field and motion smear, drawn additively
  into a half-float buffer, then bloomed, tone-mapped and grained (`src/engine/post.ts`).
- **Sources** (`src/engine/sources.ts`, `src/scenes/kit/`). Strange attractors integrated on
  the GPU with RK4, the chaos game, the bifurcation diagram (every particle iterates the map at
  its own dial position, so a zoom is only a change of range), Julia sets by inverse iteration,
  and CPU-placed points for coastlines, flocks, fireflies, photographs and lettering.
- **The film** (`src/film/`). `screenplay.ts` holds every spoken line. The director
  (`Film.ts`) plays a scene's narration, fires its cues when their words are spoken (timings
  come from forced alignment of the recorded audio, `public/vo/timing.json`), shows captions,
  waits at gates for the visitor and acts for them if they sit back, and moves on.
- **Scenes** (`src/scenes/`). One module per scene. The contract they are written against is
  in [docs/SCENES.md](docs/SCENES.md); the direction for each is in [docs/SHOTS.md](docs/SHOTS.md).
- **The mathematics** (`src/systems`, `src/sim`, `src/fractal`, `src/world`). Thirteen
  attractors defined once in GLSL and once in JavaScript, double pendulums, Lorenz-96, a
  tumbling rigid body, boids, reaction-diffusion on a sphere, Lenia, Kuramoto oscillators, the
  Bak-Tang-Wiesenfeld sandpile. Most have a `verify.ts` runnable with `pnpm tsx`.
- **Sound** (`src/sound/audio.ts`). Narration streamed per segment, one music bed per act
  ducked under the voice, and effects synthesised in the score's own language (breaths of
  filtered air, soft knocks) through a shared reverb.

Needs WebGL 2 with floating-point render targets: any current desktop browser and recent
phones. The build is static; nothing runs on a server.

## Publishing

`BASE_PATH=/strange-attractors/ pnpm build`, then push `dist/` to the `gh-pages` branch
(GitHub Pages serves it from there).

## Credits

Narration and music were generated with ElevenLabs. Coastline data from Natural Earth. The cat
is by Alicja Koczaska (CC0).
