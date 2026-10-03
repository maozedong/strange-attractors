import { paletteGlsl } from '../../scene/palette'
import { MAX_ITER, ORBIT_TEXELS } from './orbit'

/**
 * GLSL for the fractal planes. Two passes:
 *
 *  1. iteration, only when the view or the camera changes: the plane is drawn with the scene
 *     camera into a float target covering its screen rectangle, and each fragment runs the
 *     escape-time loop for 1 or 4 subsamples, writing one encoded float per subsample.
 *     This is the expensive pass.
 *  2. the visible plane, every frame: fetches its own pixel from that cache, applies the
 *     drifting palette and the boundary shading, averages the subsamples, and draws the Julia
 *     cursor. Cheap.
 *
 * GLSL ES 1.0 style; three maps texture2D / texture2DLodEXT / gl_FragColor to GLSL ES 3.0.
 */

export const JULIA_MAX_ITER = 600

/** Palette phase drift, cycles per second. */
export const PALETTE_DRIFT = 0.02

/**
 * Cache encoding, one float per subsample:
 *   0.0             no data (cleared texel outside the plane)
 *   -1.0            did not escape within the budget: inside the set, or unresolved
 *   1 + q*256 + m   escaped. q in 0..63 is the boundary shade from the distance estimate
 *                   (0 on the boundary, 63 at SHADE_TEXELS texels or more). m is the smooth
 *                   iteration count mu: exact below FAR_FIELD, where the palette treats the far
 *                   field specially, and folded modulo the palette period above it,
 *                   FAR_FIELD + mod(mu - FAR_FIELD, 1/PHASE_FREQ), which leaves the palette
 *                   phase unchanged. The largest value is about 16300, where float32 still
 *                   resolves m to 0.002 (palette phase to 3e-5).
 */
const encodingGlsl = /* glsl */ `
#define ESCAPE_SQ 256.0
#define PHASE_FREQ 0.015
#define PHASE_PERIOD 66.666666667
#define FAR_FIELD 64.0
#define SHADE_LEVELS 63.0
#define SHADE_TEXELS 3.0
`

const iterationCommonGlsl = /* glsl */ `
${encodingGlsl}
uniform vec2 uSpan;     // complex-plane size of the whole plane: scale * (width, height)
uniform float uQuality; // 1: 2x2 rotated-grid supersampling, 0: one sample per texel
varying vec2 vUv;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// |z|^2 = r2 passed the escape radius at iteration n. der is dz/dc (dz/dz0 for Julia).
float encodeEscape(float n, float r2, vec2 der, float texelSize) {
  float lz = 0.5 * log(r2);                      // log |z|
  float mu = max(n + 1.0 - log2(lz), 0.0);       // continuous escape count
  float dl = length(der);
  // distance estimate |z| log|z| / |z'|; an overflowed (or NaN) derivative only happens right at
  // the boundary, so call that distance 0 (the comparison is false for NaN)
  float de = dl < 1e30 ? sqrt(r2) * lz / dl : 0.0;
  float q = floor(smoothstep(0.0, SHADE_TEXELS, de / texelSize) * SHADE_LEVELS + 0.5);
  float m = mu < FAR_FIELD ? mu : FAR_FIELD + mod(mu - FAR_FIELD, PHASE_PERIOD);
  return 1.0 + q * 256.0 + m;
}

// p: the sample's position relative to the view centre (Mandelbrot: dc, Julia: z0)
float iterate(vec2 p, float texelSize);

void main() {
  // complex offset of one texel right / up; also sizes the subsample grid and the shading
  vec2 ex = dFdx(vUv) * uSpan;
  vec2 ey = dFdy(vUv) * uSpan;
  float texelSize = max(max(length(ex), length(ey)), 1e-30);
  vec2 base = (vUv - 0.5) * uSpan;
  float samples = uQuality > 0.5 ? 4.0 : 1.0;
  vec4 result = vec4(-1.0);
  // one call site, so the iteration loop is inlined once
  for (int s = 0; s < 4; s++) {
    if (float(s) >= samples) break;
    // rotated grid: four points of a 4x4 sub-grid, one per row and column
    vec2 o = s == 0 ? vec2(-0.375, 0.125) : s == 1 ? vec2(0.125, 0.375)
           : s == 2 ? vec2(0.375, -0.125) : vec2(-0.125, -0.375);
    if (samples < 2.0) o = vec2(0.0);
    float v = iterate(base + o.x * ex + o.y * ey, texelSize);
    if (s == 0) result.x = v;
    else if (s == 1) result.y = v;
    else if (s == 2) result.z = v;
    else result.w = v;
  }
  gl_FragColor = samples > 1.0 ? result : result.xxxx;
}
`

export const planeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Mandelbrot by perturbation around a reference orbit.
 *
 * The reference c_ref (the view centre) is iterated on the CPU in doubles: Z_0 = 0,
 * Z_{m+1} = Z_m^2 + c_ref, stored as float32 in uOrbit. A pixel c = c_ref + dc has orbit
 * z_n = Z_m + d_m, and subtracting the two recurrences leaves an iteration for the small
 * difference alone:
 *
 *     d_{m+1} = 2 Z_m d_m + d_m^2 + dc  =  (2 Z_m + d_m) d_m + dc
 *
 * dc and d are tiny (dc down to 1e-13 here) but float32 keeps 24 bits of *relative* precision
 * at any magnitude, so the pixel-to-pixel differences that z itself cannot hold in float
 * survive in d. Absolute position comes from the double-precision reference; the per-pixel
 * deviation from a float recurrence that never adds a tiny number to a large one.
 *
 * Rebasing (Zhuoran, 2021) replaces glitch detection. When |z| < |d| the orbit has come closer
 * to 0 than to the reference, which is where d loses accuracy (the Pauldelbrot glitch). Rather
 * than flag the pixel, restart the reference from its start: Z_0 = 0, so set d = z, m = 0. The
 * same restart applies when the reference runs out (it escaped, or ended at maxIter), so
 * pixels outlive an escaping reference with no fallback artefact. One reference orbit renders
 * the whole view glitch-free.
 *
 * dz/dc for the distance estimate uses the full z = Z + d: der_{n+1} = 2 z_n der_n + 1.
 */
export const mandelIterationFrag = /* glsl */ `
#define MAX_ITER ${MAX_ITER}
#define ORBIT_TEXELS ${ORBIT_TEXELS.toFixed(1)}
${iterationCommonGlsl}
uniform sampler2D uOrbit;  // Z_0..Z_M: texel k holds Z_2k in .xy and Z_2k+1 in .zw
uniform float uRefLen;     // M, the last valid reference index
uniform float uMaxIter;

vec2 orbitAt(float m) {
  float k = floor(m * 0.5);
  // explicit LOD: an implicit-derivative fetch inside a data-dependent loop is undefined, and
  // ANGLE's D3D backend reacts by trying to unroll the loop
  vec4 t = texture2DLodEXT(uOrbit, vec2((k + 0.5) / ORBIT_TEXELS, 0.5), 0.0);
  return m - 2.0 * k < 0.5 ? t.xy : t.zw;
}

// dc: this sample's offset from c_ref
float iterate(vec2 dc, float texelSize) {
  vec2 Z = vec2(0.0);   // Z_m
  vec2 d = vec2(0.0);   // d_m; z_0 = Z_0 = 0
  vec2 z = vec2(0.0);   // z_n = Z_m + d_m
  vec2 der = vec2(0.0); // dz_n / dc
  float m = 0.0;        // reference index; runs behind n after a rebase
  for (int n = 1; n <= MAX_ITER; n++) {
    if (float(n) > uMaxIter) break;
    der = 2.0 * cmul(z, der) + vec2(1.0, 0.0);
    d = cmul(2.0 * Z + d, d) + dc;
    m += 1.0;
    Z = orbitAt(m);
    z = Z + d;
    float r2 = dot(z, z);
    if (r2 > ESCAPE_SQ) return encodeEscape(float(n), r2, der, texelSize);
    if (r2 < dot(d, d) || m >= uRefLen) {
      d = z;
      m = 0.0;
      Z = vec2(0.0);
    }
  }
  return -1.0;
}
`

/** Julia set of uC with plain float iteration: the view is fixed and shallow. */
export const juliaIterationFrag = /* glsl */ `
#define JULIA_MAX_ITER ${JULIA_MAX_ITER}
${iterationCommonGlsl}
uniform vec2 uC;

// z: the starting point z_0 (the view is centred on 0)
float iterate(vec2 z, float texelSize) {
  vec2 der = vec2(1.0, 0.0); // dz_n / dz_0
  for (int n = 1; n <= JULIA_MAX_ITER; n++) {
    der = 2.0 * cmul(z, der);
    z = cmul(z, z) + uC;
    float r2 = dot(z, z);
    if (r2 > ESCAPE_SQ) return encodeEscape(float(n), r2, der, texelSize);
  }
  return -1.0;
}
`

/**
 * The visible plane. Its pixel's cache texel is found from gl_FragCoord (texel = pixel at rest;
 * coarser while the view is moving on a slow GPU, then bilinear over the covered taps).
 *
 * Palette: t = fract(0.015 mu + shift) through a triangle wave, so the house gradient (deep
 * blue, violet, rose, warm white) runs out and back without a seam. The drift fades out in the
 * far field (mu below ~12: points that escape within a few iterations), so at shallow zooms the
 * backdrop stays deep blue rather than washing through white every cycle, while the bands near
 * the set keep flowing. uShift is not wrapped to [0, 1): a wrap would jump the partly drifted
 * far-field phase. Colour is darkened toward the boundary by the distance estimate.
 *
 * Colours are authored in sRGB (the palette's hex values; INSIDE is the page background
 * #050408) and converted to linear before averaging and output, because the scene renders in
 * linear light and the post chain encodes to sRGB at the end. Without it the deep blue reads as
 * pale periwinkle and the interior as grey.
 *
 * Julia cursor: a 2 px ring with a dark outline, sized in CSS pixels through the screen-space
 * Jacobian of the uv, so it stays round on a tilted plane.
 */
export const planeFrag = /* glsl */ `
${paletteGlsl}
${encodingGlsl}
#define FAR_MU0 2.0
#define FAR_MU1 12.0
#define EDGE_SHADE 0.55
#define RING_RADIUS 7.0
#define RING_HALF_WIDTH 1.0
#define OUTLINE_HALF_WIDTH 2.25
uniform sampler2D uCache;
uniform vec2 uAlloc;       // cache size, texels
uniform vec2 uOrigin;      // framebuffer pixel of cache texel (0, 0)
uniform vec2 uTexelPerPx;  // cache texels per framebuffer pixel: 1 at rest
uniform float uSamples;    // 1 or 4
uniform float uShift;
uniform vec2 uCursor;      // cursor position, plane uv
uniform float uCursorOn;   // 0..1
uniform float uDpr;
varying vec2 vUv;

const vec3 INSIDE_SRGB = vec3(0.02, 0.015, 0.03);
const vec3 RING_SRGB = vec3(1.0, 0.941, 0.784);

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

// linear colour of one encoded sample
vec3 sampleColor(float v) {
  if (v < 0.0) return srgbToLinear(INSIDE_SRGB);
  float w = v - 1.0;
  float q = floor(w / 256.0);
  float m = w - q * 256.0;
  float drift = smoothstep(FAR_MU0, FAR_MU1, m);  // 0 in the far field, 1 near the set
  float t = fract(PHASE_FREQ * m + uShift * drift);
  float tri = 1.0 - abs(2.0 * t - 1.0);
  return srgbToLinear(speedColor(tri) * mix(EDGE_SHADE, 1.0, q / SHADE_LEVELS));
}

// rgb: linear colour averaged over the texel's subsamples; a: 1 if the texel holds data
vec4 texel(vec2 ij) {
  vec4 s = texture2DLodEXT(uCache, (ij + 0.5) / uAlloc, 0.0);
  if (abs(s.x) < 0.5) return vec4(0.0);
  vec3 c = sampleColor(s.x);
  if (uSamples > 1.5) c = (c + sampleColor(s.y) + sampleColor(s.z) + sampleColor(s.w)) * 0.25;
  return vec4(c, 1.0);
}

void main() {
  vec2 ddx = dFdx(vUv);
  vec2 ddy = dFdy(vUv);

  // bilinear over the four nearest texels, skipping zero weights (at rest only one is used)
  // and texels without data (the plane's silhouette)
  vec2 p = (gl_FragCoord.xy - uOrigin) * uTexelPerPx - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec4 acc = vec4(0.0);
  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;
  if (w00 > 0.0) acc += w00 * texel(i);
  if (w10 > 0.0) acc += w10 * texel(i + vec2(1.0, 0.0));
  if (w01 > 0.0) acc += w01 * texel(i + vec2(0.0, 1.0));
  if (w11 > 0.0) acc += w11 * texel(i + vec2(1.0, 1.0));
  vec3 inside = srgbToLinear(INSIDE_SRGB);
  vec3 c = acc.a > 1e-4 ? acc.rgb / acc.a : inside;

  if (uCursorOn > 0.001) {
    // solve [ddx ddy] s = vUv - uCursor: s is the offset in device pixels
    vec2 d = vUv - uCursor;
    float det = ddx.x * ddy.y - ddy.x * ddx.y;
    if (abs(det) > 1e-20) {
      vec2 s = vec2(ddy.y * d.x - ddy.x * d.y, ddx.x * d.y - ddx.y * d.x) / det;
      float r = length(s) / uDpr;              // CSS pixels from the cursor centre
      float e = abs(r - RING_RADIUS);
      float aa = 0.5 / uDpr;
      float ring = 1.0 - smoothstep(RING_HALF_WIDTH - aa, RING_HALF_WIDTH + aa, e);
      float outline = 1.0 - smoothstep(OUTLINE_HALF_WIDTH - aa, OUTLINE_HALF_WIDTH + aa, e);
      c = mix(c, inside, outline * 0.85 * uCursorOn);
      c = mix(c, srgbToLinear(RING_SRGB), ring * uCursorOn);
    }
  }
  gl_FragColor = vec4(c, 1.0);
}
`
