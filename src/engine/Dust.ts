/**
 * The dust: one field of particles that every scene is made of.
 *
 * A scene never owns particles. It hands the dust a *source* (an N×N float texture of positions
 * plus a matrix to world space) and a *look* (size, brightness, colour rule). To change scene the
 * dust morphs from the old source to the new one: each particle flies from where it was to where
 * it now belongs, staggered and swirled, so the butterfly pours into a diagram, a fern, a flock.
 *
 * The morph is stateless: once a frame a resolve pass samples both sources and blends, so both
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
  /** 1 = pin-sharp points; above, each one is a wider, dimmer disc carrying the same light */
  soft: number
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
    soft: 1.2,
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

// Everything about a particle that does not depend on the camera, worked out once per frame in
// one pass over an N×N target: where it is now and a frame ago (the morph resolved), how far into
// its own flight it is, and its colour and brightness. The draw then runs for four corners and
// twice over (the floor reflection) and only fetches the answer, instead of repeating the morph,
// the colour ramp and every texture read eight times per particle.
const resolveFrag = /* glsl */ `
${rampGlsl}
${placeGlsl}

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
uniform float uMaster;

uniform vec3 uRampA[5];
uniform vec3 uRampB[5];
uniform vec4 uToneA;   // tone source, speedNorm, paintMix, twinkle
uniform vec4 uToneB;
uniform vec4 uTone2A;  // toneBias, toneScale, minPx, soft
uniform vec4 uTone2B;
uniform vec4 uShapeA;  // size, gain, streak, opacity
uniform vec4 uShapeB;
uniform sampler2D uPaintA;
uniform sampler2D uPaintB;

layout(location = 0) out vec4 outPos;    // world position, own morph progress
layout(location = 1) out vec4 outPrev;   // world position one frame ago, the particle's lot in a thinning
layout(location = 2) out vec4 outColor;  // linear colour times brightness

float toneOf(vec4 tone, vec4 tone2, float aux, float motion, float s) {
  float t;
  if (tone.x < 0.5) t = aux / max(tone.y, 1e-6);
  else if (tone.x < 1.5) t = aux;
  else if (tone.x < 2.5) t = s;
  else t = motion / max(tone.y, 1e-6);
  return tone2.x + tone2.y * t;
}

void main() {
  // the pixel centre is the particle's cell, exactly as the draw's ref attribute times N
  vec2 cell = gl_FragCoord.xy;
  vec2 ref = cell / uSize;
  float s = hash12(cell);

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
  float soft = mix(uTone2A.w, uTone2B.w, e);
  float twinkle = mix(uToneA.w, uToneB.w, e);

  vec3 cA = ramp5(uRampA[0], uRampA[1], uRampA[2], uRampA[3], uRampA[4], toneOf(uToneA, uTone2A, a.w, motion, s));
  cA = mix(cA, texture2D(uPaintA, ref).rgb, uToneA.z);
  vec3 color = cA;
  if (uMorph > 0.0) {
    vec3 cB = ramp5(uRampB[0], uRampB[1], uRampB[2], uRampB[3], uRampB[4], toneOf(uToneB, uTone2B, auxB, motion, s));
    cB = mix(cB, texture2D(uPaintB, ref).rgb, uToneB.z);
    color = mix(cA, cB, e);
  }

  float tw = 1.0 + twinkle * sin(uTime * (1.5 + 5.0 * s) + s * 40.0);
  // a few grains catch the light, but only a little: uneven brightness reads as noise
  float s2 = hash12(cell + 17.31);
  tw *= 0.8 + 0.65 * pow(s2, 9.0);

  outPos = vec4(p, e);
  outPrev = vec4(pp, hash12(cell + 41.17));
  outColor = vec4(color * (shape.y * shape.w * uMaster * tw / (soft * soft)), 1.0);
}
`

const vert = /* glsl */ `
attribute vec2 ref;

uniform sampler2D uPos;
uniform sampler2D uPrev;
uniform sampler2D uColor;
uniform vec2 uResolution;   // device pixels
uniform float uPx;          // device pixels per world unit at distance 1
uniform float uFocus;
uniform float uAperture;
uniform float uMaxCoc;
uniform float uMaxLen;
uniform float uMirror;
uniform float uFloorY;
uniform float uMaxPoint;    // largest point sprite the GPU draws, device pixels
uniform sampler2D uCrowd;   // how many sprites cover each cell of a coarse screen grid, from a sample
uniform float uCrowdScale;  // particles each sampled one stands for
uniform float uCrowdDepth;  // sprites a pixel keeps before the rest are thinned
uniform float uCrowdCeil;   // most sprites a pixel can visibly sum, as a multiple of uCrowdDepth
uniform vec4 uTone2A;  // toneBias, toneScale, minPx, soft
uniform vec4 uTone2B;
uniform vec4 uShapeA;  // size, gain, streak, opacity
uniform vec4 uShapeB;

varying vec3 vColor;
varying vec2 vLocal;
varying float vLen;
varying float vRadius;
varying float vBokeh;
varying vec2 vDir;
varying vec2 vShift;
varying float vSpan;

void main() {
  vec3 color = texture2D(uColor, ref).rgb;
  // a dark grain adds nothing to the picture: skip it before it costs any fill
  if (color == vec3(0.0)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 P = texture2D(uPos, ref);
  vec3 p = P.xyz;
  vec4 before = texture2D(uPrev, ref);
  vec3 pp = before.xyz;
  float e = P.w;
  vec3 direct = p;

  vec4 shape = mix(uShapeA, uShapeB, e);
  float minPx = mix(uTone2A.z, uTone2B.z, e);
  float soft = mix(uTone2A.w, uTone2B.w, e);

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

  // softness spreads a particle's light over a wider disc without adding any: neighbours
  // overlap and a cloud of points reads as one luminous surface instead of sand
  float core = max(shape.x * uPx / z, minPx) * soft;
  float coc = min(abs(z - uFocus) / z * uAperture * uPx, uMaxCoc);
  float r = sqrt(core * core + coc * coc) * rough;

  // where thousands of sprites pile onto the same pixels (a cloud packed into a dot, a field
  // collapsed onto a fixed point) the eye cannot tell them apart: draw a random share of them,
  // each brighter by the share it stands for, so the fill stays bounded. The colour buffer is
  // half float, whose sum stops growing once a pixel holds a couple of thousand equal sprites (each
  // one falls below its rounding step); the weight stops at that same ceiling, so a packed
  // crowd keeps the brightness it has always had. The reflection is thinned by where the
  // particle itself is, so a grain and its reflection are kept or dropped together
  float keep = 1.0;
  float weight = 1.0;
  vec4 dc = projectionMatrix * (viewMatrix * vec4(direct, 1.0));
  vec2 crowdCell = dc.xy / dc.w * 0.5 + 0.5;
  if (dc.w > 0.0 && all(greaterThan(crowdCell, vec2(0.0))) && all(lessThan(crowdCell, vec2(1.0)))) {
    float stack = texture2D(uCrowd, crowdCell).r * uCrowdScale;
    keep = min(1.0, uCrowdDepth / max(stack, 1e-6));
    weight = min(1.0 / keep, uCrowdCeil);
  }

#ifdef POINTS
  // a point sprite is a square around the grain, and a GPU may drop the whole sprite once its
  // centre leaves the view: a grain straddling the edge is drawn from a sprite pulled back
  // inside and widened by as much, so its visible part still lands on the same pixels
  float span = len + 2.0 * r;
  vec2 centre = hs + dir * (0.5 * len);
  vec2 inside = clamp(centre, 0.5 - halfRes, halfRes - 0.5);
  vec2 shift = centre - inside;
  float reach = max(abs(shift.x), abs(shift.y));
  float sprite = min(span + 2.0 * reach, uMaxPoint);
  gl_PointSize = sprite;
  gl_Position = vec4(inside / halfRes * hc.w, hc.z, hc.w);
  vDir = dir;
  vShift = shift;
  vSpan = sprite;
  if (reach > 0.5 * span) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#else
  vec2 local = vec2(position.x > 0.0 ? len + r : -r, position.y * r);
  vec2 screen = hs + dir * local.x + vec2(-dir.y, dir.x) * local.y;
  gl_Position = vec4(screen / halfRes * hc.w, hc.z, hc.w);
  vLocal = local;
#endif
  if (mv.z > -0.02 || before.w >= keep) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);

  // energy: a defocused or smeared particle spreads the same light over more pixels
  float area = (core * core) / (r * r);
  float smear = 1.0 / (1.0 + 0.35 * len / r);
  vColor = color * (fade * pow(area, 0.82) * smear * weight);
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
varying vec2 vDir;
varying vec2 vShift;
varying float vSpan;

void main() {
#ifdef POINTS
  // the same capsule coordinates the quad would have interpolated, from the sprite's own
  vec2 off = (vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - 0.5) * vSpan - vShift;
  vec2 vLocal = vec2(dot(off, vDir) + 0.5 * vLen, dot(off, vec2(-vDir.y, vDir.x)));
#endif
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

/** a sample of the particles as single points, counted per cell of a coarse grid over the screen */
const crowdVert = /* glsl */ `
uniform sampler2D uPos;
uniform sampler2D uColor;
uniform float uPx;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxCoc;
uniform vec4 uTone2A;
uniform vec4 uTone2B;
uniform vec4 uShapeA;
uniform vec4 uShapeB;
uniform float uCellArea;  // device pixels² in one grid cell
varying float vCover;
void main() {
  vec2 ref = position.xy;
  vec4 P = texture2D(uPos, ref);
  float e = P.w;
  vec4 mv = viewMatrix * vec4(P.xyz, 1.0);
  // a dark grain is not drawn, so it is not part of any crowd
  bool unseen = mv.z > -0.02 || texture2D(uColor, ref).rgb == vec3(0.0);
  gl_Position = unseen ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;

  // the sprite's radius as the draw computes it (streaks left out: they are short where it matters)
  float z = max(-mv.z, 0.02);
  float core = max(mix(uShapeA.x, uShapeB.x, e) * uPx / z, mix(uTone2A.z, uTone2B.z, e)) * mix(uTone2A.w, uTone2B.w, e);
  float coc = min(abs(z - uFocus) / z * uAperture * uPx, uMaxCoc);
  float r = sqrt(core * core + coc * coc);
  // a disc wider than a cell covers a square of cells; a smaller one covers a share of one
  float side = max(1.0, 2.0 * r / sqrt(uCellArea));
  gl_PointSize = side;
  vCover = 3.14159 * r * r / uCellArea / (side * side);
}
`

const crowdFrag = /* glsl */ `
varying float vCover;
void main() {
  gl_FragColor = vec4(vCover);
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

/** the crowd grid: cells across the screen, fixed so the thinning does not depend on resolution */
const CROWD_GRID = 128
/** one particle in CROWD_STRIDE² is counted: few enough that a half-float cell never overflows */
const CROWD_STRIDE = 16
/** sprites a pixel may stack before the rest are thinned: far beyond what can be told apart */
const CROWD_DEPTH = 512
/**
 * equal sprites a half-float pixel sums before each new one is lost to rounding: between 2048 and
 * 4096 depending on the sprite's own brightness, so the geometric middle
 */
const CROWD_CEILING = 2896
const crowdSide = (size: number) => Math.max(1, Math.floor(size / CROWD_STRIDE))

/** point sprites only where the GPU draws them this wide (device pixels): a grain wider than
 * the limit would show as its middle square, so small limits keep the quads */
const POINT_SPRITES_FROM = 256

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
  private readonly materials: THREE.ShaderMaterial[]
  private readonly pointGeometry: THREE.BufferGeometry
  private readonly mesh: THREE.Mesh
  private readonly mirror: THREE.Mesh
  private readonly points: THREE.Points
  private readonly mirrorPoints: THREE.Points
  /** largest point sprite this GPU draws (device pixels); below a useful size, quads only */
  private readonly maxPoint: number
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

  // the per-frame resolve: position, previous position and colour of every particle
  private readonly resolveScene = new THREE.Scene()
  private readonly resolveMaterial: THREE.ShaderMaterial
  private readonly resolveTarget: THREE.WebGLRenderTarget

  // crowd rig: how densely the particles are packed on screen, measured each frame
  private readonly crowdScene = new THREE.Scene()
  private readonly crowdTarget: THREE.WebGLRenderTarget
  private readonly crowdMaterial: THREE.ShaderMaterial
  private readonly crowdGeometry: THREE.BufferGeometry
  private readonly crowdScale = { value: 0 }
  private readonly clearColor = new THREE.Color()

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

    this.resolveTarget = new THREE.WebGLRenderTarget(size, size, {
      count: 3,
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    this.resolveMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: resolveFrag,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    })
    this.resolveScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolveMaterial))

    const [resolvedPos, resolvedPrev, resolvedColor] = this.resolveTarget.textures

    // half float holds exact counts up to 2048 a cell; a fuller cell reads low, which only thins less
    this.crowdTarget = new THREE.WebGLRenderTarget(CROWD_GRID, CROWD_GRID, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    const n = crowdSide(size)
    const sample = new Float32Array(n * n * 3)
    for (let i = 0; i < n * n; i++) {
      sample[i * 3] = ((i % n) * CROWD_STRIDE + 0.5) / size
      sample[i * 3 + 1] = (Math.floor(i / n) * CROWD_STRIDE + 0.5) / size
    }
    this.crowdGeometry = new THREE.BufferGeometry()
    this.crowdGeometry.setAttribute('position', new THREE.BufferAttribute(sample, 3))
    this.crowdMaterial = new THREE.ShaderMaterial({
      vertexShader: crowdVert,
      fragmentShader: crowdFrag,
      uniforms: {
        uPos: { value: resolvedPos },
        uColor: { value: resolvedColor },
        uPx: this.uniforms.uPx,
        uFocus: this.uniforms.uFocus,
        uAperture: this.uniforms.uAperture,
        uMaxCoc: this.uniforms.uMaxCoc,
        uTone2A: this.uniforms.uTone2A,
        uTone2B: this.uniforms.uTone2B,
        uShapeA: this.uniforms.uShapeA,
        uShapeB: this.uniforms.uShapeB,
        uCellArea: { value: 1 },
      },
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      depthTest: false,
      depthWrite: false,
    })
    const crowd = new THREE.Points(this.crowdGeometry, this.crowdMaterial)
    crowd.frustumCulled = false
    this.crowdScene.add(crowd)
    this.crowdScene.matrixWorldAutoUpdate = false
    const pointRange: unknown = renderer.getContext().getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE)
    this.maxPoint = pointRange instanceof Float32Array && pointRange.length > 1 ? pointRange[1] : 1
    const make = (mirror: number, points: boolean) =>
      new THREE.ShaderMaterial({
        defines: points ? { POINTS: '' } : {},
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          uPos: { value: resolvedPos },
          uPrev: { value: resolvedPrev },
          uColor: { value: resolvedColor },
          uResolution: this.uniforms.uResolution,
          uPx: this.uniforms.uPx,
          uFocus: this.uniforms.uFocus,
          uAperture: this.uniforms.uAperture,
          uMaxCoc: this.uniforms.uMaxCoc,
          uMaxLen: this.uniforms.uMaxLen,
          uFloorY: this.uniforms.uFloorY,
          uTone2A: this.uniforms.uTone2A,
          uTone2B: this.uniforms.uTone2B,
          uShapeA: this.uniforms.uShapeA,
          uShapeB: this.uniforms.uShapeB,
          uMirror: { value: mirror },
          uMaxPoint: { value: this.maxPoint },
          uCrowd: { value: this.crowdTarget.texture },
          uCrowdScale: this.crowdScale,
          uCrowdDepth: { value: CROWD_DEPTH },
          uCrowdCeil: { value: CROWD_CEILING / CROWD_DEPTH },
        },
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        transparent: true,
      })
    this.materials = [make(0, false), make(1, false), make(0, true), make(1, true)]
    this.mesh = new THREE.Mesh(geometry, this.materials[0])
    this.mirror = new THREE.Mesh(geometry, this.materials[1])

    // round grains (a look with no streak) as one vertex each instead of a four-corner quad;
    // the cell coordinate doubles as the position attribute, which only sets the vertex count
    this.pointGeometry = new THREE.BufferGeometry()
    this.pointGeometry.setAttribute('position', new THREE.BufferAttribute(refs, 2))
    this.pointGeometry.setAttribute('ref', new THREE.BufferAttribute(refs, 2))
    // never culled, and its bounds cannot be computed from cell coordinates
    this.pointGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    this.points = new THREE.Points(this.pointGeometry, this.materials[2])
    this.mirrorPoints = new THREE.Points(this.pointGeometry, this.materials[3])
    for (const m of [this.mesh, this.mirror, this.points, this.mirrorPoints]) {
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
    // a look without streaks draws round grains, one vertex each as a point sprite; streaks
    // need the oriented quad (a sprite around a long streak would shade a square of nothing)
    const round = this.lookA.streak === 0 && (this.lookB ?? this.lookA).streak === 0 && this.maxPoint >= POINT_SPRITES_FROM
    const floor = this.floorY !== null
    this.mesh.visible = !round
    this.mirror.visible = floor && !round
    this.points.visible = round
    this.mirrorPoints.visible = floor && round
    this.sync(dt, time)
    this.resolve()
    this.countCrowd(camera, width, height)
  }

  /** count where the particles land on screen, so the draw can thin the places they pile up */
  private countCrowd(camera: THREE.PerspectiveCamera, width: number, height: number) {
    const sampled = crowdSide(this.size)
    this.crowdMaterial.uniforms.uCellArea.value = Math.max((width / CROWD_GRID) * (height / CROWD_GRID), 1e-6)
    this.crowdScale.value = this.count / (sampled * sampled)
    const r = this.renderer
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    const alpha = r.getClearAlpha()
    r.getClearColor(this.clearColor)
    r.setClearColor(0x000000, 0)
    r.autoClear = true
    r.setRenderTarget(this.crowdTarget)
    r.render(this.crowdScene, camera)
    r.setRenderTarget(saved)
    r.setClearColor(this.clearColor, alpha)
    r.autoClear = autoClear
  }

  dispose(): void {
    this.geometry.dispose()
    for (const m of this.materials) m.dispose()
    this.pointGeometry.dispose()
    this.bakeMaterial.dispose()
    this.white.dispose()
    for (const t of this.bakeTargets) t.dispose()
    this.resolveMaterial.dispose()
    this.resolveTarget.dispose()
    this.crowdTarget.dispose()
    this.crowdMaterial.dispose()
    this.crowdGeometry.dispose()
  }

  private resolve() {
    const r = this.renderer
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(this.resolveTarget)
    r.render(this.resolveScene, this.bakeCamera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
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
    ;(u[`uTone2${slot}`].value as THREE.Vector4).set(look.toneBias, look.toneScale, look.minPx * this.renderer.getPixelRatio(), look.soft)
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
      soft: mix(a.soft, b.soft),
    }
  }
}
