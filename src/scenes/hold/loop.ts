/**
 * The Lorenz flow with a hand on it. Every particle is integrated with RK4 on the graphics card
 * (σ = 10, ρ = 28, β = 8/3), exactly as the butterfly is. While `hold` is on, each step also
 * nudges the particle toward its own place on one unstable periodic orbit, the shortest one, and
 * that place runs round the loop at the flow's own pace. Let go and nothing holds them: the loop
 * is unstable (a deviation grows about fivefold per lap), so the swarm spills back over the
 * whole butterfly within a few laps.
 *
 * State per texel: xyz in system units, w = the particle's phase on the loop (0..1).
 */
import * as THREE from 'three'
import { getSystem } from '../../systems'
import { rk4Step } from '../../sim/cpu'
import { FragmentSource } from '../kit/FragmentSource'

/** the shortest periodic orbit at ρ = 28: a point where it crosses z = 27, and its period */
export const LOOP_START: [number, number, number] = [-13.7636106821, -19.5787519425, 27]
export const LOOP_PERIOD = 1.5586522107
/** samples of the loop uploaded for the shader */
const LOOP_SAMPLES = 1024
/** coarse samples searched for each particle's nearest place on the loop */
const COARSE = 256

/** the loop sampled at equal time steps, and how far integration lands from where it began */
export function traceLoop(samples = LOOP_SAMPLES): { points: Float32Array; closure: number } {
  const sys = getSystem('lorenz')
  const P = sys.params.map((p) => p.default)
  const per = 64
  const h = LOOP_PERIOD / (samples * per)
  const p = new Float64Array(LOOP_START)
  const points = new Float32Array(samples * 4)
  for (let i = 0; i < samples; i++) {
    points[i * 4] = p[0]
    points[i * 4 + 1] = p[1]
    points[i * 4 + 2] = p[2]
    points[i * 4 + 3] = 1
    for (let k = 0; k < per; k++) rk4Step(sys, p, P, h)
  }
  const closure = Math.hypot(p[0] - LOOP_START[0], p[1] - LOOP_START[1], p[2] - LOOP_START[2])
  return { points, closure }
}

const common = /* glsl */ `
uniform sampler2D uLoop;
const float LOOP_N = ${LOOP_SAMPLES.toFixed(1)};
vec3 loopAt(float ph) {
  float x = fract(ph) * LOOP_N;
  float i0 = floor(x);
  float t = x - i0;
  vec3 a = texture2D(uLoop, vec2((i0 + 0.5) / LOOP_N, 0.5)).xyz;
  vec3 b = texture2D(uLoop, vec2((mod(i0 + 1.0, LOOP_N) + 0.5) / LOOP_N, 0.5)).xyz;
  return mix(a, b, t);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`

const stepFrag = /* glsl */ `
uniform sampler2D uState;
uniform float uSteps;   // RK4 steps this frame
uniform float uH;       // step size, system time
uniform float uHold;    // 0 = free flow; otherwise how hard each step pulls toward the loop
uniform float uTube;    // radius of the bundle round the loop, system units
varying vec2 vUv;
${common}
const float PERIOD = ${LOOP_PERIOD.toFixed(10)};

vec3 f(vec3 v) {
  return vec3(10.0 * (v.y - v.x), v.x * (28.0 - v.z) - v.y, v.x * v.y - (8.0 / 3.0) * v.z);
}

void main() {
  vec4 s = texture2D(uState, vUv);
  vec3 p = s.xyz;
  float ph = s.w;
  // each particle keeps its own small offset from the loop, so the held swarm is a tube, not a wire
  vec3 o = vec3(hash12(vUv * 913.1), hash12(vUv * 517.3 + 3.1), hash12(vUv * 271.9 + 7.7)) - 0.5;
  float r = pow(hash12(vUv * 77.7 + 1.3), 1.6);
  vec3 tube = normalize(o + 1e-4) * r * uTube;
  float pull = 1.0 - exp(-uHold * uH);
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uSteps) break;
    vec3 k1 = f(p);
    vec3 k2 = f(p + 0.5 * uH * k1);
    vec3 k3 = f(p + 0.5 * uH * k2);
    vec3 k4 = f(p + uH * k3);
    p += uH / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    ph += uH / PERIOD;
    if (uHold > 0.0) p = mix(p, loopAt(ph) + tube, pull);
  }
  // anything thrown far off (it cannot happen on the attractor) comes back near it
  if (!(length(p - vec3(0.0, 0.0, 25.0)) < 120.0)) p = vec3(1.0, 1.0, 20.0);
  gl_FragColor = vec4(p, fract(ph));
}
`

/** give every particle the phase of its nearest place on the loop (coarse search, then refine) */
const assignFrag = /* glsl */ `
uniform sampler2D uState;
varying vec2 vUv;
${common}
const float COARSE = ${COARSE.toFixed(1)};
void main() {
  vec4 s = texture2D(uState, vUv);
  vec3 p = s.xyz;
  float best = 1e9;
  float at = 0.0;
  for (int i = 0; i < ${COARSE}; i++) {
    float ph = float(i) / COARSE;
    vec3 d = loopAt(ph) - p;
    float e = dot(d, d);
    if (e < best) { best = e; at = ph; }
  }
  float c = at;
  for (int i = -8; i <= 8; i++) {
    float ph = c + float(i) / (COARSE * 8.0);
    vec3 d = loopAt(ph) - p;
    float e = dot(d, d);
    if (e < best) { best = e; at = ph; }
  }
  gl_FragColor = vec4(p, fract(at));
}
`

export class LoopFlow {
  readonly source: FragmentSource
  /** flow speed, system time units per second */
  rate = 2
  /** pull strength (per unit system time); 0 = let go */
  hold = 0
  readonly closure: number
  private readonly loopTex: THREE.DataTexture
  private readonly assign: THREE.ShaderMaterial
  private readonly h = getSystem('lorenz').dt
  private owed = 0

  constructor(renderer: THREE.WebGLRenderer, size: number) {
    const { points, closure } = traceLoop()
    this.closure = closure
    this.loopTex = new THREE.DataTexture(points, LOOP_SAMPLES, 1, THREE.RGBAFormat, THREE.FloatType)
    this.loopTex.minFilter = THREE.NearestFilter
    this.loopTex.magFilter = THREE.NearestFilter
    this.loopTex.needsUpdate = true
    this.source = new FragmentSource(renderer, size, stepFrag, {
      uLoop: { value: this.loopTex },
      uSteps: { value: 0 },
      uH: { value: this.h },
      uHold: { value: 0 },
      uTube: { value: 0.32 },
    })
    this.assign = this.source.program(assignFrag, { uState: { value: null }, uLoop: { value: this.loopTex } })
    // the shader's step count follows the frame time
    this.source.beforeRun = (dt) => {
      const u = this.source.uniforms
      this.owed += dt * this.rate
      const steps = Math.min(24, Math.floor(this.owed / this.h))
      this.owed = Math.min(this.owed - steps * this.h, this.h * 4)
      u.uSteps.value = steps
      u.uHold.value = this.hold
    }
  }

  set tube(v: number) {
    this.source.uniforms.uTube.value = v
  }

  /** take positions (system units) from another source of the same size, e.g. the shared butterfly */
  seed(texture: THREE.Texture) {
    this.source.load(texture)
  }

  /** each particle learns where on the loop it is closest to */
  findPlaces() {
    this.source.apply(this.assign)
  }

  /** points along the loop in system units, for pinning a label */
  loopPoint(phase: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.loopTex.image.data as Float32Array
    const i = Math.floor((((phase % 1) + 1) % 1) * LOOP_SAMPLES) * 4
    return out.set(d[i], d[i + 1], d[i + 2])
  }

  dispose() {
    this.source.dispose()
    this.loopTex.dispose()
    this.assign.dispose()
  }
}
