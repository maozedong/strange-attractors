/**
 * Ten thousand starlings. Reynolds's boids on the CPU; the dust draws them. Every particle
 * belongs to one bird and holds a fixed place on it (along the body, out along a wing), so each
 * starling is a short dash of a few dozen grains with dark wingtips, its wings beating and
 * banking into its turns. The hawk is a knot of light with a long tail.
 */
import * as THREE from 'three'
import { defaultLook, type DustLook } from '../engine/Dust'
import { at, easeInOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import {
  createFlock,
  HAWK_REACH,
  HAWK_WEIGHT,
  MAX_BOIDS,
  MAX_SPEED,
  MAX_STEER,
  NEIGHBOURS,
  spawnFlock,
  stepFlock,
  type FlockRules,
} from '../world/flock/boids'
import { plate, readout } from './kit/hud'
import { dataTexture, SpreadSource } from './kit/SpreadSource'

/** sim units → world: the flock's ball (radius ~2) fits the unit ball */
const SCALE = 0.5
/** a bird, sim units: nose to tail, wingtip to wingtip */
const BIRD_LENGTH = 0.042
const BIRD_SPAN = 0.04
/** birds' texture is BW × BW */
const BW = Math.ceil(Math.sqrt(MAX_BOIDS))
/** smoothing of the lift that banks the wings, seconds; and the lift a level bird feels */
const BANK_SMOOTHING = 0.15
const BANK_GRAVITY = 1.6
/** the hawk: sim units per second, and how long its tail is (seconds of its path) */
const HAWK_SPEED = 1.9
const TRAIL = 12
const TRAIL_SECONDS = 0.16
/** brightness of one grain, seen whole and seen from among the birds */
const GAIN = 0.2
const GAIN_CLOSE = 0.3

const frag = /* glsl */ `
uniform sampler2D uPos;
uniform sampler2D uDir;
uniform sampler2D uUp;
uniform float uBirds;
uniform float uBW;
uniform float uLen;
uniform float uSpan;
uniform float uFocus;
uniform vec4 uHawk;
uniform vec3 uTrail[${TRAIL}];
uniform float uHawkCount;
/** while one bird is watched, a pool of grains gathers on it and its neighbours */
uniform float uWatch[${NEIGHBOURS + 1}];
uniform float uWatchCount;
uniform float uWatchOn;

vec2 birdUv(float b) {
  return vec2(mod(b, uBW) + 0.5, floor(b / uBW) + 0.5) / uBW;
}

void main() {
  float i = particleIndex();
  float h1 = hashI(i, 1.0);
  float h2 = hashI(i, 2.0);
  float h3 = hashI(i, 4.0);

  if (uHawk.w > 0.0 && i >= uCount - uHawkCount) {
    // the hawk: a tight bright knot, and a tail strung back along its path
    float q = h1 * h1;
    float x = q * float(${TRAIL - 1});
    int k = int(floor(x));
    vec3 a = uTrail[0];
    vec3 b = uTrail[1];
    for (int j = 0; j < ${TRAIL - 1}; j++) {
      if (j == k) { a = uTrail[j]; b = uTrail[j + 1]; }
    }
    vec3 p = mix(a, b, fract(x));
    vec3 jit = vec3(h2 - 0.5, h3 - 0.5, hashI(i, 5.0) - 0.5);
    p += jit * (0.006 + 0.02 * q);
    gl_FragColor = vec4(p, mix(1.0, 0.62, sqrt(q)) * uHawk.w);
    return;
  }

  float bird = mod(i, uBirds);
  float pool = i - (uCount - uHawkCount - uWatchCount);
  if (uWatchOn > 0.0 && pool >= 0.0 && pool < uWatchCount) {
    float slot = mod(pool, ${NEIGHBOURS + 1}.0);
    for (int j = 0; j <= ${NEIGHBOURS}; j++) {
      if (float(j) == slot) bird = uWatch[j];
    }
  }
  vec2 uv = birdUv(bird);
  vec4 P = texture2D(uPos, uv);
  vec4 D = texture2D(uDir, uv);
  vec3 N = texture2D(uUp, uv).xyz;
  vec3 f = D.xyz;
  vec3 r = normalize(cross(f, N) + 1e-6);
  vec3 p;
  float aux;
  if (h1 < 0.34) {
    // body, nose (h2 = 0) to tail
    p = f * (uLen * (0.42 - h2)) + (h3 - 0.5) * 0.12 * uSpan * r;
    aux = 0.95 - 0.2 * h2;
  } else {
    // a wing, root (s = 0) to tip, swept back, beating
    float s = h2;
    float side = h3 < 0.5 ? -1.0 : 1.0;
    float semi = 0.5 * uSpan * s;
    float beat = sin(P.w + uTime * 13.0 * (0.85 + 0.3 * fract(P.w)));
    float chord = (hashI(i, 6.0) - 0.5) * uLen * 0.28 * (1.0 - 0.7 * s);
    p = r * (side * semi) - f * (uLen * (0.02 + 0.2 * s) + chord) + N * (beat * 0.55 * semi);
    aux = 0.92 - 0.5 * s * s;
  }
  // the bird being watched and its twelve neighbours: larger, and white-hot
  p *= 1.0 + 1.1 * D.w;
  aux *= 1.0 - 0.3 * uFocus;
  aux = mix(aux, 1.0, D.w);
  gl_FragColor = vec4(P.xyz + p, aux);
}
`

const RULES: { value: FlockRules; label: string }[] = [
  { value: 'all', label: 'All three' },
  { value: 'noSeparation', label: "Without 'don't crowd'" },
  { value: 'noAlignment', label: "Without 'fly their way'" },
  { value: 'noCohesion', label: "Without 'stay close'" },
]

const murmuration: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, renderer } = ctx
  const flock = createFlock(MAX_BOIDS, 0x5eed1e)
  let birds = 10000
  let rules: FlockRules = 'all'

  const posData = new Float32Array(BW * BW * 4)
  const dirData = new Float32Array(BW * BW * 4)
  const upData = new Float32Array(BW * BW * 4)
  const posTex = dataTexture(BW, BW, posData)
  const dirTex = dataTexture(BW, BW, dirData)
  const upTex = dataTexture(BW, BW, upData)
  const lift = new Float32Array(MAX_BOIDS * 3)
  const highlight = new Float32Array(MAX_BOIDS)
  const flap = new Float32Array(MAX_BOIDS)
  for (let i = 0; i < MAX_BOIDS; i++) flap[i] = (((i * 2654435761) >>> 0) / 4294967296) * Math.PI * 2

  const trail = Array.from({ length: TRAIL }, () => new THREE.Vector3())
  const hawkCount = Math.round(ctx.size * ctx.size * 0.01)
  const watch = new Array<number>(NEIGHBOURS + 1).fill(0)
  const watchCount = (NEIGHBOURS + 1) * Math.max(8, Math.round((ctx.size * ctx.size) / 2600))
  const src = new SpreadSource(
    renderer,
    ctx.size,
    frag,
    {
      uPos: { value: posTex },
      uDir: { value: dirTex },
      uUp: { value: upTex },
      uBirds: { value: birds },
      uBW: { value: BW },
      uLen: { value: BIRD_LENGTH },
      uSpan: { value: BIRD_SPAN },
      uFocus: { value: 0 },
      uHawk: { value: new THREE.Vector4() },
      uTrail: { value: trail },
      uHawkCount: { value: hawkCount },
      uWatch: { value: watch },
      uWatchCount: { value: watchCount },
      uWatchOn: { value: 0 },
    },
    true,
  )
  src.matrix.makeScale(SCALE, SCALE, SCALE)

  const look = (): DustLook => ({
    ...defaultLook(palette),
    size: 0.0009,
    minPx: 0.5,
    gain: GAIN,
    streak: 0.7,
    tone: 'aux',
    toneBias: 0,
    toneScale: 1,
    twinkle: 0,
  })

  // ---------------------------------------------------------------- the hawk
  const hawk = {
    on: false,
    presence: 0,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    /** it homes on the flock until this close, then holds its line straight through */
    locked: false,
    /** seconds since launch */
    age: 0,
    history: [] as { t: number; p: THREE.Vector3 }[],
    clock: 0,
  }
  const centroid = new THREE.Vector3()
  const toC = new THREE.Vector3()
  /** the bird the hawk is after: one in the thick of the flock */
  let prey = -1

  /** a bird with many others close round it, from a sample */
  const thickest = () => {
    const { n, pos } = flock
    const step = Math.max(1, Math.floor(n / 400))
    let best = 0
    let bestCount = -1
    for (let a = 0; a < n; a += step) {
      let c = 0
      for (let b = 0; b < n; b += step) {
        const dx = pos[a * 3] - pos[b * 3]
        const dy = pos[a * 3 + 1] - pos[b * 3 + 1]
        const dz = pos[a * 3 + 2] - pos[b * 3 + 2]
        if (dx * dx + dy * dy + dz * dz < 0.25) c++
      }
      if (c > bestCount) {
        bestCount = c
        best = a
      }
    }
    return best
  }
  /** a bird in a dense part of the flock's outer layer */
  const outerThick = () => {
    const { n, pos, centroid: c } = flock
    const step = Math.max(1, Math.floor(n / 400))
    let best = 0
    let bestScore = -1
    for (let a = 0; a < n; a += step) {
      const r = Math.hypot(pos[a * 3] - c[0], pos[a * 3 + 1] - c[1], pos[a * 3 + 2] - c[2])
      let cnt = 0
      for (let b = 0; b < n; b += step) {
        const dx = pos[a * 3] - pos[b * 3]
        const dy = pos[a * 3 + 1] - pos[b * 3 + 1]
        const dz = pos[a * 3 + 2] - pos[b * 3 + 2]
        if (dx * dx + dy * dy + dz * dz < 0.25) cnt++
      }
      const score = cnt * Math.min(1, r / 1.2)
      if (score > bestScore && flock.prevCount[a] >= NEIGHBOURS) {
        bestScore = score
        best = a
      }
    }
    return best
  }
  const preyAt = (out: THREE.Vector3) =>
    prey >= 0 && prey < flock.n ? out.set(flock.pos[prey * 3], flock.pos[prey * 3 + 1], flock.pos[prey * 3 + 2]) : out.set(flock.centroid[0], flock.centroid[1], flock.centroid[2])

  /** launch the hawk so it reaches the thick of the flock `seconds` from now, crossing the frame */
  const sendHawk = (seconds = 1.6) => {
    prey = thickest()
    preyAt(centroid)
    // aim where the prey will be
    centroid.x += flock.vel[prey * 3] * seconds
    centroid.y += flock.vel[prey * 3 + 1] * seconds
    centroid.z += flock.vel[prey * 3 + 2] * seconds
    const cam = rig.camera
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const fwd = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate()
    const d = HAWK_SPEED * seconds
    // from the upper left, a little toward the camera, diving through
    const start = centroid.clone().addScaledVector(right, -d * 0.92).addScaledVector(new THREE.Vector3(0, 1, 0), d * 0.3).addScaledVector(fwd, -d * 0.1)
    hawk.pos.copy(start)
    hawk.vel.copy(centroid).sub(start).normalize().multiplyScalar(HAWK_SPEED)
    hawk.on = true
    hawk.presence = 1
    hawk.locked = false
    hawk.age = 0
    hawk.clock = 0
    hawk.history.length = 0
    for (const p of trail) p.copy(start)
    src.still()
  }

  const stepHawk = (dt: number) => {
    if (!hawk.on) return
    hawk.age += dt
    hawk.clock += dt
    preyAt(centroid)
    toC.copy(centroid).sub(hawk.pos)
    if (!hawk.locked) {
      if (toC.length() < 0.7) hawk.locked = true
      else hawk.vel.lerp(toC.normalize().multiplyScalar(HAWK_SPEED), 1 - Math.exp(-dt * 4)).setLength(HAWK_SPEED)
    }
    hawk.pos.addScaledVector(hawk.vel, dt)
    if (hawk.age > 3.4) hawk.presence = Math.max(0, hawk.presence - dt / 0.8)
    if (hawk.presence <= 0) hawk.on = false
    hawk.history.push({ t: hawk.clock, p: hawk.pos.clone() })
    while (hawk.history.length > 2 && hawk.history[1].t < hawk.clock - TRAIL_SECONDS) hawk.history.shift()
    // the tail: TRAIL points evenly back in time
    let j = hawk.history.length - 1
    for (let k = 0; k < TRAIL; k++) {
      const t = hawk.clock - (k / (TRAIL - 1)) * TRAIL_SECONDS
      while (j > 0 && hawk.history[j].t > t) j--
      trail[k].copy(hawk.history[Math.max(0, j)].p)
    }
    // the birds near it flee at full speed (as the flock's own hawk does)
    const { n, pos, vel } = flock
    const R2 = HAWK_REACH * HAWK_REACH
    const hx = hawk.pos.x
    const hy = hawk.pos.y
    const hz = hawk.pos.z
    const w = HAWK_WEIGHT * hawk.presence
    for (let i = 0; i < n; i++) {
      const i3 = i * 3
      const dx = pos[i3] - hx
      const dy = pos[i3 + 1] - hy
      const dz = pos[i3 + 2] - hz
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= R2) continue
      const d = Math.sqrt(d2)
      const k = d > 1e-6 ? MAX_SPEED / d : 0
      const rx = dx * k - vel[i3]
      const ry = dy * k - vel[i3 + 1]
      const rz = dz * k - vel[i3 + 2]
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz)
      const g = w * (1 - d2 / R2) * (rl > MAX_STEER ? MAX_STEER / rl : 1) * dt
      let vx = vel[i3] + rx * g
      let vy = vel[i3 + 1] + ry * g
      let vz = vel[i3 + 2] + rz * g
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz)
      if (s > MAX_SPEED) {
        vx *= MAX_SPEED / s
        vy *= MAX_SPEED / s
        vz *= MAX_SPEED / s
      }
      vel[i3] = vx
      vel[i3 + 1] = vy
      vel[i3 + 2] = vz
    }
  }

  // ---------------------------------------------------------------- the bird textures
  let generation = -1
  const upload = (dt: number) => {
    const { n, pos, vel, acc } = flock
    const reset = generation !== flock.generation
    generation = flock.generation
    const k = reset ? 1 : 1 - Math.exp(-Math.max(dt, 0) / BANK_SMOOTHING)
    for (let i = 0; i < n; i++) {
      const i3 = i * 3
      const o = i * 4
      const ax = (lift[i3] += (acc[i3] - lift[i3]) * k)
      const ay = (lift[i3 + 1] += (acc[i3 + 1] - lift[i3 + 1]) * k) + BANK_GRAVITY
      const az = (lift[i3 + 2] += (acc[i3 + 2] - lift[i3 + 2]) * k)
      let fx = vel[i3]
      let fy = vel[i3 + 1]
      let fz = vel[i3 + 2]
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1
      fx /= fl
      fy /= fl
      fz /= fl
      // the wing normal: the lift with its part along the flight removed
      const along = ax * fx + ay * fy + az * fz
      let nx = ax - along * fx
      let ny = ay - along * fy
      let nz = az - along * fz
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (nl > 1e-6) {
        nx /= nl
        ny /= nl
        nz /= nl
      } else {
        nx = 0
        ny = 1
        nz = 0
      }
      posData[o] = pos[i3]
      posData[o + 1] = pos[i3 + 1]
      posData[o + 2] = pos[i3 + 2]
      posData[o + 3] = flap[i]
      dirData[o] = fx
      dirData[o + 1] = fy
      dirData[o + 2] = fz
      dirData[o + 3] = highlight[i]
      upData[o] = nx
      upData[o + 1] = ny
      upData[o + 2] = nz
    }
    posTex.needsUpdate = true
    dirTex.needsUpdate = true
    upTex.needsUpdate = true
    src.uniforms.uBirds.value = Math.max(1, n)
    ;(src.uniforms.uHawk.value as THREE.Vector4).set(hawk.pos.x, hawk.pos.y, hawk.pos.z, hawk.on ? hawk.presence : 0)
  }

  // ---------------------------------------------------------------- one bird and its neighbours
  let focal = -1
  const focalWorld = new THREE.Vector3()
  const centreWorld = new THREE.Vector3()
  const smoothCentre = new THREE.Vector3()
  const gapWorld = new THREE.Vector3()
  let centreReady = false

  const markNeighbours = (strength: number) => {
    highlight.fill(0)
    if (focal < 0 || strength <= 0) return
    highlight[focal] = strength
    const m = flock.prevCount[focal]
    watch[0] = focal
    for (let t = 0; t < NEIGHBOURS; t++) {
      const q = t < m ? flock.prevNear[focal * NEIGHBOURS + t] : focal
      watch[t + 1] = q
      highlight[q] = Math.max(highlight[q], 0.8 * strength)
    }
  }
  let focusAmount = 0

  // ---------------------------------------------------------------- words
  let rule: ReturnType<typeof ctx.label> | null = null
  const showRule = (title: string, sub: string) => {
    rule?.remove()
    rule = plate(ctx, title, sub)
  }
  let together: ReturnType<typeof ctx.label> | null = null
  let ring: ReturnType<typeof ctx.label> | null = null
  let alive = true

  const respawn = (n: number) => {
    birds = n
    dust.setSource(dust.bake(), { ...dust.look })
    spawnFlock(flock, n)
    hawk.on = false
    focal = -1
    highlight.fill(0)
    upload(0)
    src.still()
    src.render(engine.time)
    void dust.morphTo(src, look(), { seconds: 1.6, swirl: 0.4 })
  }

  const wide = (seconds: number, orbit = 2.4) => {
    rig.shot({ target: [centreWorld.x, centreWorld.y, centreWorld.z], distance: 3.3, elevation: 7, orbit, aperture: 0.0016, portrait: { distance: 2.6 } }, seconds)
    rig.track((t) => t.copy(smoothCentre))
  }

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0
      engine.backdrop.level = 3
      spawnFlock(flock, birds)
      // a second of flight first, so the dust arrives on birds already finding each other
      for (let k = 0; k < 20; k++) stepFlock(flock, 1 / 30, rules, false)
      upload(0)
      src.render(engine.time)
      void dust.morphTo(src, look(), { seconds: 3.2, swirl: 1.1 })
      centreWorld.set(flock.centroid[0], flock.centroid[1], flock.centroid[2]).multiplyScalar(SCALE)
      smoothCentre.copy(centreWorld)
      centreReady = true
      rig.shot({ target: [centreWorld.x, centreWorld.y, centreWorld.z], distance: 4.2, azimuth: 18, elevation: 5, fov: 38, orbit: 1.2, aperture: 0.0016, portrait: { distance: 3.2 } }, 3.2)
      rig.track((t) => t.copy(smoothCentre))
    },

    cues: [
      at(1, () => {
        rig.shot({ distance: 3.2, orbit: 2.2 }, 5)
        rig.track((t) => t.copy(smoothCentre))
      }),
      // "Each bird follows three rules": in among them, on one bird and the twelve it watches
      at(2, () => {
        focal = outerThick()
        if (focal < 0) return
        // look in at it from outside the flock, so no bird passes in front of the lens
        const dx = flock.pos[focal * 3] - flock.centroid[0]
        const dy = flock.pos[focal * 3 + 1] - flock.centroid[1]
        const dz = flock.pos[focal * 3 + 2] - flock.centroid[2]
        const az = (Math.atan2(dx, dz) * 180) / Math.PI
        const el = Math.max(-25, Math.min(35, (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI))
        rig.shot({ distance: 1.4, azimuth: az, elevation: el, orbit: 0, aperture: 0.0012, portrait: { distance: 1.35 } }, 3.2)
        rig.track((t) => t.copy(focalWorld))
        const g0 = dust.look.gain
        ctx.tween(2.2, (u) => {
          focusAmount = u
          dust.look.gain = g0 + (GAIN_CLOSE - g0) * u
        }, { ease: easeInOut, tag: 'focus' })
        ctx.after(1.6, () => {
          if (!alive || focal < 0) return
          ring = ctx.label('', { kind: 'note', at: () => focalWorld, align: 'center' })
          ring.el.classList.add('label--ring')
          const span = ring.el.firstElementChild
          if (span instanceof HTMLElement) {
            span.style.width = "96px"
            span.style.height = "96px"
          }
        })
      }),
      at(2, "Don't", () => showRule("Don't crowd", 'Keep a little room around you')),
      at(2, 'Fly', () => showRule('Fly their way', "Match your neighbours' heading")),
      at(2, 'Stay', () => showRule('Stay close', 'Drift toward them at the edge')),
      at(3, () => {
        rule?.remove()
        rule = null
        ring?.remove()
        ring = null
        const g0 = dust.look.gain
        ctx.tween(2.5, (u) => {
          focusAmount = 1 - u
          dust.look.gain = g0 + (GAIN - g0) * u
        }, { ease: easeInOut, tag: 'focus' })
        wide(4.5, 1.6)
      }),
      // "It splits around a hawk"
      at(4, 'splits', -1.6, () => sendHawk(2.0)),
      // stay on the wound in the flock while it closes
      at(4, 'splits', -0.4, () => {
        rig.shot({ distance: 2.5, aperture: 0.002 }, 2.6)
        rig.track((t) => t.copy(preyAt(gapWorld).multiplyScalar(SCALE)))
      }),
      at(4, 'heals', 0.6, () => wide(5, 3)),
      at(5, () => {
        together = readout(ctx)
      }),
      at(6, () => rig.shot({ distance: 3.6, elevation: 12, orbit: 3.4 }, 8)),
    ],

    // the flock is already flying; the rules and the hawk are in the drawer
    explore() {},

    update(dt) {
      if (dt > 0) {
        stepFlock(flock, dt, rules, false)
        stepHawk(Math.min(dt, 1 / 30))
      }
      if (focal >= 0 && focal < flock.n) {
        markNeighbours(focusAmount)
        focalWorld.set(flock.pos[focal * 3], flock.pos[focal * 3 + 1], flock.pos[focal * 3 + 2]).multiplyScalar(SCALE)
      } else if (focusAmount <= 0) highlight.fill(0)
      src.uniforms.uFocus.value = focusAmount
      const watching = focal >= 0 && focusAmount > 0.02 ? 1 : 0
      if (watching !== src.uniforms.uWatchOn.value) {
        src.uniforms.uWatchOn.value = watching
        src.still()
      }
      upload(dt)
      src.render(engine.time)

      centreWorld.set(flock.centroid[0], flock.centroid[1], flock.centroid[2]).multiplyScalar(SCALE)
      if (centreReady) smoothCentre.lerp(centreWorld, 1 - Math.exp(-dt * 0.8))
      if (alive) together?.set(`flying together  ${Math.round(flock.alignment * 100)}%`)
    },

    exit() {
      alive = false
      engine.backdrop.level = 1
      ctx.cancel('focus')
    },

    dispose() {
      if (dust.source === src) dust.setSource(dust.bake(), { ...dust.look })
      src.dispose()
      posTex.dispose()
      dirTex.dispose()
      upTex.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Rules',
        options: RULES.map((r) => ({ value: r.value, label: r.label })),
        get: () => rules,
        set: (v) => {
          const r = RULES.find((x) => x.value === v)
          if (r) rules = r.value
        },
      },
      { kind: 'action', label: 'Send in a hawk', run: () => {
        sendHawk(1.6)
        sound.sfx('turn', 0.5)
      } },
      {
        kind: 'choice',
        label: 'Birds',
        options: [
          { value: '2000', label: '2,000' },
          { value: '10000', label: '10,000' },
          { value: '20000', label: '20,000' },
        ],
        get: () => String(birds),
        set: (v) => respawn(Number(v)),
      },
      { kind: 'action', label: 'Scatter them', run: () => respawn(birds) },
      { kind: 'readout', label: 'Flying together', get: () => `${Math.round(flock.alignment * 100)}%` },
    ],
    notes: [
      "Craig Reynolds gave his simulated birds, which he called boids, three rules in 1986: steer away from flockmates that are too close, steer toward their average heading, and steer toward them when they are all to one side. No bird sees more than its twelve nearest neighbours, and none of them knows where the flock is going.",
      'Twelve is not arbitrary. Filming real starlings over Rome in 2008, Ballerini and colleagues found each bird keeps track of six or seven others, whatever the density: a fixed number of neighbours, not a fixed distance. That is why a murmuration holds together when it stretches thin and when it packs tight.',
      'A turn starts with a few birds and runs through the flock as a wave, faster than any single bird flies. Switch a rule off to see what it was doing: without "fly their way" the birds swarm like gnats; without "stay close" the flock frays at its edges and drifts apart.',
    ],
  }
}

export default murmuration
