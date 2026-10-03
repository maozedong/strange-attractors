/**
 * GLSL for the taffy puller, GLSL ES 1.0 style (three translates it for WebGL 2): the midpoint
 * step TaffySim runs, the point sprites and the rod/boundary overlay TaffyPuller draws. The field
 * functions mirror `rodField`, `guardTerm`, `velocity` and `midpointStep` in puller.ts line for line;
 * change both together (verify.ts checks the TypeScript side).
 */
import { paletteGlsl } from '../../scene/palette'
import { BLOB_RADIUS, DRAG_WIDTH, GUARD_WIDTH, MIDPOINT_ITERATIONS, RESPAWN_BOUND, ROD_RADIUS } from './puller'

const f = (x: number) => x.toFixed(6)

/** a point that moved farther than this in one substep respawned: draw it without an in-between */
export const JUMP = 0.5

const fieldGlsl = /* glsl */ `
const float ROD_A = ${f(ROD_RADIUS)};
const float DRAG_W = ${f(DRAG_WIDTH)};
const float GUARD_W = ${f(GUARD_WIDTH)};

// one rod's drag and swirl at offset r from its centre: stream function in .x, velocity in .yz
vec3 rodField(vec2 r, vec2 v, float w) {
  float d2 = dot(r, r);
  float d = sqrt(d2);
  // drag: psi = g s, s = v x r
  float s = v.x * r.y - v.y * r.x;
  float e = max(d - ROD_A, 0.0) / DRAG_W;
  float g = exp(-e * e);
  float gpd = d > ROD_A ? (-2.0 * e / DRAG_W) * (g / d) : 0.0;
  vec2 u = vec2(gpd * r.y * s + g * v.x, -gpd * r.x * s + g * v.y);
  float psi = g * s;
  // swirl: solid-body inside, w a^3 / d^2 outside
  float a3 = ROD_A * ROD_A * ROD_A;
  float hod = d > ROD_A ? a3 / (d2 * d) : 1.0;
  u += w * hod * vec2(-r.y, r.x);
  psi += d > ROD_A ? w * (a3 / d - 1.5 * ROD_A * ROD_A) : -0.5 * w * d2;
  return vec3(psi, u);
}

// guard zone of one rod: velocity of psi = (m - 1)(others - C)
vec2 guardTerm(vec2 r, vec2 uOther, float psiRel) {
  float d = length(r);
  float t = clamp((d - ROD_A) / GUARD_W, 0.0, 1.0);
  float m = t * t * (3.0 - 2.0 * t);
  float mpd = d > 0.0 ? 6.0 * t * (1.0 - t) / (GUARD_W * d) : 0.0;
  return (m - 1.0) * uOther + psiRel * mpd * vec2(r.y, -r.x);
}

// rods: a = (x, y, vx, vy), b = (spin, C)
vec2 velocity(vec2 x, vec4 a0, vec4 a1, vec4 a2, vec2 b0, vec2 b1, vec2 b2) {
  vec2 r0 = x - a0.xy;
  vec2 r1 = x - a1.xy;
  vec2 r2 = x - a2.xy;
  vec3 f0 = rodField(r0, a0.zw, b0.x);
  vec3 f1 = rodField(r1, a1.zw, b1.x);
  vec3 f2 = rodField(r2, a2.zw, b2.x);
  vec2 u = f0.yz + f1.yz + f2.yz;
  u += guardTerm(r0, f1.yz + f2.yz, f1.x + f2.x - b0.y);
  u += guardTerm(r1, f0.yz + f2.yz, f0.x + f2.x - b1.y);
  u += guardTerm(r2, f0.yz + f1.yz, f0.x + f1.x - b2.y);
  return u;
}
`

/**
 * One midpoint substep per texel (the RK2 predictor, then MIDPOINT_ITERATIONS evaluations at
 * the midpoint, converging on the area-preserving implicit midpoint rule). State texel =
 * vec4(x, y, colour id, 0).
 * uRodA / uRodB: elements 0..2 at the substep's start, 3..5 at its midpoint. uRodEnd: rod
 * centres at its end, for putting a point that integration error left inside a rod back on its
 * surface. A point that is non-finite or beyond RESPAWN_BOUND respawns uniformly in its colour's
 * half of the blob.
 */
export const taffyStepFrag = /* glsl */ `
uniform sampler2D uState;
uniform vec4 uRodA[6];
uniform vec2 uRodB[6];
uniform vec2 uRodEnd[3];
uniform float uDt;
uniform float uSeed;
varying vec2 vUv;

${fieldGlsl}

#define MIDPOINT_ITERATIONS ${MIDPOINT_ITERATIONS}
const float BOUND = ${f(RESPAWN_BOUND)};
const float BLOB_R = ${f(BLOB_RADIUS)};
const float PI = 3.14159265358979;

// "Hash without Sine" (Dave Hoskins, MIT), two rounds as IfsSim does
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

vec2 keepOut(vec2 p, vec2 c) {
  vec2 r = p - c;
  float d = length(r);
  if (d < ROD_A) p = c + (d > 1e-9 ? r * (ROD_A / d) : vec2(ROD_A, 0.0));
  return p;
}

void main() {
  vec4 s = texture2D(uState, vUv);
  vec2 x = s.xy;
  vec2 k1 = velocity(x, uRodA[0], uRodA[1], uRodA[2], uRodB[0], uRodB[1], uRodB[2]);
  vec2 xm = x + 0.5 * uDt * k1;
  for (int i = 0; i < MIDPOINT_ITERATIONS; i++) {
    vec2 k2 = velocity(xm, uRodA[3], uRodA[4], uRodA[5], uRodB[3], uRodB[4], uRodB[5]);
    xm = x + 0.5 * uDt * k2;
  }
  vec2 np = 2.0 * xm - x;

  // !(a <= b) is also true for NaN, so one test covers escaped and broken points
  if (!(abs(np.x) <= BOUND && abs(np.y) <= BOUND)) {
    vec3 hp = vec3(gl_FragCoord.xy, uSeed);
    vec3 h = hash33(hash33(hp) * 977.0 + hp.yzx);
    float rr = BLOB_R * sqrt(h.x);
    // colour 0 (warm) respawns in the left half, colour 1 in the right
    float th = PI * (h.y + (s.z < 0.5 ? 0.5 : -0.5));
    np = rr * vec2(cos(th), sin(th));
  }
  np = keepOut(np, uRodEnd[0]);
  np = keepOut(np, uRodEnd[1]);
  np = keepOut(np, uRodEnd[2]);

  gl_FragColor = vec4(np, s.z, 0.0);
}
`

/**
 * Reference density for `gain`: one domain unit spanning this many CSS px. Drawn larger, the
 * same points spread over more pixels and each gets brighter by the area ratio (and dimmer when
 * smaller), within DENSITY_MIN..DENSITY_MAX, so the taffy keeps its brightness at any framing.
 * At 170 px per unit, gain 0.08 and 1.6 px sprites, unmixed taffy sits near 0.32 linear.
 */
export const REF_PX_PER_UNIT = 170
const DENSITY_MIN = 1 / 16
const DENSITY_MAX = 16

/**
 * Point sprites. Each point is drawn between its previous and current substep (uPhase), so
 * motion stays smooth when substeps are slower than frames.
 */
export const taffyPointsVert = /* glsl */ `
attribute vec2 ref;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uPhase;
uniform float uGain;
uniform float uOpacity;
uniform float uPointSize;
uniform float uViewportH;
varying vec3 vColor;

${paletteGlsl}

const float JUMP2 = ${f(JUMP * JUMP)};
const float REF_PX = ${REF_PX_PER_UNIT.toFixed(1)};
const float DENSITY_MIN = ${f(DENSITY_MIN)};
const float DENSITY_MAX = ${f(DENSITY_MAX)};

void main() {
  vec4 cur = texture2D(uCur, ref);
  vec4 prv = texture2D(uPrev, ref);
  vec2 d = cur.xy - prv.xy;
  vec2 p = cur.xy;
  // no in-between for a point that respawned (or a broken previous state: NaN fails the test)
  if (dot(d, d) < JUMP2) p = mix(prv.xy, cur.xy, uPhase);

  vec4 mv = modelViewMatrix * vec4(p, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;

  // CSS px per domain unit at this depth, against the reference
  float pxPerView = projectionMatrix[1][1] * 0.5 * uViewportH / max(gl_Position.w, 1e-6);
  float pxPerUnit = sqrt(length(modelViewMatrix[0].xyz) * length(modelViewMatrix[1].xyz)) * pxPerView;
  float k = pxPerUnit / REF_PX;
  float g = uGain * clamp(k * k, DENSITY_MIN, DENSITY_MAX);

  vec3 col = mix(speedColor(0.85), speedColor(0.3), step(0.5, cur.z));
  vColor = col * (g * uOpacity);
  gl_PointSize = uPointSize;
}
`

/** A soft disc, as the chaos game draws its points. */
export const taffyPointsFrag = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-2.0 * d2), 1.0);
}
`

export const taffyOverlayVert = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** The rods as 2 px ink rings and the faint boundary circle, additive. */
export const taffyOverlayFrag = /* glsl */ `
uniform vec2 uRods[3];
uniform vec3 uInk;
uniform float uOpacity;
uniform float uBoundary;
uniform float uDpr;
varying vec2 vP;

const float ROD_A = ${f(ROD_RADIUS)};
// line half-widths in CSS px (scaled by uDpr); ink strengths
const float ROD_HALF_PX = 1.0;
const float ROD_INK = 0.72;
const float EDGE_HALF_PX = 0.6;
const float EDGE_INK = 0.15;

float ring(float dist, float radius, float halfCssPx) {
  // distance to the circle in device px (fwidth: one device px in this plane's units)
  float px = abs(dist - radius) / max(length(vec2(dFdx(dist), dFdy(dist))), 1e-6);
  float h = halfCssPx * uDpr;
  return 1.0 - smoothstep(h - 0.5, h + 0.5, px);
}

void main() {
  float a = EDGE_INK * ring(length(vP), uBoundary, EDGE_HALF_PX);
  a += ROD_INK * ring(length(vP - uRods[0]), ROD_A, ROD_HALF_PX);
  a += ROD_INK * ring(length(vP - uRods[1]), ROD_A, ROD_HALF_PX);
  a += ROD_INK * ring(length(vP - uRods[2]), ROD_A, ROD_HALF_PX);
  gl_FragColor = vec4(uInk * (a * uOpacity), 1.0);
}
`
