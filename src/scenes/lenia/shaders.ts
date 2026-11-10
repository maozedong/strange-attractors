/**
 * Shaders for the Lenia stage. GLSL ES 1.0 style (three maps texture2D / texture2DLodEXT /
 * gl_FragColor to GLSL ES 3.0 on WebGL 2). Every loop has constant bounds.
 *
 * Simulation passes run on a full-screen quad (fullscreenVert) into float targets with
 * NearestFilter and RepeatWrapping, so a fetch at a texel centre returns that cell exactly and
 * offsets past an edge wrap around (the grid is a torus). gl_FragCoord.xy is the cell centre
 * (x + 0.5, y + 0.5), origin bottom-left = texture row 0 = grid row 0.
 */
import { rampGlsl } from '../../engine/palettes'
import { KERNEL_DIAMETER, KERNEL_RADIUS } from '../../world/lenia/core'

/** Simulation grid edge, cells. */
export const LENIA_GRID = 256
/** Telemetry downsample edge: each texel sums a (LENIA_GRID / TELE_GRID)² block. */
export const TELE_GRID = 32
/** Glow texture edge (half-float, linear filtered). */
export const HALO_GRID = 64

const f = (x: number) => x.toFixed(1)

/**
 * One Lenia generation. The kernel lives in a KERNEL_DIAMETER² R32F texture (weights sum to
 * 1, zero beyond the species' radius). Zero taps are skipped; the test is on a value every
 * fragment shares, so the branch is uniform. Fetches use an explicit LOD so no compiler has
 * to unroll the 729-tap loop to compute gradients (ANGLE on D3D would).
 */
export const stepFrag = /* glsl */ `
uniform sampler2D uState;
uniform sampler2D uKernel;
uniform float uM;
uniform float uS;
uniform float uDt;

const int DIAM = ${KERNEL_DIAMETER};
const float RADIUS = ${f(KERNEL_RADIUS)};
const float INV_DIAM = 1.0 / ${f(KERNEL_DIAMETER)};
const float INV_N = 1.0 / ${f(LENIA_GRID)};

void main() {
  vec2 p = floor(gl_FragCoord.xy) + 0.5;
  float u = 0.0;
  for (int j = 0; j < DIAM; j++) {
    float ky = (float(j) + 0.5) * INV_DIAM;
    float dy = float(j) - RADIUS;
    for (int i = 0; i < DIAM; i++) {
      float w = texture2DLodEXT(uKernel, vec2((float(i) + 0.5) * INV_DIAM, ky), 0.0).r;
      if (w > 0.0) {
        u += w * texture2DLodEXT(uState, (p + vec2(float(i) - RADIUS, dy)) * INV_N, 0.0).r;
      }
    }
  }
  float a = texture2DLodEXT(uState, p * INV_N, 0.0).r;
  float z = (u - uM) / uS;
  float g = 2.0 * exp(-0.5 * z * z) - 1.0;
  gl_FragColor = vec4(clamp(a + uDt * g, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`

/** Copy an uploaded field (R channel) into a state target. */
export const copyFrag = /* glsl */ `
uniform sampler2D uSrc;
const float INV_N = 1.0 / ${f(LENIA_GRID)};
void main() {
  float a = texture2DLodEXT(uSrc, (floor(gl_FragCoord.xy) + 0.5) * INV_N, 0.0).r;
  gl_FragColor = vec4(clamp(a, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`

const BLOCK = LENIA_GRID / TELE_GRID

/** Telemetry: each TELE_GRID² texel holds R = sum of its BLOCK² cells, G = their maximum. */
export const reduceFrag = /* glsl */ `
uniform sampler2D uState;
const int BLOCK = ${BLOCK};
const float INV_N = 1.0 / ${f(LENIA_GRID)};
void main() {
  vec2 base = floor(gl_FragCoord.xy) * ${f(BLOCK)} + 0.5;
  float sum = 0.0;
  float peak = 0.0;
  for (int j = 0; j < BLOCK; j++) {
    for (int i = 0; i < BLOCK; i++) {
      float a = texture2DLodEXT(uState, (base + vec2(float(i), float(j))) * INV_N, 0.0).r;
      sum += a;
      peak = max(peak, a);
    }
  }
  gl_FragColor = vec4(sum, peak, 0.0, 1.0);
}
`

/**
 * The field as displayed: the previous generation blended toward the current one by uMix
 * (the fraction of a generation the clock has run past the previous step), so motion is
 * continuous at any speed. Written to a half-float target the display samples with hardware
 * bilinear filtering (float32 targets are not filterable everywhere).
 */
export const lookFrag = /* glsl */ `
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform float uMix;
const float INV_N = 1.0 / ${f(LENIA_GRID)};
void main() {
  vec2 uv = (floor(gl_FragCoord.xy) + 0.5) * INV_N;
  float a0 = texture2DLodEXT(uPrev, uv, 0.0).r;
  float a1 = texture2DLodEXT(uCur, uv, 0.0).r;
  gl_FragColor = vec4(mix(a0, a1, uMix), 0.0, 0.0, 1.0);
}
`

/**
 * Glow source: a HALO_GRID² blur of the displayed field. Each texel averages a 4 × 4 grid of
 * bilinear taps spread over 1.5 halo texels (≈ 6 cells), weighted by a small Gaussian; the
 * display's own bilinear upsampling smooths it further.
 */
export const haloFrag = /* glsl */ `
uniform sampler2D uLook;
const float INV_H = 1.0 / ${f(HALO_GRID)};
void main() {
  vec2 c = (floor(gl_FragCoord.xy) + 0.5) * INV_H;
  float sum = 0.0;
  float wsum = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(float(i) - 1.5, float(j) - 1.5) * 0.5;
      float w = exp(-dot(o, o) * 1.2);
      sum += w * texture2DLodEXT(uLook, c + o * INV_H, 0.0).r;
      wsum += w;
    }
  }
  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}
`

/** A soft hole in the field, for poke(): state × mix(keep, 1, smoothstep(0, r, distance)), periodic. */
export const pokeFrag = /* glsl */ `
uniform sampler2D uState;
uniform vec2 uAt;
uniform float uRadius;
uniform float uKeep;
const float N = ${f(LENIA_GRID)};
void main() {
  vec2 p = floor(gl_FragCoord.xy) + 0.5;
  vec2 d = p - uAt;
  d -= N * floor(d / N + 0.5);
  float k = mix(uKeep, 1.0, smoothstep(0.0, uRadius, length(d)));
  float a = texture2DLodEXT(uState, p / N, 0.0).r;
  gl_FragColor = vec4(a * k, 0.0, 0.0, 1.0);
}
`

/** The pond: a plane on the floor. uv (0, 0) is grid cell (0, 0). */
export const displayVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

/**
 * The pond. Two fields can be shown: the Game of Life (a coarse grid uploaded from the CPU,
 * drawn as hard squares or, as uSmooth rises, as soft blobs that flow from one generation to
 * the next) and Lenia (the simulation's display texture). uLenia cross-fades between them.
 * Life glows in the hot end of the act's ramp with a soft halo; the water is dark; the pond's
 * edge dissolves into the floor (which also hides the wrap-around of the torus).
 *
 * Both fields are read with a cubic B-spline built from four bilinear taps (Sigg & Hadwiger,
 * GPU Gems 2 ch. 20), as the old display did.
 */
export const displayFrag = /* glsl */ `
uniform sampler2D uLook;
uniform sampler2D uHalo;
uniform sampler2D uLife;
uniform sampler2D uLifePrev;
uniform float uLifeN;
uniform float uLifeMix;   // 0..1 through the current Life generation
uniform float uSmooth;    // 0 = hard squares, 1 = smooth flowing blobs
uniform float uLenia;     // 0 = Life, 1 = Lenia
uniform float uOpacity;
uniform vec3 uRamp[5];
uniform vec3 uCamPos;
varying vec2 vUv;
varying vec3 vWorld;
${rampGlsl}

vec3 ramp(float t) {
  return ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], t);
}

vec4 bspline(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 c = n * n * n;
  float x = c.x;
  float y = c.y - 4.0 * c.x;
  float z = c.z - 4.0 * c.y + 6.0 * c.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}

float bicubic(sampler2D t, vec2 uv, float size) {
  vec2 p = uv * size - 0.5;
  vec2 f = fract(p);
  p -= f;
  vec4 wx = bspline(f.x);
  vec4 wy = bspline(f.y);
  vec4 c = p.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(wx.xz + wx.yw, wy.xz + wy.yw);
  vec4 o = (c + vec4(wx.yw, wy.yw) / s) / size;
  float a = texture2D(t, o.xz).r;
  float b = texture2D(t, o.yz).r;
  float d = texture2D(t, o.xw).r;
  float e = texture2D(t, o.yw).r;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(e, d, sx), mix(b, a, sx), sy);
}

// Catmull-Rom over 4 × 4 texel centres: interpolating, so a creature keeps its edges up close
vec4 crWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}

float catmullRom(sampler2D tex, vec2 uv, float size) {
  vec2 p = uv * size - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec4 wx = crWeights(f.x);
  vec4 wy = crWeights(f.y);
  float sum = 0.0;
  for (int y = 0; y < 4; y++) {
    float row = 0.0;
    for (int x = 0; x < 4; x++) {
      row += wx[x] * texture2D(tex, (i + vec2(float(x) - 0.5, float(y) - 0.5)) / size).r;
    }
    sum += wy[y] * row;
  }
  return sum;
}

void main() {
  // the pond's edge: gone well before the wrap-around
  float r = length(vUv - 0.5) * 2.0;
  float pond = 1.0 - smoothstep(0.5, 0.94, r);
  if (pond <= 0.0) discard;

  float a = 0.0;
  float h = 0.0;
  float grid = 0.0;
  if (uLenia < 0.999) {
    // the Game of Life: hard squares with a hairline between them, or soft flowing blobs
    vec2 lp = vUv * uLifeN;
    vec2 cell = floor(lp);
    vec2 f = lp - cell;
    float alive = texture2D(uLife, (cell + 0.5) / uLifeN).r;
    vec2 fw = fwidth(lp);
    vec2 edge = smoothstep(vec2(0.0), fw * 1.5, f) * smoothstep(vec2(0.0), fw * 1.5, 1.0 - f);
    float inside = edge.x * edge.y;
    float hard = alive * inside;
    float soft0 = bicubic(uLifePrev, vUv, uLifeN);
    float soft1 = bicubic(uLife, vUv, uLifeN);
    float soft = smoothstep(0.08, 0.7, mix(soft0, soft1, uLifeMix));
    float life = mix(hard, soft, uSmooth);
    grid = (1.0 - inside) * (1.0 - uSmooth);
    a = life * (1.0 - uLenia);
    h = soft * 0.7 * (1.0 - uLenia);
  }
  if (uLenia > 0.001) {
    a += clamp(catmullRom(uLook, vUv, ${f(LENIA_GRID)}), 0.0, 1.0) * uLenia;
    h += clamp(bicubic(uHalo, vUv, ${f(HALO_GRID)}), 0.0, 1.0) * uLenia;
  }

  // dark water, a little lighter toward the middle of the pond, with a faint sheen at grazing angles
  vec3 view = normalize(uCamPos - vWorld);
  float graze = pow(1.0 - clamp(view.y, 0.0, 1.0), 4.0);
  vec3 water = ramp(0.08) * (0.05 + 0.05 * (1.0 - r)) + ramp(0.3) * 0.05 * graze;
  // dead squares still show as faint tiles while the grid is hard
  water += ramp(0.3) * 0.06 * (1.0 - grid) * (1.0 - uSmooth) * (1.0 - uLenia);

  // a crisp body: the thin outskirts of a creature fall off quickly, the dense core is hot
  float body = smoothstep(0.03, 0.3, a);
  vec3 bodyCol = ramp(0.46 + 0.3 * a) * (0.3 + 0.72 * smoothstep(0.0, 0.8, a));
  float glow = smoothstep(0.0, 0.5, h) * (1.0 - body);
  vec3 glowCol = ramp(0.4 + 0.2 * h) * 0.2;
  vec3 col = water + glowCol * glow + bodyCol * body;
  // the edge of the pond fades its contents first, then the water
  gl_FragColor = vec4(col * smoothstep(0.0, 0.6, pond), pond * uOpacity);
}
`
