/**
 * Shaders for the Lenia stage. GLSL ES 1.0 style (three maps texture2D / texture2DLodEXT /
 * gl_FragColor to GLSL ES 3.0 on WebGL 2). Every loop has constant bounds.
 *
 * Simulation passes run on a full-screen quad (fullscreenVert) into float targets with
 * NearestFilter and RepeatWrapping, so a fetch at a texel centre returns that cell exactly and
 * offsets past an edge wrap around (the grid is a torus). gl_FragCoord.xy is the cell centre
 * (x + 0.5, y + 0.5), origin bottom-left = texture row 0 = grid row 0.
 */
import { paletteGlsl } from '../../scene/palette'
import { KERNEL_DIAMETER, KERNEL_RADIUS } from './core'

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

/** The visible plane: PlaneGeometry uv, so v = 0 (grid row 0) is the bottom edge. */
export const displayVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Creatures in the house palette on a near-black dish. Linear output (the post chain encodes
 * to sRGB). Both textures are read with a cubic B-spline built from four hardware bilinear
 * taps (Sigg & Hadwiger, GPU Gems 2 ch. 20): no bilinear creases when a cell spans many
 * pixels, at the price of a slight blur (≈ 0.6 cell). Body: speedColor(0.25 + 0.75 A), faded
 * in over the thin outskirts so the empty dish stays dark. Glow: the blurred field, dim
 * violet, outside the body. Peak ≈ 0.95.
 */
export const displayFrag = /* glsl */ `
uniform sampler2D uLook;
uniform sampler2D uHalo;
uniform float uOpacity;
varying vec2 vUv;
${paletteGlsl}

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

void main() {
  float a = clamp(bicubic(uLook, vUv, ${f(LENIA_GRID)}), 0.0, 1.0);
  float h = clamp(bicubic(uHalo, vUv, ${f(HALO_GRID)}), 0.0, 1.0);
  vec3 bg = vec3(0.0016, 0.0024, 0.0085);
  float body = 1.0 - exp(-9.0 * a);
  vec3 bodyCol = speedColor(0.25 + 0.75 * a) * (0.35 + 0.6 * a);
  float glow = smoothstep(0.0, 0.35, h) * (1.0 - body);
  vec3 glowCol = speedColor(0.22 + 0.25 * h) * 0.32;
  vec3 col = bg + glowCol * glow + bodyCol * body;
  gl_FragColor = vec4(min(col, vec3(1.0)), uOpacity);
}
`
