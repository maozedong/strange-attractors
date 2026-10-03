# Strange Attractors

An interactive, three-dimensional tour of chaos theory for curious people: Lorenz's
rounding error, twin trajectories splitting, a quarter-million-particle swarm being
stretched and folded, a dial that takes the same equations from stillness to chaos,
and a zoo of thirteen strange attractors.

Live: https://maozedong.github.io/strange-attractors/

```
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build
pnpm measure    # numerically verify every attractor in the catalog
```

## How it works

- **The swarm** (`src/sim/SwarmSim.ts`, `src/scene/Swarm.tsx`) integrates 262,144
  particles on the GPU with fourth-order Runge–Kutta, ping-ponging between two
  floating-point render targets. Each particle is a texel; the vertex shader reads its
  position and the fragment shader draws a soft additive dot. Bloom does the rest.
- **The twins** (`src/scene/Trajectories.tsx`) are integrated on the CPU in double
  precision so a starting gap of one part in a trillion is meaningful, and drawn as
  fat lines with fading tails.
- **The catalog** (`src/systems/`) defines each attractor once in GLSL and once in
  JavaScript. `pnpm measure` checks the two agree, that nothing escapes to infinity,
  and that every system is framed to fit the view.
- **The tour** (`src/content/chapters.tsx`) is the narrative, organised in wings. Each
  chapter applies a preset to the stage, brings its own instrument, and lists cues: actions
  tied to phrases of its narration. The director (`src/director/director.ts`) fires them
  when the voice reaches the phrase, using the word timings in `public/audio/vo-<id>.json`
  (forced alignment, produced by `pnpm audio`). Narration off still plays the pictures on
  the same clock.
- **Wing II** adds two more stages: the logistic map with its dripping tap
  (`src/fractal/logistic/`) and the complex plane (`src/fractal/mandel/`, perturbation-based
  deep zoom to a trillionth of the set's width).
- **Wing III** adds four: the chaos game (`src/fractal/ifs/`, 262k points folding into
  Sierpinski's triangle, Barnsley's fern and friends), the real coastline of Great Britain with
  Richardson's ruler walk and box counting of the Lorenz attractor (`src/fractal/coast/`; the
  data comes from Natural Earth via `pnpm tsx scripts/coastline.ts`), a ray-marched Mandelbulb
  with adaptive resolution (`src/fractal/bulb/`), and Arnold's cat map on a 256-pixel grid,
  which returns the picture exactly after 192 steps (`src/fractal/cat/`; the visitor can use
  their own camera, and the picture never leaves the page).
- **Wing IV** (`src/world/`) leaves the mathematics for the world: a hundred double pendulums
  fanning out, a Lorenz-96 ensemble forecast with its two-week wall, the narrator's (or the
  visitor's) voice unfolded into an attractor by Takens delay embedding, Hyperion tumbling
  chaotically round Saturn, and a taffy puller and a wall of lava lamps for chaos put to work.
- **Wing V** (`src/world/`, loaded as its own chunk) is the mirror image, order from nothing:
  ten thousand boids, Turing's reaction–diffusion on a sphere, Lenia's creatures, Kuramoto
  fireflies falling into step, and the Bak–Tang–Wiesenfeld sandpile with its single-source
  fractal computed in a worker.

Publishing: `BASE_PATH=/strange-attractors/ pnpm build`, then push `dist/` to the `gh-pages`
branch of `maozedong/strange-attractors` (GitHub Pages serves it from there). The build is
static; nothing runs on a server.

Recording: `?film=1` turns the app into a frame-stepped renderer (`window.__film.step`,
scripted camera, in-app captions); `scripts/promo/capture.mjs` renders the promo shot by shot
from a GPU-backed headless Chrome and `scripts/promo/assemble.sh` cuts it with ffmpeg.

Needs WebGL 2 with floating-point render targets (any current desktop browser).
Add `?n=256` or `?n=1024` to the URL to change the particle texture size.
