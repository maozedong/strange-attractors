/**
 * The dust: one field of particles that every scene is made of.
 *
 * A scene never owns particles. It hands the dust a *source* (an N×N float texture of positions
 * plus a matrix to world space) and a *look* (size, brightness, colour rule). To change scene the
 * dust morphs from the old source to the new one: each particle flies from where it was to where
 * it now belongs, staggered and swirled, so the butterfly pours into a diagram, a fern, a flock.
 *
 * The morph is stateless: the vertex shader samples both sources every frame and blends, so both
 * ends can keep moving while the dust is in flight and the arrival is exact. `bake()` freezes the
 * blend into a texture when a third source arrives mid-flight. Sources belong to the scene that
 * made them; the dust only reads them.
 *
 * Particles are camera-facing quads with a thin-lens depth of field (out-of-focus dust swells
 * into dim bokeh discs, energy conserved) and are stretched along their screen-space motion.
 */
import * as THREE from 'three'
import { rampGlsl, type Palette } from './palettes'

export interface DustSource {
  /** N×N float texture: xyz = position in source space, w = aux (speed, tone, anything) */
  readonly texture: THREE.Texture
  /** the same state one frame ago, for motion streaks; null draws round points */
  readonly prevTexture: THREE.Texture | null
  /** source space → world */
  readonly matrix: THREE.Matrix4
  /** advance the simulation; called once per frame while the source is on screen */
  update?(dt: number, time: number): void
}

/** where a particle's position on the colour ramp comes from */
export type ToneSource = 'speed' | 'aux' | 'seed' | 'motion'

export interface DustLook {
  /** particle radius in world units at the focal plane */
  size: number
  /** never smaller than this many device pixels (radius) */
  minPx: number
  /** brightness of one particle */
  gain: number
  /** 0..1 overall fade */
  opacity: number
  /** how many frames of motion a particle is smeared along (0 = round) */
  streak: number
  palette: Palette
  tone: ToneSource
  /** for 'speed': the aux value that maps to the hot end; for 'motion': world units per second */
  speedNorm: number
  /** tone = toneBias + toneScale * raw */
  toneBias: number
  toneScale: number
  /** optional N×N colour per particle (linear RGB), blended in by paintMix */
  paint: THREE.Texture | null
  paintMix: number
  /** 0..1 shimmer */
  twinkle: number
}

export function defaultLook(palette: Palette): DustLook {
  return {
    size: 0.0042,
    minPx: 0.85,
    gain: 0.55,
    opacity: 1,
    streak: 1.6,
    palette,
    tone: 'speed',
    speedNorm: 1,
    toneBias: 0,
    toneScale: 1,
    paint: null,
    paintMix: 0,
    twinkle: 0,
  }
}

const TONE_INDEX: Record<ToneSource, number> = { speed: 0, aux: 1, seed: 2, motion: 3 }

/** shared by the draw and bake shaders, so a baked particle lands exactly where it was drawn */
const placeGlsl = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 swirl(vec3 q, float t) {
  return 0.5 * vec3(
    sin(q.y * 1.7 + t) + sin(q.z * 2.3 - t * 0.7),
    sin(q.z * 1.9 + t * 1.1) + sin(q.x * 2.1 + t * 0.5),
    sin(q.x * 1.5 - t * 0.9) + sin(q.y * 2.7 + t * 0.3));
}

// each particle leaves and arrives on its own schedule
float stagger(float m, float s) {
  float e = clamp(m * 1.55 - s * 0.55, 0.0, 1.0);
  return e * e * (3.0 - 2.0 * e);
}

vec3 place(vec3 a, vec3 b, float m, float s, float amount, float time) {
  float e = stagger(m, s);
  vec3 p = mix(a, b, e);
  float w = sin(3.14159265 * e);
  vec3 mid = 0.5 * (a + b);
  vec3 arc = cross(b - a, vec3(0.3, 1.0, 0.2));
  p += w * amount * (swirl(mid * 1.3 + s * 6.2831, time * 0.6) * 0.32 + arc * 0.3 * (s - 0.5));
  return p;
}
`

const vert = /* glsl */ `
${rampGlsl}
${placeGlsl}

attribute vec2 ref;

uniform sampler2D uPosA;
uniform sampler2D uPrevA;
uniform sampler2D uPosB;
uniform sampler2D uPrevB;
uniform mat4 uModelA;
uniform mat4 uModelB;
uniform float uMorph;
uniform float uMorphPrev;
uniform float uSwirl;
uniform float uTime;
uniform float uDt;
uniform float uSize;        // texture size N
uniform vec2 uResolution;   // device pixels
uniform float uPx;          // device pixels per world unit at distance 1
uniform float uFocus;
uniform float uAperture;
uniform float uMaxCoc;
uniform float uMaxLen;
uniform float uMirror;
uniform float uFloorY;
uniform float uMaster;

uniform vec3 uRampA[5];
uniform vec3 uRampB[5];
uniform vec4 uToneA;   // tone source, speedNorm, paintMix, twinkle
uniform vec4 uToneB;
uniform vec4 uTone2A;  // toneBias, toneScale, minPx, -
uniform vec4 uTone2B;
uniform vec4 uShapeA;  // size, gain, streak, opacity
uniform vec4 uShapeB;
uniform sampler2D uPaintA;
uniform sampler2D uPaintB;

varying vec3 vColor;
varying vec2 vLocal;
varying float vLen;
varying float vRadius;
varying float vBokeh;

float toneOf(vec4 tone, vec4 tone2, float aux, float motion, float s) {
  float t;
  if (tone.x < 0.5) t = aux / max(tone.y, 1e-6);
  else if (tone.x < 1.5) t = aux;
  else if (tone.x < 2.5) t = s;
  else t = motion / max(tone.y, 1e-6);
  return tone2.x + tone2.y * t;
}

void main() {
  float s = hash12(ref * uSize);

  vec4 a = texture2D(uPosA, ref);
  vec4 ap = texture2D(uPrevA, ref);
  vec3 A = (uModelA * vec4(a.xyz, 1.0)).xyz;
  vec3 Ap = (uModelA * vec4(ap.xyz, 1.0)).xyz;

  vec3 p = A;
  vec3 pp = Ap;
  float e = 0.0;
  float auxB = 0.0;
  if (uMorph > 0.0) {
    vec4 b = texture2D(uPosB, ref);
    vec4 bp = texture2D(uPrevB, ref);
    vec3 B = (uModelB * vec4(b.xyz, 1.0)).xyz;
    vec3 Bp = (uModelB * vec4(bp.xyz, 1.0)).xyz;
    p = place(A, B, uMorph, s, uSwirl, uTime);
    pp = place(Ap, Bp, uMorphPrev, s, uSwirl, uTime - uDt);
    e = stagger(uMorph, s);
    auxB = b.w;
  }

  float motion = length(p - pp) / max(uDt, 1e-4);

  vec4 shape = mix(uShapeA, uShapeB, e);
  float minPx = mix(uTone2A.z, uTone2B.z, e);
  float twinkle = mix(uToneA.w, uToneB.w, e);

  vec3 cA = ramp5(uRampA[0], uRampA[1], uRampA[2], uRampA[3], uRampA[4], toneOf(uToneA, uTone2A, a.w, motion, s));
  cA = mix(cA, texture2D(uPaintA, ref).rgb, uToneA.z);
  vec3 color = cA;
  if (uMorph > 0.0) {
    vec3 cB = ramp5(uRampB[0], uRampB[1], uRampB[2], uRampB[3], uRampB[4], toneOf(uToneB, uTone2B, auxB, motion, s));
    cB = mix(cB, texture2D(uPaintB, ref).rgb, uToneB.z);
    color = mix(cA, cB, e);
  }

  // a dark glossy floor: the reflection dims and softens with height above it
  float fade = 1.0;
  float rough = 1.0;
  if (uMirror > 0.5) {
    float h = max(0.0, p.y - uFloorY);
    fade = 0.5 * exp(-0.85 * h);
    rough = 1.3 + 1.1 * h;
    p.y = 2.0 * uFloorY - p.y;
    pp.y = 2.0 * uFloorY - pp.y;
  }

  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec4 mvp = viewMatrix * vec4(pp, 1.0);
  float z = max(-mv.z, 0.02);
  vec4 hc = projectionMatrix * mv;
  vec4 tc = projectionMatrix * mvp;

  vec2 halfRes = 0.5 * uResolution;
  vec2 hs = hc.xy / hc.w * halfRes;
  vec2 ts = tc.w > 0.0 ? tc.xy / tc.w * halfRes : hs;
  vec2 d = (ts - hs) * shape.z;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  len = min(len, uMaxLen);

  float core = max(shape.x * uPx / z, minPx);
  float coc = min(abs(z - uFocus) / z * uAperture * uPx, uMaxCoc);
  float r = sqrt(core * core + coc * coc) * rough;

  vec2 local = vec2(position.x > 0.0 ? len + r : -r, position.y * r);
  vec2 screen = hs + dir * local.x + vec2(-dir.y, dir.x) * local.y;
  gl_Position = vec4(screen / halfRes * hc.w, hc.z, hc.w);
  if (mv.z > -0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);

  // energy: a defocused or smeared particle spreads the same light over more pixels
  float area = (core * core) / (r * r);
  float smear = 1.0 / (1.0 + 0.35 * len / r);
  float tw = 1.0 + twinkle * sin(uTime * (1.5 + 5.0 * s) + s * 40.0);
  // a few grains catch the light: most are dim, one in thirty glints
  float s2 = hash12(ref * uSize + 17.31);
  tw *= 0.6 + 2.6 * pow(s2, 9.0);
  vColor = color * (shape.y * shape.w * uMaster * fade * pow(area, 0.82) * smear * tw);
  vLocal = local;
  vLen = len;
  vRadius = r;
  vBokeh = clamp(coc / (core * 2.5), 0.0, 1.0);
}
`

const frag = /* glsl */ `
varying vec3 vColor;
varying vec2 vLocal;
varying float vLen;
varying float vRadius;
varying float vBokeh;

void main() {
  float dx = max(max(-vLocal.x, vLocal.x - vLen), 0.0);
  float d = length(vec2(dx, vLocal.y)) / vRadius;
  if (d > 1.0) discard;
  float soft = exp(-d * d * 3.2);
  float disc = smoothstep(1.0, 0.8, d) * (0.62 + 0.5 * d * d);
  float profile = mix(soft, disc, vBokeh);
  float tail = 1.0 - 0.7 * clamp(vLocal.x / max(vLen, 1e-3), 0.0, 1.0) * step(1e-3, vLen);
  gl_FragColor = vec4(vColor * profile * tail, 1.0);
}
`

const bakeFrag = /* glsl */ `
${placeGlsl}
uniform sampler2D uPosA;
uniform sampler2D uPosB;
uniform mat4 uModelA;
uniform mat4 uModelB;
uniform float uMorph;
uniform float uSwirl;
uniform float uTime;
uniform float uSize;
varying vec2 vUv;
void main() {
  float s = hash12(vUv * uSize);
  vec4 a = texture2D(uPosA, vUv);
  vec4 b = texture2D(uPosB, vUv);
  vec3 A = (uModelA * vec4(a.xyz, 1.0)).xyz;
  vec3 B = (uModelB * vec4(b.xyz, 1.0)).xyz;
  float e = stagger(uMorph, s);
  gl_FragColor = vec4(place(A, B, uMorph, s, uSwirl, uTime), mix(a.w, b.w, e));
}
`

const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const IDENTITY = new THREE.Matrix4()

function whiteTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType)
  t.needsUpdate = true
  return t
}

/** A source that never moves: used for baked blends and as the "nothing yet" state. */
class StillSource implements DustSource {
  readonly prevTexture = null
  readonly matrix = new THREE.Matrix4()
  constructor(readonly texture: THREE.Texture) {}
}

export interface MorphOptions {
  seconds?: number
  /** how far particles wander off the straight line, world units (0 = straight) */
  swirl?: number
  ease?: (t: number) => number
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class Dust {
  readonly size: number
  readonly count: number
  /** add this to the scene */
  readonly object = new THREE.Group()
  /** thin-lens settings, written by the camera rig every frame */
  focus = 3
  aperture = 0.012
  /** world y of the mirror floor; null hides the reflection */
  floorY: number | null = -1.25
  /** overall fade of the whole field (scenes that are mostly props dim it) */
  master = 1

  private readonly renderer: THREE.WebGLRenderer
  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly mirrorMaterial: THREE.ShaderMaterial
  private readonly mesh: THREE.Mesh
  private readonly mirror: THREE.Mesh
  private readonly white = whiteTexture()
  private readonly uniforms: Record<string, THREE.IUniform>

  private a: DustSource
  private b: DustSource | null = null
  private lookA: DustLook
  private lookB: DustLook | null = null
  private morph = 0
  private morphPrev = 0
  private morphSeconds = 1
  private morphEase = easeInOut
  private morphClock = 0
  private swirl = 0.6
  private onArrive: (() => void) | null = null

  // bake rig
  private readonly bakeScene = new THREE.Scene()
  private readonly bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly bakeMaterial: THREE.ShaderMaterial
  private bakeTargets: THREE.WebGLRenderTarget[] = []
  private bakeIndex = 0

  constructor(renderer: THREE.WebGLRenderer, size: number, look: DustLook) {
    this.renderer = renderer
    this.size = size
    this.count = size * size
    this.lookA = look

    // every particle starts at the origin until a scene supplies a source
    const zero = new THREE.DataTexture(new Float32Array(size * size * 4), size, size, THREE.RGBAFormat, THREE.FloatType)
    zero.needsUpdate = true
    this.a = new StillSource(zero)

    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    const refs = new Float32Array(this.count * 2)
    for (let i = 0; i < this.count; i++) {
      refs[i * 2] = ((i % size) + 0.5) / size
      refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size
    }
    geometry.setAttribute('ref', new THREE.InstancedBufferAttribute(refs, 2))
    geometry.instanceCount = this.count
    this.geometry = geometry

    const rampUniform = () => ({ value: [0, 1, 2, 3, 4].map(() => new THREE.Color()) })
    this.uniforms = {
      uPosA: { value: zero },
      uPrevA: { value: zero },
      uPosB: { value: zero },
      uPrevB: { value: zero },
      uModelA: { value: new THREE.Matrix4() },
      uModelB: { value: new THREE.Matrix4() },
      uMorph: { value: 0 },
      uMorphPrev: { value: 0 },
      uSwirl: { value: 0.6 },
      uTime: { value: 0 },
      uDt: { value: 1 / 60 },
      uSize: { value: size },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPx: { value: 1000 },
      uFocus: { value: 3 },
      uAperture: { value: 0.012 },
      uMaxCoc: { value: 26 },
      uMaxLen: { value: 70 },
      uFloorY: { value: -1.25 },
      uMaster: { value: 1 },
      uRampA: rampUniform(),
      uRampB: rampUniform(),
      uToneA: { value: new THREE.Vector4() },
      uToneB: { value: new THREE.Vector4() },
      uTone2A: { value: new THREE.Vector4() },
      uTone2B: { value: new THREE.Vector4() },
      uShapeA: { value: new THREE.Vector4() },
      uShapeB: { value: new THREE.Vector4() },
      uPaintA: { value: this.white },
      uPaintB: { value: this.white },
    }

    const make = (mirror: number) =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: { ...this.uniforms, uMirror: { value: mirror } },
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      })
    this.material = make(0)
    this.mirrorMaterial = make(1)

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mirror = new THREE.Mesh(geometry, this.mirrorMaterial)
    for (const m of [this.mesh, this.mirror]) {
      m.frustumCulled = false
      m.renderOrder = 10
      this.object.add(m)
    }

    this.bakeMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: bakeFrag,
      uniforms: {
        uPosA: this.uniforms.uPosA,
        uPosB: this.uniforms.uPosB,
        uModelA: this.uniforms.uModelA,
        uModelB: this.uniforms.uModelB,
        uMorph: this.uniforms.uMorph,
        uSwirl: this.uniforms.uSwirl,
        uTime: this.uniforms.uTime,
        uSize: this.uniforms.uSize,
      },
      depthTest: false,
      depthWrite: false,
    })
    this.bakeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeMaterial))
  }

  /** the look scenes should tween: the newest one */
  get look(): DustLook {
    return this.lookB ?? this.lookA
  }

  /** the source currently being flown to (or shown) */
  get source(): DustSource {
    return this.b ?? this.a
  }

  get morphing(): boolean {
    return this.b !== null
  }

  /** Show a source immediately, no flight. */
  setSource(source: DustSource, look: DustLook): void {
    this.a = source
    this.lookA = look
    this.b = null
    this.lookB = null
    this.morph = 0
    this.morphPrev = 0
    this.onArrive = null
  }

  /** Fly every particle from wherever it is now to its place in `source`. */
  morphTo(source: DustSource, look: DustLook, opts: MorphOptions = {}): Promise<void> {
    if (this.b) {
      // already in flight: freeze the current blend and leave from there
      const frozen = this.bake()
      const mixed = this.blendLooks(this.lookA, this.lookB ?? this.lookA, this.morphEase(Math.min(1, this.morphClock / this.morphSeconds)))
      this.a = frozen
      this.lookA = mixed
    }
    this.b = source
    this.lookB = look
    this.morph = 0
    this.morphPrev = 0
    this.morphClock = 0
    this.morphSeconds = Math.max(0.05, opts.seconds ?? 2.4)
    this.morphEase = opts.ease ?? easeInOut
    this.swirl = opts.swirl ?? 0.6
    return new Promise((resolve) => {
      this.onArrive = resolve
    })
  }

  /** Freeze the current on-screen positions (world space) into a still source. */
  bake(): DustSource {
    if (this.bakeTargets.length < 2) {
      this.bakeTargets.push(
        new THREE.WebGLRenderTarget(this.size, this.size, {
          type: THREE.FloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
        }),
      )
    }
    // alternate targets so a bake can read the previous bake
    const target = this.bakeTargets[this.bakeIndex % this.bakeTargets.length]
    this.bakeIndex++
    this.sync(0, 0)
    const r = this.renderer
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(target)
    r.render(this.bakeScene, this.bakeCamera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
    return new StillSource(target.texture)
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    this.a.update?.(dt, time)
    this.b?.update?.(dt, time)

    if (this.b) {
      this.morphClock += dt
      this.morphPrev = this.morph
      this.morph = this.morphEase(Math.min(1, this.morphClock / this.morphSeconds))
      if (this.morphClock >= this.morphSeconds) {
        this.a = this.b
        this.lookA = this.lookB ?? this.lookA
        this.b = null
        this.lookB = null
        this.morph = 0
        this.morphPrev = 0
        const done = this.onArrive
        this.onArrive = null
        done?.()
      }
    }

    const u = this.uniforms
    u.uResolution.value.set(width, height)
    u.uPx.value = (0.5 * height) / Math.tan((camera.fov * Math.PI) / 360)
    u.uFocus.value = this.focus
    u.uAperture.value = this.aperture
    u.uMaxCoc.value = Math.max(8, height * 0.022)
    u.uMaxLen.value = Math.max(24, height * 0.07)
    u.uFloorY.value = this.floorY ?? 0
    u.uMaster.value = this.master
    this.mirror.visible = this.floorY !== null
    this.sync(dt, time)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.mirrorMaterial.dispose()
    this.bakeMaterial.dispose()
    this.white.dispose()
    for (const t of this.bakeTargets) t.dispose()
  }

  private sync(dt: number, time: number) {
    const u = this.uniforms
    const a = this.a
    const b = this.b ?? a
    u.uPosA.value = a.texture
    u.uPrevA.value = a.prevTexture ?? a.texture
    u.uPosB.value = b.texture
    u.uPrevB.value = b.prevTexture ?? b.texture
    ;(u.uModelA.value as THREE.Matrix4).copy(a.matrix ?? IDENTITY)
    ;(u.uModelB.value as THREE.Matrix4).copy(b.matrix ?? IDENTITY)
    u.uMorph.value = this.b ? Math.max(this.morph, 1e-5) : 0
    u.uMorphPrev.value = this.b ? Math.max(this.morphPrev, 1e-5) : 0
    u.uSwirl.value = this.swirl
    if (dt > 0) {
      u.uTime.value = time
      u.uDt.value = dt
    }
    this.writeLook('A', this.lookA)
    this.writeLook('B', this.lookB ?? this.lookA)
  }

  private writeLook(slot: 'A' | 'B', look: DustLook) {
    const u = this.uniforms
    const ramp = u[`uRamp${slot}`].value as THREE.Color[]
    for (let i = 0; i < 5; i++) ramp[i].copy(look.palette.ramp[i])
    ;(u[`uTone${slot}`].value as THREE.Vector4).set(TONE_INDEX[look.tone], look.speedNorm, look.paint ? look.paintMix : 0, look.twinkle)
    ;(u[`uTone2${slot}`].value as THREE.Vector4).set(look.toneBias, look.toneScale, look.minPx * this.renderer.getPixelRatio(), 0)
    ;(u[`uShape${slot}`].value as THREE.Vector4).set(look.size, look.gain, look.streak, look.opacity)
    u[`uPaint${slot}`].value = look.paint ?? this.white
  }

  private blendLooks(a: DustLook, b: DustLook, t: number): DustLook {
    const mix = (x: number, y: number) => x + (y - x) * t
    return {
      ...(t < 0.5 ? a : b),
      size: mix(a.size, b.size),
      minPx: mix(a.minPx, b.minPx),
      gain: mix(a.gain, b.gain),
      opacity: mix(a.opacity, b.opacity),
      streak: mix(a.streak, b.streak),
      twinkle: mix(a.twinkle, b.twinkle),
    }
  }
}
