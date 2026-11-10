/**
 * A piece of the complex plane laid in the world as a luminous relief: the Mandelbrot set, or
 * the Julia set of one constant c.
 *
 * The display is the film's own: the interior is a black mirror; outside, every point glows by
 * how close it lies to the set, bone at the boundary falling through the act's ramp to its cold
 * end and then to nothing, so the plane has no visible edge. Closeness is measured in world
 * units on the plane (the distance estimate divided by the view's scale), so the glow looks the
 * same at every depth of zoom.
 *
 * The work is cached in the plane's own texture space, not the screen's, so the camera can
 * drift and orbit for free:
 *
 *   iterate  only when the view (or c, or the budget) changes. While it keeps changing (a
 *            flight, a glide of c) a low-resolution pass runs every frame, sized to the frame
 *            time; once it settles, the full-resolution pass is drawn in strips over a few
 *            frames, so even a 2000-iteration deep view never stalls a frame.
 *   shade    the encoded escape data → premultiplied colour, into a mipmapped half-float
 *            texture: cheap, redone when the iteration or a look uniform changes.
 *   display  one trilinear, anisotropic fetch per pixel: smooth at any angle and distance.
 *
 * The Mandelbrot iteration is the old deep-zoom code (perturbation around a double-precision
 * reference orbit with rebasing, `fractal/mandel/shaders.ts`), copied here with a new encoding.
 */
import * as THREE from 'three'
import { rampGlsl, type Palette } from '../../engine/palettes'
import { MAX_ITER, ORBIT_CAPACITY, ORBIT_TEXELS, computeReferenceOrbit, maxIterForScale } from '../../fractal/mandel/orbit'

/** a view of the plane: centre, and complex units per world unit (smaller = deeper) */
export interface PlaneView {
  cx: number
  cy: number
  scale: number
}

const JULIA_ITER = 600

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Encoding, one float per texel (0 = no data, −1 = did not escape):
 *   1 + q·256 + m   q (0..63): log₂ of the distance to the set in world units, from 2⁻¹² to 2³
 *                   m (0..255): the phase of log₂ of the smooth escape count, for faint banding
 */
const commonGlsl = /* glsl */ `
uniform float uEscape2;  // escape radius squared (256 for smooth shading; 4 shows the classic level sets)
uniform vec2 uSpan;      // complex size of the whole plane
uniform float uUnit;     // complex units per world unit
uniform vec2 uUvScale;   // the pass draws into this fraction of its target
uniform float uBandFreq; // bands per doubling of the escape count
varying vec2 vUv;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

float encodeEscape(float n, float r2, vec2 der) {
  float lz = 0.5 * log(r2);
  float mu = max(n + 1.0 - log2(lz), 1.0);
  float dl = length(der);
  float de = dl < 1e30 ? sqrt(r2) * lz / dl : 0.0;
  float L = de > 0.0 ? log2(de / uUnit) : -40.0;
  float q = floor(clamp((L + 12.0) / 15.0, 0.0, 1.0) * 63.0 + 0.5);
  float m = floor(fract(log2(mu) * uBandFreq) * 255.0);
  return 1.0 + q * 256.0 + m;
}

float iterate(vec2 p);

void main() {
  vec2 uv = vUv / uUvScale;
  if (uv.x > 1.0 || uv.y > 1.0) discard;
  gl_FragColor = vec4(iterate((uv - 0.5) * uSpan), 0.0, 0.0, 1.0);
}
`

const mandelFrag = /* glsl */ `
#define MAX_ITER ${MAX_ITER}
#define ORBIT_TEXELS ${ORBIT_TEXELS.toFixed(1)}
${commonGlsl}
uniform sampler2D uOrbit;  // Z_0..Z_M, two entries per texel
uniform float uRefLen;
uniform float uMaxIter;
uniform vec2 uRef;         // the reference point (float; only for the shallow-view shortcut)
uniform float uShallow;    // 1: the main cardioid and the period-2 disc are known to be inside

vec2 orbitAt(float m) {
  float k = floor(m * 0.5);
  vec4 t = texture2DLodEXT(uOrbit, vec2((k + 0.5) / ORBIT_TEXELS, 0.5), 0.0);
  return m - 2.0 * k < 0.5 ? t.xy : t.zw;
}

float iterate(vec2 dc) {
  if (uShallow > 0.5 && uEscape2 > 5.0) {
    vec2 c = uRef + dc;
    float x = c.x - 0.25;
    float q = x * x + c.y * c.y;
    if (q * (q + x) < 0.25 * c.y * c.y) return -1.0;
    if ((c.x + 1.0) * (c.x + 1.0) + c.y * c.y < 0.0625) return -1.0;
  }
  vec2 Z = vec2(0.0);
  vec2 d = vec2(0.0);
  vec2 z = vec2(0.0);
  vec2 der = vec2(0.0);
  float m = 0.0;
  for (int n = 1; n <= MAX_ITER; n++) {
    if (float(n) > uMaxIter) break;
    der = 2.0 * cmul(z, der) + vec2(1.0, 0.0);
    d = cmul(2.0 * Z + d, d) + dc;
    m += 1.0;
    Z = orbitAt(m);
    z = Z + d;
    float r2 = dot(z, z);
    if (r2 > uEscape2) return encodeEscape(float(n), r2, der);
    if (r2 < dot(d, d) || m >= uRefLen) {
      d = z;
      m = 0.0;
      Z = vec2(0.0);
    }
  }
  return -1.0;
}
`

const juliaFrag = /* glsl */ `
#define JULIA_ITER ${JULIA_ITER}
${commonGlsl}
uniform vec2 uC;
uniform vec2 uCentre;

float iterate(vec2 z) {
  z += uCentre;
  vec2 der = vec2(1.0, 0.0);
  for (int n = 1; n <= JULIA_ITER; n++) {
    der = 2.0 * cmul(z, der);
    z = cmul(z, z) + uC;
    float r2 = dot(z, z);
    if (r2 > uEscape2) return encodeEscape(float(n), r2, der);
  }
  return -1.0;
}
`

const shadeFrag = /* glsl */ `
${rampGlsl}
uniform sampler2D uData;
uniform vec2 uDataScale;  // the part of the data target that holds the picture
uniform vec2 uDataSize;   // the data target's size in texels
uniform vec3 uRamp[5];
uniform float uGlow;      // the escape-time light outside the set
uniform float uRim;       // the hairline on the boundary
uniform float uBase;      // a pool of dim light outside the set (the floor the set is cut out of)
uniform float uInterior;  // opacity of the black interior
uniform float uReach;     // how far the glow reaches: its decay length, world units
uniform float uFine;      // narrows the bright core (log2 units): deep views are thick with filaments
uniform float uBand;      // depth of the escape-time banding
uniform vec2 uAspect;
uniform vec2 uViewC;      // complex centre (shallow views only: for the lit bulbs)
uniform vec2 uViewSpan;
uniform vec3 uLit;        // light inside the main cardioid, the period-2 disc, the period-4 bud
uniform float uLitOn;
varying vec2 vUv;

vec3 ramp(float t) {
  return ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], t);
}

vec2 csqrt(vec2 z) {
  float r = length(z);
  float x = sqrt(max(0.0, 0.5 * (r + z.x)));
  float y = sqrt(max(0.0, 0.5 * (r - z.x)));
  return vec2(x, z.y < 0.0 ? -y : y);
}

// premultiplied colour and coverage of one encoded sample
vec4 shade(float v, float pool) {
  if (v < 0.0) return vec4(0.0, 0.0, 0.0, uInterior);
  if (abs(v) < 0.5) return vec4(0.0);
  float w = v - 1.0;
  float q = floor(w / 256.0);
  float m = w - q * 256.0;
  float L = q / 63.0 * 15.0 - 12.0;      // log2 of the distance to the set, world units
  // a bone-white hairline on the boundary, a teal glow falling away to nothing
  float d = exp2(L);
  float core = 1.0 - smoothstep(-10.5 - uFine, -8.4 - uFine, L);
  float halo = exp(-d / uReach);
  float band = 1.0 - uBand + uBand * (0.5 + 0.5 * cos(6.2831853 * m / 255.0));
  vec3 c = ramp(0.12 + 0.7 * halo) * (uGlow * halo * band * 0.62);
  c += ramp(0.96) * (uGlow * core * 0.75);
  float rim = 1.0 - smoothstep(-10.5, -8.2, L);
  c += ramp(0.97) * (uRim * rim * 0.5);
  c += ramp(0.36) * (pool * 0.4);
  float a = clamp(uGlow * (halo * 0.85 + core) + uRim * rim + pool * 0.9, 0.0, 1.0);
  return vec4(c, a);
}

vec4 tap(vec2 ij, float pool) {
  return shade(texture2D(uData, (ij + 0.5) / uDataSize).x, pool);
}

void main() {
  float r0 = length((vUv - 0.5) * 2.0 * uAspect);
  float pool = uBase * exp(-r0 * r0 * 2.2);
  // bilinear over the shaded neighbours (one tap when the data is full resolution)
  vec2 p = vUv * uDataScale * uDataSize - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec4 c = vec4(0.0);
  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;
  if (w00 > 0.001) c += w00 * tap(i, pool);
  if (w10 > 0.001) c += w10 * tap(i + vec2(1.0, 0.0), pool);
  if (w01 > 0.001) c += w01 * tap(i + vec2(0.0, 1.0), pool);
  if (w11 > 0.001) c += w11 * tap(i + vec2(1.0, 1.0), pool);
  c /= max(0.001, (w00 > 0.001 ? w00 : 0.0) + (w10 > 0.001 ? w10 : 0.0) + (w01 > 0.001 ? w01 : 0.0) + (w11 > 0.001 ? w11 : 0.0));

  if (uLitOn > 0.5) {
    vec2 cc = uViewC + (vUv - 0.5) * uViewSpan;
    // how strongly each named bulb's rhythm holds here: |multiplier| of its cycle (1 on its rim)
    float m1 = length(vec2(1.0, 0.0) - csqrt(vec2(1.0, 0.0) - 4.0 * cc));
    float m2 = 4.0 * length(cc + vec2(1.0, 0.0));
    float m4 = length(cc - vec2(-1.3107, 0.0)) / 0.0568;
    vec3 m = vec3(m1, m2, m4);
    vec3 inside = vec3(1.0) - smoothstep(vec3(0.985), vec3(1.0), m);
    vec3 lift = inside * uLit * (0.1 + 0.9 * pow(clamp(m, 0.0, 1.0), vec3(6.0)));
    float l = lift.x + lift.y + lift.z;
    c.rgb += ramp(0.3 + 0.5 * l) * (l * 0.3) * c.a;
  }
  gl_FragColor = c;
}
`

const displayVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const displayFrag = /* glsl */ `
uniform sampler2D uColor;
uniform float uOpacity;
uniform vec2 uEdge;
uniform vec2 uAspect;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uColor, vUv);
  float r = length((vUv - 0.5) * 2.0 * uAspect);
  float edge = 1.0 - smoothstep(uEdge.x, uEdge.y, r);
  gl_FragColor = c * (edge * uOpacity);
}
`

/** frame times that move the low-resolution pass's size */
const SLOW = 1 / 45
const FAST = 1 / 57
/** seconds of no change before the full-resolution pass begins */
const SETTLE = 0.12

function dataTarget(w: number, h: number) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.FloatType,
    format: THREE.RedFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  })
}

export interface ComplexPlaneOptions {
  /** texels per world unit of the full-resolution cache */
  density?: number
}

export class ComplexPlane {
  readonly mesh: THREE.Mesh
  readonly kind: 'mandel' | 'julia'
  /** the view shown; change it freely, the plane redraws when it changes */
  readonly view: PlaneView
  /** the Julia constant */
  readonly c = new THREE.Vector2(-0.123, 0.745)
  /** iteration budget; null follows the zoom depth */
  maxIter: number | null = null
  readonly width: number
  readonly height: number
  /** look uniforms: tween their values */
  readonly uniforms: {
    uOpacity: THREE.IUniform<number>
    uGlow: THREE.IUniform<number>
    uRim: THREE.IUniform<number>
    uBase: THREE.IUniform<number>
    uInterior: THREE.IUniform<number>
    uReach: THREE.IUniform<number>
    uFine: THREE.IUniform<number>
    uBand: THREE.IUniform<number>
    uEdge: THREE.IUniform<THREE.Vector2>
    uEscape2: THREE.IUniform<number>
    uLit: THREE.IUniform<THREE.Vector3>
  }

  private readonly renderer: THREE.WebGLRenderer
  private readonly hi: THREE.WebGLRenderTarget
  private readonly lo: THREE.WebGLRenderTarget
  private readonly color: THREE.WebGLRenderTarget
  private readonly iterMaterial: THREE.ShaderMaterial
  private readonly shadeMaterial: THREE.ShaderMaterial
  private readonly displayMaterial: THREE.ShaderMaterial
  private readonly geometry: THREE.PlaneGeometry
  private readonly quad: THREE.Mesh
  private readonly quadScene = new THREE.Scene()
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly orbit: THREE.DataTexture | null = null
  private readonly orbitData: Float32Array | null = null
  private readonly span = new THREE.Vector2()

  private last = { cx: NaN, cy: NaN, scale: NaN, iter: -1, jx: NaN, jy: NaN, esc: NaN }
  /** look uniforms as last shaded */
  private lookKey = ''
  /** seconds since the inputs last changed */
  private still = 0
  /** low-resolution pass size, fraction of the low target */
  private loScale = 1
  /** the full-resolution pass: next row to draw, rows per frame */
  private row = 0
  private rows = 48
  private hiDone = false
  private showing: 'lo' | 'hi' | 'none' = 'none'

  constructor(renderer: THREE.WebGLRenderer, palette: Palette, kind: 'mandel' | 'julia', width: number, height: number, view: PlaneView, opts: ComplexPlaneOptions = {}) {
    this.renderer = renderer
    this.kind = kind
    this.width = width
    this.height = height
    this.view = { ...view }
    const density = opts.density ?? 400
    const maxTex = Math.min(4096, renderer.capabilities.maxTextureSize)
    const hiW = Math.min(maxTex, Math.round(width * density))
    const hiH = Math.min(maxTex, Math.round(height * density))
    this.hi = dataTarget(hiW, hiH)
    this.lo = dataTarget(Math.ceil(hiW / 2), Math.ceil(hiH / 2))
    this.color = new THREE.WebGLRenderTarget(hiW, hiH, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
      anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    })

    if (kind === 'mandel') {
      this.orbitData = new Float32Array(ORBIT_CAPACITY * 2)
      const t = new THREE.DataTexture(this.orbitData, ORBIT_TEXELS, 1, THREE.RGBAFormat, THREE.FloatType)
      t.minFilter = THREE.NearestFilter
      t.magFilter = THREE.NearestFilter
      t.generateMipmaps = false
      t.needsUpdate = true
      this.orbit = t
    }

    const escape = { value: 256 }
    const common = {
      uEscape2: escape,
      uSpan: { value: this.span },
      uUnit: { value: view.scale },
      uUvScale: { value: new THREE.Vector2(1, 1) },
      uBandFreq: { value: kind === 'mandel' ? 0.85 : 2.6 },
    }
    this.iterMaterial = new THREE.ShaderMaterial({
      name: `${kind}.iterate`,
      vertexShader: quadVert,
      fragmentShader: kind === 'mandel' ? mandelFrag : juliaFrag,
      uniforms:
        kind === 'mandel'
          ? { ...common, uOrbit: { value: this.orbit }, uRefLen: { value: 1 }, uMaxIter: { value: 200 }, uRef: { value: new THREE.Vector2() }, uShallow: { value: 1 } }
          : { ...common, uC: { value: this.c }, uCentre: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    })

    const short = Math.min(width, height)
    const aspect = new THREE.Vector2(width / short, height / short)
    this.uniforms = {
      uOpacity: { value: 1 },
      uGlow: { value: 1 },
      uRim: { value: 1 },
      uBase: { value: 0 },
      uInterior: { value: 1 },
      uReach: { value: 0.075 },
      uFine: { value: 0 },
      uBand: { value: 0.4 },
      uEdge: { value: new THREE.Vector2(0.62, 0.98) },
      uEscape2: escape,
      uLit: { value: new THREE.Vector3() },
    }
    this.shadeMaterial = new THREE.ShaderMaterial({
      name: `${kind}.shade`,
      vertexShader: quadVert,
      fragmentShader: shadeFrag,
      uniforms: {
        uData: { value: null },
        uDataScale: { value: new THREE.Vector2(1, 1) },
        uDataSize: { value: new THREE.Vector2(1, 1) },
        uRamp: { value: palette.ramp.map((c) => c.clone()) },
        uGlow: this.uniforms.uGlow,
        uRim: this.uniforms.uRim,
        uBase: this.uniforms.uBase,
        uInterior: this.uniforms.uInterior,
        uReach: this.uniforms.uReach,
        uFine: this.uniforms.uFine,
        uBand: this.uniforms.uBand,
        uAspect: { value: aspect },
        uViewC: { value: new THREE.Vector2() },
        uViewSpan: { value: new THREE.Vector2() },
        uLit: this.uniforms.uLit,
        uLitOn: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.displayMaterial = new THREE.ShaderMaterial({
      name: `${kind}.display`,
      vertexShader: displayVert,
      fragmentShader: displayFrag,
      uniforms: {
        uColor: { value: this.color.texture },
        uOpacity: this.uniforms.uOpacity,
        uEdge: this.uniforms.uEdge,
        uAspect: { value: aspect },
      },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.iterMaterial)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
    this.geometry = new THREE.PlaneGeometry(width, height)
    this.mesh = new THREE.Mesh(this.geometry, this.displayMaterial)
    this.mesh.renderOrder = 4
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /** set the ramp (the act's colours) */
  setPalette(p: Palette) {
    const r = this.shadeMaterial.uniforms.uRamp.value as THREE.Color[]
    p.ramp.forEach((c, i) => r[i].copy(c))
    this.lookKey = ''
  }

  /** the iteration budget in use */
  get iterations(): number {
    return this.kind === 'julia' ? JULIA_ITER : this.last.iter
  }

  /** the full-resolution picture is complete */
  get settled(): boolean {
    return this.hiDone
  }

  /** once per frame, before the frame is drawn; `realDt` (wall-clock) measures the GPU's pace */
  update(dt: number, realDt: number) {
    if (this.prepare()) {
      this.still = 0
      this.hiDone = false
      this.row = 0
      // a flight in progress: keep the low pass's cost near the frame budget
      if (realDt > SLOW) this.loScale = Math.max(0.4, this.loScale * 0.92)
      else if (realDt < FAST) this.loScale = Math.min(1, this.loScale * 1.04)
      this.iterate(this.lo, this.loScale, 0, this.lo.height)
      this.showing = 'lo'
      this.shade()
    } else {
      this.still += realDt
      if (!this.hiDone && this.still >= SETTLE) this.refine(realDt)
      else if (this.lookChanged()) this.shade()
    }
    this.mesh.visible = this.uniforms.uOpacity.value > 0.001 && this.showing !== 'none'
  }

  /** inputs → iteration uniforms; true when the picture must be recomputed */
  private prepare(): boolean {
    const v = this.view
    const it = this.iterMaterial.uniforms
    let changed = false
    if (this.kind === 'mandel' && this.orbitData && this.orbit) {
      const iter = Math.max(1, Math.round(this.maxIter ?? maxIterForScale(v.scale * 1.2)))
      if (v.cx !== this.last.cx || v.cy !== this.last.cy || iter !== this.last.iter) {
        it.uRefLen.value = computeReferenceOrbit(v.cx, v.cy, iter, this.orbitData)
        it.uMaxIter.value = iter
        ;(it.uRef.value as THREE.Vector2).set(v.cx, v.cy)
        this.orbit.needsUpdate = true
        this.last.cx = v.cx
        this.last.cy = v.cy
        this.last.iter = iter
        changed = true
      }
      it.uShallow.value = v.scale > 0.05 ? 1 : 0
    } else if (this.c.x !== this.last.jx || this.c.y !== this.last.jy || v.cx !== this.last.cx || v.cy !== this.last.cy) {
      this.last.jx = this.c.x
      this.last.jy = this.c.y
      this.last.cx = v.cx
      this.last.cy = v.cy
      ;(it.uCentre.value as THREE.Vector2).set(v.cx, v.cy)
      changed = true
    }
    if (this.uniforms.uEscape2.value !== this.last.esc) {
      this.last.esc = this.uniforms.uEscape2.value
      changed = true
    }
    if (v.scale !== this.last.scale) {
      this.last.scale = v.scale
      it.uUnit.value = v.scale
      changed = true
    }
    this.span.set(v.scale * this.width, v.scale * this.height)
    const s = this.shadeMaterial.uniforms
    ;(s.uViewC.value as THREE.Vector2).set(v.cx, v.cy)
    ;(s.uViewSpan.value as THREE.Vector2).copy(this.span)
    s.uLitOn.value = this.kind === 'mandel' && v.scale > 0.05 && this.uniforms.uLit.value.lengthSq() > 0 ? 1 : 0
    return changed
  }

  private lookChanged(): boolean {
    const u = this.uniforms
    const key = `${u.uGlow.value}|${u.uRim.value}|${u.uBase.value}|${u.uInterior.value}|${u.uReach.value}|${u.uFine.value}|${u.uBand.value}|${u.uLit.value.x}|${u.uLit.value.y}|${u.uLit.value.z}`
    if (key === this.lookKey) return false
    this.lookKey = key
    return true
  }

  /** draw rows [y0, y1) of `target` (in full-size rows) at `scale` of its size */
  private iterate(target: THREE.WebGLRenderTarget, scale: number, y0: number, y1: number) {
    const w = Math.max(1, Math.round(target.width * scale))
    const h = Math.max(1, Math.round(target.height * scale))
    ;(this.iterMaterial.uniforms.uUvScale.value as THREE.Vector2).set(w / target.width, h / target.height)
    target.viewport.set(0, 0, target.width, target.height)
    const s0 = Math.floor(y0 * scale)
    target.scissor.set(0, s0, w, Math.max(1, Math.min(h, Math.ceil(y1 * scale)) - s0))
    target.scissorTest = true
    this.quad.material = this.iterMaterial
    this.pass(target)
    target.scissorTest = false
  }

  /** the full-resolution pass, a strip per frame sized to the frame time */
  private refine(realDt: number) {
    if (this.row > 0) {
      if (realDt > 1 / 50) this.rows = Math.max(8, Math.floor(this.rows * 0.7))
      else if (realDt < 1 / 58) this.rows = Math.min(this.hi.height, Math.ceil(this.rows * 1.25))
    }
    const y1 = Math.min(this.hi.height, this.row + this.rows)
    this.iterate(this.hi, 1, this.row, y1)
    this.row = y1
    if (this.row >= this.hi.height) {
      this.hiDone = true
      this.showing = 'hi'
      this.shade()
    } else if (this.lookChanged()) {
      this.shade()
    }
  }

  private shade() {
    const s = this.shadeMaterial.uniforms
    const hi = this.showing === 'hi'
    const src = hi ? this.hi : this.lo
    const scale = hi ? 1 : this.loScale
    s.uData.value = src.texture
    const w = Math.max(1, Math.round(src.width * scale))
    const h = Math.max(1, Math.round(src.height * scale))
    ;(s.uDataScale.value as THREE.Vector2).set(w / src.width, h / src.height)
    ;(s.uDataSize.value as THREE.Vector2).set(src.width, src.height)
    this.quad.material = this.shadeMaterial
    this.pass(this.color)
    this.lookChanged()
  }

  private pass(target: THREE.WebGLRenderTarget) {
    const r = this.renderer
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    const xr = r.xr.enabled
    r.autoClear = false
    r.xr.enabled = false
    r.setRenderTarget(target)
    r.render(this.quadScene, this.quadCamera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
    r.xr.enabled = xr
  }

  /** world position of the complex point (re, im) on the plane */
  toWorld(re: number, im: number, out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.view
    this.mesh.updateWorldMatrix(true, false)
    return out.set((re - v.cx) / v.scale, (im - v.cy) / v.scale, 0).applyMatrix4(this.mesh.matrixWorld)
  }

  /** the complex point under a world position on the plane */
  toComplex(world: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    const v = this.view
    this.mesh.updateWorldMatrix(true, false)
    const local = world.clone().applyMatrix4(this.mesh.matrixWorld.clone().invert())
    return out.set(v.cx + local.x * v.scale, v.cy + local.y * v.scale)
  }

  /** where a ray meets the plane (null if it runs parallel or away) */
  hit(ray: THREE.Ray, out = new THREE.Vector3()): THREE.Vector3 | null {
    this.mesh.updateWorldMatrix(true, false)
    const n = new THREE.Vector3(0, 0, 1).transformDirection(this.mesh.matrixWorld)
    const o = new THREE.Vector3().setFromMatrixPosition(this.mesh.matrixWorld)
    return ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, o), out)
  }

  dispose() {
    this.hi.dispose()
    this.lo.dispose()
    this.color.dispose()
    this.iterMaterial.dispose()
    this.shadeMaterial.dispose()
    this.displayMaterial.dispose()
    this.geometry.dispose()
    this.quad.geometry.dispose()
    this.orbit?.dispose()
  }
}
