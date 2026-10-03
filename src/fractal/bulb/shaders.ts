import { paletteGlsl } from '../../scene/palette'
import { bulbDEGlsl } from './de'

/**
 * GLSL for the Mandelbulb. GLSL ES 1.0 style (three compiles it as ES 3.0 on WebGL 2, so
 * gl_FragDepth is the core built-in), constant loop bounds with early breaks.
 *
 * Two passes share one vertex shader, which draws the back faces of a sphere around the bulb
 * (back faces, so the sphere covers the view with the camera inside it too):
 *
 *  marchFrag    sphere-traces the ray through each pixel and shades the hit. It runs into an
 *               offscreen target at a reduced resolution and writes rgb = linear colour,
 *               a = distance along the ray (0 = miss).
 *  displayFrag  draws that target onto the sphere at full resolution: bilinear over the four
 *               nearest texels, skipping misses (so the silhouette gets a coverage alpha), and
 *               writes gl_FragDepth from the hit so the bulb depth-sorts with everything else.
 *
 * All positions are in the mesh's local space, which is fractal space: the component turns the
 * mesh so fractal +z (the pole) points up and scales it to its radius.
 */

/** Steps of the primary march; a ray still inside the bound after this many counts as a hit. */
export const MAX_STEPS = 128
/** Fraction of the distance estimate taken per step. */
export const STEP_SCALE = 0.8
/**
 * Precision floors, fractal units (verify.ts measures float32 error near the surface): below
 * 1e-5 the estimate itself drifts by a few percent; below 3e-5 normals from finite differences
 * pick up degrees of noise. A close-up keeps its silhouette down to the first, and its shading
 * softens rather than speckles below the second.
 */
export const EPS_FLOOR = 1e-5
export const NORMAL_FLOOR = 3e-5

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x))

export const bulbVert = /* glsl */ `
uniform float uMeshRadius;
varying vec3 vLocal;
void main() {
  vLocal = position * uMeshRadius;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vLocal, 1.0);
}
`

export const marchFrag = /* glsl */ `
#define MAX_STEPS ${MAX_STEPS}
#define STEP_SCALE ${f(STEP_SCALE)}
#define HIT_PX 0.5
#define EPS_FLOOR ${EPS_FLOOR.toExponential()}
#define NORMAL_FLOOR ${NORMAL_FLOOR.toExponential()}
#define AO_TAPS 5
#define AO_VIEW 0.035
#define AO_MIN 2e-4
#define AO_MAX 0.1
#define SHADOW_STEPS 32
#define SHADOW_K 6.0

uniform float uBound;       // radius that contains the set for this power
uniform vec3 uCamLocal;     // camera position
uniform float uPixelAngle;  // radians per march texel
uniform vec3 uKeyDir;       // toward the key light (upper left of the view)
uniform vec3 uRimDir;       // toward the rim light (lower right, behind)
uniform vec3 uUpDir;        // up on screen: the sky of the ambient term
uniform vec2 uTrapRange;    // orbit trap 5th / 98th percentile for this power
varying vec3 vLocal;

${paletteGlsl}
${bulbDEGlsl}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

// distance along the ray from o in direction d (unit) to where it leaves the bound
float exitBound(vec3 o, vec3 d) {
  float b = dot(o, d);
  float c = dot(o, o) - uBound * uBound;
  return -b + sqrt(max(b * b - c, 0.0));
}

// gradient of the estimate by a tetrahedron of 4 taps (central differences in 4 not 6 calls),
// in a loop so the estimator is inlined once
vec3 bulbNormal(vec3 p, float h) {
  vec3 n = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 e = i == 0 ? vec3(1.0, -1.0, -1.0) : i == 1 ? vec3(-1.0, -1.0, 1.0) : i == 2 ? vec3(-1.0, 1.0, -1.0) : vec3(1.0);
    n += e * bulbDE(p + e * h).x;
  }
  return normalize(n);
}

// how open the surface is out to radius r along the normal: 1 = open, 0 = buried
float bulbAO(vec3 p, vec3 n, float r) {
  float occ = 0.0;
  float w = 1.0;
  float wsum = 0.0;
  for (int i = 1; i <= AO_TAPS; i++) {
    float h = r * float(i) / float(AO_TAPS);
    float d = bulbDE(p + n * h).x;
    occ += w * clamp((h - d) / h, 0.0, 1.0);
    wsum += w;
    w *= 0.7;
  }
  return 1.0 - occ / wsum;
}

// penumbra toward the key light: the narrowest cone the shadow ray squeezes through
float bulbShadow(vec3 o, vec3 d, float tmin, float tmax) {
  float res = 1.0;
  float t = tmin;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    float h = bulbDE(o + d * t).x;
    res = min(res, SHADOW_K * h / t);
    if (res < 0.004 || t > tmax) break;
    t += clamp(h * STEP_SCALE, tmin * 0.5, tmax * 0.15);
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

void main() {
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocal - ro);

  // enter the bound (or start at the camera if it is inside)
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uBound * uBound;
  float disc = b * b - c;
  if (disc <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  disc = sqrt(disc);
  float tExit = -b + disc;
  if (tExit <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float t = max(-b - disc, 0.0);

  // sphere trace; a hit is the estimate falling under half a texel's footprint at that distance
  float eps = EPS_FLOOR;
  float steps = 0.0;
  float trap = 1.0;
  bool hit = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec2 h = bulbDE(ro + rd * t);
    float d = h.x;
    trap = h.y;
    eps = max(t * uPixelAngle * HIT_PX, EPS_FLOOR);
    if (d < eps) {
      hit = true;
      break;
    }
    t += d * STEP_SCALE;
    if (t > tExit) break;
    steps += 1.0;
  }
  // out of steps while still inside the bound: the ray is creeping along a surface
  if (!hit && t < tExit) hit = true;
  if (!hit) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = bulbNormal(p, max(eps, NORMAL_FLOOR));
  vec3 v = -rd;
  // grazing hits can return a normal facing away from the eye; bend it back to the silhouette
  float nv = dot(n, v);
  if (nv < 0.0) n = normalize(n - v * nv * 1.01);

  // occlusion radii follow the view distance, so a dive looks like the overview, one level down
  float aoR = clamp(t * AO_VIEW, AO_MIN, AO_MAX);
  float ao = bulbAO(p, n, aoR);
  float occ = ao * (1.0 - 0.45 * steps / float(MAX_STEPS));

  // colour: orbit trap through the house palette; the low 2/3 of the range stays blue / violet
  float tn = clamp((trap - uTrapRange.x) / (uTrapRange.y - uTrapRange.x), 0.0, 1.0);
  vec3 albedo = srgbToLinear(speedColor(0.12 + 0.76 * tn * tn * (1.6 - 0.6 * tn)));

  // key: warm, upper left, with a soft shadow
  float dif = max(dot(n, uKeyDir), 0.0);
  float sha = 0.0;
  if (dif > 0.0) {
    float tmin = max(aoR * 0.12, 6.0 * eps);
    sha = bulbShadow(p + n * 2.0 * eps, uKeyDir, tmin, exitBound(p, uKeyDir));
  }
  vec3 hv = normalize(uKeyDir + v);
  float spe = pow(max(dot(n, hv), 0.0), 40.0) * dif * sha;
  // rim: cool, from behind on the opposite side; fresnel-weighted so it rides the silhouette
  float rim = max(dot(n, uRimDir), 0.0);
  float fre = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  // ambient: a dim violet sky above the screen, deep blue below
  float sky = 0.5 + 0.5 * dot(n, uUpDir);

  const vec3 KEY = vec3(1.0, 0.86, 0.66);
  const vec3 RIM = vec3(0.20, 0.16, 0.95);
  const vec3 SKY = vec3(0.055, 0.05, 0.34);
  const vec3 GROUND = vec3(0.012, 0.016, 0.09);

  vec3 light = KEY * (2.1 * dif * sha * (0.55 + 0.45 * occ))
             + mix(GROUND, SKY, sky) * (1.4 * occ)
             + RIM * (0.6 * rim * occ);
  vec3 col = albedo * light
           + KEY * (0.35 * spe)
           + RIM * (0.5 * fre * (0.3 + 0.7 * rim) * occ);

  gl_FragColor = vec4(col, t);
}
`

export const displayFrag = /* glsl */ `
uniform sampler2D uMarch;
uniform vec2 uAlloc;      // march target size, texels
uniform vec2 uMarchSize;  // texels the last march covered (the whole view at its scale)
uniform vec2 uFrame;      // framebuffer size, pixels
uniform vec3 uCamLocal;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying vec3 vLocal;

vec4 fetch(vec2 ij) {
  return texture2D(uMarch, (clamp(ij, vec2(0.0), uMarchSize - 1.0) + 0.5) / uAlloc);
}

void main() {
  // bilinear over the four nearest march texels, ignoring misses: at full scale this is one
  // texel exactly; below it the silhouette gets a fractional coverage
  vec2 q = gl_FragCoord.xy / uFrame * uMarchSize - 0.5;
  vec2 i = floor(q);
  vec2 f = q - i;
  vec4 s00 = fetch(i);
  vec4 s10 = fetch(i + vec2(1.0, 0.0));
  vec4 s01 = fetch(i + vec2(0.0, 1.0));
  vec4 s11 = fetch(i + vec2(1.0, 1.0));
  float w00 = (1.0 - f.x) * (1.0 - f.y) * step(1e-7, s00.a);
  float w10 = f.x * (1.0 - f.y) * step(1e-7, s10.a);
  float w01 = (1.0 - f.x) * f.y * step(1e-7, s01.a);
  float w11 = f.x * f.y * step(1e-7, s11.a);
  float cover = w00 + w10 + w01 + w11;
  if (cover < 0.004) discard;
  vec4 s = (s00 * w00 + s10 * w10 + s01 * w01 + s11 * w11) / cover;

  // the hit along this pixel's own ray, at the filtered distance
  vec3 hit = uCamLocal + normalize(vLocal - uCamLocal) * s.a;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(hit, 1.0);
  gl_FragDepth = clamp(0.5 * clip.z / max(clip.w, 1e-9) + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(s.rgb, cover);
}
`
