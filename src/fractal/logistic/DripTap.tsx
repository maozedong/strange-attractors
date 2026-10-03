import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useStore } from '../../store'
import { paletteGlsl } from '../../scene/palette'
import { audio } from '../../audio/engine'
import { logistic } from './math'

/**
 * A small dripping tap whose drip rhythm is the logistic map at `fractal.r`: each release
 * advances x → r·x·(1 − x) and waits 0.22 + 0.9·x seconds for the next one. Period 1 drips
 * evenly, period 2 alternates long and short gaps, chaos never repeats.
 *
 * Local frame: the nozzle opening is at the origin, the spout runs back along −X, drops fall
 * along −Y to a pool at y = −1.6. Everything is unlit and additive in the house palette.
 */

const INK = '#efe8dc'

const GRAVITY = 2.5
const POOL_Y = -1.6
const POOL_RADIUS = 0.9
const SPOUT_RADIUS = 0.05
const SPOUT_LENGTH = 0.5
/** the spout's axis runs this far above the nozzle opening */
const SPOUT_RISE = 0.12
const DROP_RADIUS = 0.026
/** the glow sprite reaches this many drop radii */
const DROP_HALO = 2.6

const MAX_DROPS = 24
const RIPPLES = 8
const RIPPLE_LIFE = 0.8
/** the hanging drop grows over this last fraction of each interval */
const GROW_FRACTION = 0.4

const BASE_INTERVAL = 0.22
const INTERVAL_PER_X = 0.9

/** time from release to the pool */
const FALL_TIME = Math.sqrt((2 * (-POOL_Y - 2 * DROP_RADIUS)) / GRAVITY)

const noRaycast = () => {}

export interface DripTapProps {
  /** when false no new drops release; those already falling finish. Default true */
  playing?: boolean
  /** 0..1 fade for the whole tap, its drops and the pool (and the drip sound). Default 1 */
  opacity?: number
}

// ---------------------------------------------------------------- the metal

/** Spout, elbow, nozzle and lip, a wall flange and a cross-handle, merged into one mesh. */
function buildTapGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const add = (g: THREE.BufferGeometry) => parts.push(g)
  // horizontal spout, x ∈ [−0.5, 0] at the spout height
  add(
    new THREE.CylinderGeometry(SPOUT_RADIUS, SPOUT_RADIUS, SPOUT_LENGTH, 32, 1, true)
      .rotateZ(Math.PI / 2)
      .translate(-SPOUT_LENGTH / 2, SPOUT_RISE, 0),
  )
  // rounded elbow where the spout turns down
  add(new THREE.SphereGeometry(SPOUT_RADIUS, 32, 16).translate(0, SPOUT_RISE, 0))
  // the nozzle, open at the bottom (the origin)
  add(
    new THREE.CylinderGeometry(SPOUT_RADIUS * 0.92, SPOUT_RADIUS * 0.88, SPOUT_RISE, 32, 1, true).translate(
      0,
      SPOUT_RISE / 2,
      0,
    ),
  )
  add(new THREE.TorusGeometry(SPOUT_RADIUS * 0.88, 0.007, 10, 40).rotateX(Math.PI / 2))
  // flange where the spout meets the wall
  add(
    new THREE.CylinderGeometry(0.085, 0.085, 0.035, 36)
      .rotateZ(Math.PI / 2)
      .translate(-SPOUT_LENGTH, SPOUT_RISE, 0),
  )
  // valve: bonnet, stem and a cross-handle
  const vx = -0.34
  add(new THREE.CylinderGeometry(0.042, 0.05, 0.06, 28).translate(vx, SPOUT_RISE + SPOUT_RADIUS + 0.02, 0))
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.09, 12).translate(vx, SPOUT_RISE + SPOUT_RADIUS + 0.09, 0))
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 12).rotateX(Math.PI / 2).translate(vx, SPOUT_RISE + SPOUT_RADIUS + 0.135, 0))
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 12).rotateZ(Math.PI / 2).translate(vx, SPOUT_RISE + SPOUT_RADIUS + 0.135, 0))
  add(new THREE.SphereGeometry(0.026, 20, 12).translate(vx, SPOUT_RISE + SPOUT_RADIUS + 0.135, 0))

  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('[DripTap] could not merge tap geometry')
  return merged
}

/**
 * Unlit "x-ray" metal: faint faces, bright silhouettes (a fresnel rim), and a soft fake
 * highlight from above so the tube reads as round. Drawn after a depth-only pass of the same
 * mesh with depthFunc LessEqual, so only the nearest surface adds light and overlapping
 * parts (elbow inside spout) don't double up.
 */
const metalVert = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

const metalFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float facing = abs(dot(n, v));
  float rim = pow(1.0 - facing, 2.2);
  vec3 l = normalize(vec3(-0.35, 0.85, 0.4));
  float sheen = pow(max(dot(reflect(-v, n), l), 0.0), 18.0);
  float a = 0.022 + 0.62 * rim + 0.22 * sheen;
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}
`

// ---------------------------------------------------------------- drops

const dropVert = /* glsl */ `
attribute float aSize;
attribute float aStretch;
uniform float uViewportH;
uniform float uDpr;
varying float vStretch;
varying float vOn;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // world-sized sprite (follows the group's scale), tall side along the fall
  float worldScale = length(modelViewMatrix[0].xyz);
  float px = aSize * aStretch * worldScale * projectionMatrix[1][1] * 0.5 * uViewportH / max(gl_Position.w, 1e-6);
  vOn = step(1e-5, aSize);
  gl_PointSize = vOn * max(px, 2.0) * uDpr;
  vStretch = aStretch;
}
`

const dropFrag = /* glsl */ `
uniform float uOpacity;
varying float vStretch;
varying float vOn;
${paletteGlsl}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.x *= vStretch;
  float d2 = dot(p, p);
  if (d2 > 1.0 || vOn < 0.5) discard;
  // a small bright core (the drop itself) inside a faint halo
  float core = 1.0 - smoothstep(0.06, 0.14, d2);
  float glow = exp(-7.0 * d2) * (1.0 - d2);
  vec3 col = speedColor(0.85) * glow * 0.45 + vec3(1.0, 0.97, 0.92) * core * 0.8;
  gl_FragColor = vec4(col * uOpacity, 1.0);
}
`

// ---------------------------------------------------------------- pool and ripples

const poolVert = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const poolFrag = /* glsl */ `
uniform vec3 uInk;
uniform float uOpacity;
uniform vec2 uRipples[${RIPPLES}];
varying vec2 vP;
${paletteGlsl}

const float LIFE = ${RIPPLE_LIFE.toFixed(2)};
const float RADIUS = ${POOL_RADIUS.toFixed(2)};

float ring(float d, float radius, float width) {
  float t = (d - radius) / width;
  return exp(-t * t);
}

void main() {
  float d = length(vP);
  if (d > RADIUS + 0.04) discard;
  vec3 glowColor = speedColor(0.85);
  // the pool's rim and a whisper of surface
  // (linear values: 0.004 already reads as a faint wash once encoded to sRGB)
  vec3 col = uInk * (0.14 * ring(d, RADIUS, 0.006) + 0.004 * (1.0 - smoothstep(RADIUS - 0.03, RADIUS, d)));
  float inside = 1.0 - smoothstep(RADIUS - 0.08, RADIUS - 0.01, d);
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec2 rp = uRipples[i];
    if (rp.x < 0.0 || rp.x > LIFE) continue;
    float t = rp.x / LIFE;
    float fade = (1.0 - t) * (1.0 - t);
    float rad = 0.03 + 0.78 * (1.0 - pow(1.0 - t, 2.2));
    float w = 0.007 + 0.02 * t;
    float rings = ring(d, rad, w) + 0.45 * ring(d, rad * 0.62, w * 0.8);
    float flash = exp(-d * d / 0.0012) * max(0.0, 1.0 - rp.x / 0.12);
    col += (glowColor * rings * 0.8 * inside + uInk * flash) * fade * rp.y;
  }
  gl_FragColor = vec4(col * uOpacity, 1.0);
}
`

const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const

function createRig() {
  const tapGeometry = buildTapGeometry()
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false })
  const metalMaterial = new THREE.ShaderMaterial({
    name: 'DripTap.metal',
    vertexShader: metalVert,
    fragmentShader: metalFrag,
    uniforms: { uColor: { value: new THREE.Color(INK) }, uOpacity: { value: 1 } },
    ...additive,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
  })

  // drop sprites: vertex 0 hangs at the nozzle, 1..MAX_DROPS fall
  const n = MAX_DROPS + 1
  const dropPositions = new Float32Array(n * 3)
  const dropSizes = new Float32Array(n)
  const dropStretch = new Float32Array(n).fill(1)
  const dropGeometry = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(dropPositions, 3).setUsage(THREE.DynamicDrawUsage)
  const sizeAttr = new THREE.BufferAttribute(dropSizes, 1).setUsage(THREE.DynamicDrawUsage)
  const stretchAttr = new THREE.BufferAttribute(dropStretch, 1).setUsage(THREE.DynamicDrawUsage)
  dropGeometry.setAttribute('position', posAttr)
  dropGeometry.setAttribute('aSize', sizeAttr)
  dropGeometry.setAttribute('aStretch', stretchAttr)
  const dropMaterial = new THREE.ShaderMaterial({
    name: 'DripTap.drops',
    vertexShader: dropVert,
    fragmentShader: dropFrag,
    uniforms: { uViewportH: { value: 1 }, uDpr: { value: 1 }, uOpacity: { value: 1 } },
    ...additive,
    depthTest: true,
  })

  const poolGeometry = new THREE.PlaneGeometry(2 * POOL_RADIUS + 0.1, 2 * POOL_RADIUS + 0.1)
  const ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector2(-1, 0))
  const poolMaterial = new THREE.ShaderMaterial({
    name: 'DripTap.pool',
    vertexShader: poolVert,
    fragmentShader: poolFrag,
    uniforms: { uInk: { value: new THREE.Color(INK) }, uOpacity: { value: 1 }, uRipples: { value: ripples } },
    ...additive,
    depthTest: true,
    side: THREE.DoubleSide,
  })

  return {
    tapGeometry,
    depthMaterial,
    metalMaterial,
    dropGeometry,
    dropMaterial,
    dropPositions,
    dropSizes,
    dropStretch,
    posAttr,
    sizeAttr,
    stretchAttr,
    poolGeometry,
    poolMaterial,
    ripples,
    dispose() {
      tapGeometry.dispose()
      depthMaterial.dispose()
      metalMaterial.dispose()
      dropGeometry.dispose()
      dropMaterial.dispose()
      poolGeometry.dispose()
      poolMaterial.dispose()
    },
  }
}

/** Simulation state, all preallocated: the map, the release clock, falling drops, ripples. */
function createSim() {
  return {
    x: 0.5,
    interval: BASE_INTERVAL + INTERVAL_PER_X * 0.5,
    /** seconds since the last release (frozen while not playing) */
    phase: 0,
    /** 0..1 presence of the hanging drop (fades out while not playing) */
    hang: 1,
    active: new Uint8Array(MAX_DROPS),
    /** seconds since each falling drop was released */
    age: new Float32Array(MAX_DROPS),
    /** the map value at each drop's release, for the sound */
    dropX: new Float32Array(MAX_DROPS),
    /** seconds since each ripple's impact; < 0 is a free slot */
    rippleAge: new Float32Array(RIPPLES).fill(-1),
    rippleAmp: new Float32Array(RIPPLES),
    prefetched: false,
  }
}

export function DripTap({ playing = true, opacity = 1 }: DripTapProps) {
  // latest props for the frame loop, which must not restart when they change
  const live = useRef({ playing, opacity })
  live.current.playing = playing
  live.current.opacity = opacity
  const group = useRef<THREE.Group>(null)
  const rig = useMemo(createRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  const [sim] = useState(createSim)

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const dt = Math.min(delta, 0.1)
    const { r } = useStore.getState().fractal
    const p = live.current
    const s = sim
    const fade = Math.max(0, Math.min(1, p.opacity))

    if (!s.prefetched && audio.unlocked) {
      audio.prefetch('sfx-drip')
      s.prefetched = true
    }

    // advance falling drops; a drop that reaches the pool becomes a ripple and a sound
    for (let i = 0; i < MAX_DROPS; i++) {
      if (!s.active[i]) continue
      s.age[i] += dt
      if (s.age[i] >= FALL_TIME) {
        s.active[i] = 0
        spawnRipple(s, s.age[i] - FALL_TIME, 0.75 + 0.25 * s.dropX[i])
        if (fade > 0.02) void audio.sfx('drip', (0.5 + 0.5 * s.dropX[i]) * fade)
      }
    }
    for (let i = 0; i < RIPPLES; i++) if (s.rippleAge[i] >= 0) s.rippleAge[i] += dt

    // the release clock: one map step per drop, the next gap set by the new x
    if (p.playing) {
      s.phase += dt
      if (s.phase >= s.interval) {
        const late = Math.min(s.phase - s.interval, dt)
        s.x = logistic(r, s.x)
        if (!(s.x > 0 && s.x < 1)) s.x = 0.5 // r outside [0, 4], or float collapse onto 0 or 1
        releaseDrop(s, late)
        s.interval = BASE_INTERVAL + INTERVAL_PER_X * s.x
        s.phase = late
      }
    }
    s.hang += ((p.playing ? 1 : 0) - s.hang) * (1 - Math.exp(-dt * 6))

    // write sprites: the hanging drop grows over the last part of the interval
    const grow = smoothstep(1 - GROW_FRACTION, 1, s.phase / s.interval) * s.hang
    rig.dropPositions[1] = -DROP_RADIUS * grow * 0.9
    rig.dropSizes[0] = 2 * DROP_HALO * DROP_RADIUS * grow
    rig.dropStretch[0] = 1 + 0.2 * grow
    for (let i = 0; i < MAX_DROPS; i++) {
      const v = i + 1
      if (!s.active[i]) {
        rig.dropSizes[v] = 0
        continue
      }
      const t = s.age[i]
      rig.dropPositions[v * 3 + 1] = -DROP_RADIUS - 0.5 * GRAVITY * t * t
      rig.dropSizes[v] = 2 * DROP_HALO * DROP_RADIUS
      // a little motion blur along the fall
      rig.dropStretch[v] = 1 + 0.35 * GRAVITY * t
    }
    rig.posAttr.needsUpdate = true
    rig.sizeAttr.needsUpdate = true
    rig.stretchAttr.needsUpdate = true

    for (let i = 0; i < RIPPLES; i++) {
      const age = s.rippleAge[i]
      rig.ripples[i].set(age >= 0 && age <= RIPPLE_LIFE ? age : -1, s.rippleAmp[i])
    }

    rig.metalMaterial.uniforms.uOpacity.value = fade
    rig.dropMaterial.uniforms.uOpacity.value = fade
    rig.dropMaterial.uniforms.uViewportH.value = state.size.height
    rig.dropMaterial.uniforms.uDpr.value = state.gl.getPixelRatio()
    rig.poolMaterial.uniforms.uOpacity.value = fade
    g.visible = fade > 0.001
  })

  return (
    <group ref={group}>
      {/* depth-only pass, then the additive metal on the nearest surface */}
      <mesh geometry={rig.tapGeometry} material={rig.depthMaterial} raycast={noRaycast} />
      <mesh geometry={rig.tapGeometry} material={rig.metalMaterial} raycast={noRaycast} renderOrder={1} />
      <points
        geometry={rig.dropGeometry}
        material={rig.dropMaterial}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={2}
      />
      <mesh
        geometry={rig.poolGeometry}
        material={rig.poolMaterial}
        position-y={POOL_Y}
        rotation-x={-Math.PI / 2}
        raycast={noRaycast}
        renderOrder={1}
      />
    </group>
  )
}

type Sim = ReturnType<typeof createSim>

function releaseDrop(s: Sim, age: number) {
  for (let i = 0; i < MAX_DROPS; i++) {
    if (s.active[i]) continue
    s.active[i] = 1
    s.age[i] = age
    s.dropX[i] = s.x
    return
  }
  // all 24 in flight (only possible with a far longer fall than this one): skip the drop, keep the rhythm
}

function spawnRipple(s: Sim, age: number, amplitude: number) {
  let slot = 0
  let oldest = -Infinity
  for (let i = 0; i < RIPPLES; i++) {
    const a = s.rippleAge[i]
    if (a < 0 || a > RIPPLE_LIFE) {
      slot = i
      break
    }
    if (a > oldest) {
      oldest = a
      slot = i
    }
  }
  s.rippleAge[slot] = age
  s.rippleAmp[slot] = amplitude
}

function smoothstep(a: number, b: number, t: number) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}
