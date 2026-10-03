/**
 * GLSL for the chaos game, GLSL ES 1.0 style (three translates it for WebGL 2): the step pass
 * IfsSim runs and the point sprites ChaosGame draws. Constant loop bounds only.
 */
import { paletteGlsl } from '../../scene/palette'
import { MAP_COUNT_MAX } from './presets'

/** Distance from the frame centre, in stage units, beyond which a point respawns. */
export const RESPAWN_BOUND = 50
/** Palette t given to points that no map has placed yet (a scatter or a respawn). */
export const SCATTER_TONE = 0.4
/**
 * Reference density: one stage unit (half the frame's larger side) spanning this many CSS px,
 * where verify-presets.ts measured each preset's `gain`. Drawn larger, points spread over more pixels
 * and each gets brighter by the area ratio, within DENSITY_MIN..DENSITY_MAX.
 */
export const REF_PX_PER_STAGE = 260
export const DENSITY_MIN = 0.25
export const DENSITY_MAX = 4

/** One chaos-game iteration per texel; see IfsSim. */
export const ifsStepFrag = /* glsl */ `
#define MAP_COUNT_MAX ${MAP_COUNT_MAX}
uniform sampler2D uState;
// per map two rows of [A | t]: x' = dot(uRows[2i], (x, y, 1)), y' = dot(uRows[2i + 1], (x, y, 1))
uniform vec3 uRows[2 * MAP_COUNT_MAX];
uniform float uCum[MAP_COUNT_MAX];
uniform float uTones[MAP_COUNT_MAX];
uniform float uCount;
uniform float uSeed;
// respawn rectangle: centre, half-extents
uniform vec4 uSpawn;
uniform float uBound;
varying vec2 vUv;

// "Hash without Sine" (Dave Hoskins, MIT). Stable for the small, integer-ish inputs we feed it.
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

void main() {
  vec4 s = texture2D(uState, vUv);
  // the integer texel coordinate and a small per-step seed, not vUv + time: once time reaches
  // the thousands, adding it to a 0..1 uv would round neighbouring texels to the same value
  // hash33 is symmetric in x and y to first order, so one round gives texel pairs the same
  // die forever and they collapse onto each other; a second round with the first's output
  // and a rotated input decorrelates them (measured: parity with a proper PRNG)
  vec3 hp = vec3(gl_FragCoord.xy, uSeed);
  vec3 u = hash33(hash33(hp) * 977.0 + hp.yzx);

  // roll the die: the map index is the number of cumulative thresholds u has passed
  float k = 0.0;
  for (int i = 0; i < MAP_COUNT_MAX - 1; i++) {
    if (u.x >= uCum[i]) k += 1.0;
  }
  k = min(k, uCount - 1.0);

  vec3 rowX = uRows[0];
  vec3 rowY = uRows[1];
  float tone = uTones[0];
  for (int i = 1; i < MAP_COUNT_MAX; i++) {
    if (k == float(i)) {
      rowX = uRows[2 * i];
      rowY = uRows[2 * i + 1];
      tone = uTones[i];
    }
  }

  vec3 h = vec3(s.xy, 1.0);
  vec2 np = vec2(dot(rowX, h), dot(rowY, h));
  float mapIndex = k;

  // !(x < limit) is also true for NaN and Inf, so one test covers escaped and broken points
  vec2 off = np - uSpawn.xy;
  if (!(dot(off, off) < uBound * uBound)) {
    np = uSpawn.xy + (2.0 * u.yz - 1.0) * uSpawn.zw;
    mapIndex = -1.0;
    tone = ${SCATTER_TONE.toFixed(4)};
  }

  gl_FragColor = vec4(np, mapIndex, tone);
}
`

/**
 * Vertex shader. Each point is drawn between its previous and current state. Rather than
 * sliding along the straight chord, it follows the step's own map as a motion (see
 * IfsUniforms.motion): around the map's fixed point, turning by t·phi while its linear part
 * blends from I to S. A copy that turns by 135° (the dragon) therefore visibly turns as it
 * shrinks instead of pinching through a third of its size. The residual against the stored
 * current position (float rounding, or maps edited since the step) is folded in linearly, so
 * the point always lands exactly where the step put it.
 */
export const chaosPointsVert = /* glsl */ `
#define MAP_COUNT_MAX ${MAP_COUNT_MAX}
attribute vec2 ref;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uPhase;
uniform vec4 uMotion[2 * MAP_COUNT_MAX];
uniform vec2 uCenter;
uniform float uFit;
uniform float uGain;
uniform float uOpacity;
uniform float uPointSize;
uniform float uViewportH;
varying vec3 vColor;

${paletteGlsl}

const float BOUND2 = ${(RESPAWN_BOUND * RESPAWN_BOUND).toFixed(1)};
const float REF_PX = ${REF_PX_PER_STAGE.toFixed(1)};
const float DENSITY_MIN = ${DENSITY_MIN.toFixed(3)};
const float DENSITY_MAX = ${DENSITY_MAX.toFixed(3)};

vec2 turn(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec4 cur = texture2D(uCur, ref);
  vec4 prv = texture2D(uPrev, ref);
  // a previous state that is broken or far away (the point respawned) gets no in-between
  if (!(dot(prv.xy, prv.xy) < BOUND2)) prv = cur;

  float t = uPhase;
  vec2 p = cur.xy;
  vec3 col = speedColor(cur.w);
  if (t < 1.0) {
    // motion of the map that placed the point; identity for a scattered or respawned one
    vec4 m0 = vec4(0.0);
    vec4 m1 = vec4(1.0, 0.0, 1.0, 0.0);
    for (int i = 0; i < MAP_COUNT_MAX; i++) {
      if (abs(cur.z - float(i)) < 0.5) {
        m0 = uMotion[2 * i];
        m1 = uMotion[2 * i + 1];
      }
    }
    vec2 d = prv.xy - m0.xy;
    vec2 sd = vec2(m1.x * d.x + m1.y * d.y, m1.y * d.x + m1.z * d.y);
    vec2 path = m0.xy + turn(mix(d, sd, t), t * m0.z);
    vec2 end = m0.xy + turn(sd, m0.z);
    p = path + t * (cur.xy - end);
    col = mix(speedColor(prv.w), col, t);
  }

  vec4 mv = modelViewMatrix * vec4((p - uCenter) * uFit, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;

  // CSS px per stage unit at this depth (perspective or orthographic), against the reference
  float pxPerView = projectionMatrix[1][1] * 0.5 * uViewportH / max(gl_Position.w, 1e-6);
  float pxPerLocal = sqrt(length(modelViewMatrix[0].xyz) * length(modelViewMatrix[1].xyz)) * pxPerView;
  float k = pxPerLocal * uFit / REF_PX;
  float g = uGain * clamp(k * k, DENSITY_MIN, DENSITY_MAX);

  vColor = col * (g * uOpacity);
  gl_PointSize = uPointSize;
}
`

/** A soft disc, as the bifurcation cloud draws its points. */
export const chaosPointsFrag = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-2.0 * d2), 1.0);
}
`
