/**
 * GLSL for the Turing sphere (GLSL ES 1.0 style; three.js converts for WebGL 2).
 *
 *  - the step pass: one Gray–Scott Euler step of the reduced-grid scheme in grid.ts;
 *  - the copy pass: an uploaded initial state into a state target;
 *  - the coat: a sphere that reads the state per fragment and shades it as a lit object.
 *
 * Every state read goes through `cell(i, j)`: texel i (wrapped in φ) of row j, nearest filtering
 * at the exact texel centre. Within a reduced-grid cell all texels hold the same value, so any
 * texel of a cell stands for it; the step shader always reads cells at their first texel.
 */
import { rampGlsl } from '../../engine/palettes'
import { DT, DU, DV, GRID_H, GRID_W, type RowTable } from '../../world/turing/grid'

const lit = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x))

const gridGlsl = /* glsl */ `
const float W = ${lit(GRID_W)};
const float H = ${lit(GRID_H)};

uniform sampler2D uState;
uniform sampler2D uRows;   // 1 x H: (texels per cell, cN, cS, cPhi) per row

vec2 cell(float i, float j) {
  return texture2D(uState, vec2((mod(i, W) + 0.5) / W, (j + 0.5) / H)).xy;
}

vec4 rowInfo(float j) {
  return texture2D(uRows, vec2(0.5, (j + 0.5) / H));
}
`

/** The Gray–Scott step. `rows` fixes the pole rings' cell count (POLE_TAPS) at compile time. */
export function buildStepFrag(rows: RowTable): string {
  return /* glsl */ `
uniform float uFeed;
uniform float uKill;
${gridGlsl}
const float DU = ${lit(DU)};
const float DV = ${lit(DV)};
const float DT = ${lit(DT)};
// the ring next to each pole: how many cells it has, and their size in texels
const int POLE_TAPS = ${rows.poleTaps};
const float POLE_M = ${lit(rows.m[1])};

// The neighbour row r seen from the cell of m texels starting at texel first, at the cell's phi:
//  - finer (half the cell size): the mean of its two cells over our span;
//  - as coarse: its cell;
//  - coarser (a polar cap, or twice the size): its cell, linearly reconstructed at our centre
//    from its phi neighbours, so a phi gradient does not leak into the theta difference. The two halves of
//    a coarse cell get opposite corrections, so the coarse cell still sees exactly its own value
//    and the flux through every face stays the same from both sides (grid.ts).
vec2 across(float first, float m, float r) {
  float mr = rowInfo(r).x;
  if (mr < m - 0.5) return 0.5 * (cell(first, r) + cell(first + floor(m * 0.5), r));
  float start = floor(first / mr) * mr;
  vec2 here = cell(start, r);
  if (mr < m + 0.5) return here;
  float offset = (first + 0.5 * m) - (start + 0.5 * mr); // +- mr / 4 texels
  return here + (cell(start + mr, r) - cell(start - mr, r)) * (offset / (2.0 * mr));
}

void main() {
  float i = floor(gl_FragCoord.x);
  float j = floor(gl_FragCoord.y);
  vec4 row = rowInfo(j);
  float m = row.x;
  float first = floor(i / m) * m; // this cell's first texel: every texel of a cell computes the same

  vec2 c = cell(first, j);
  vec2 east = cell(first + m, j);
  vec2 west = cell(first - m, j);
  vec2 north;
  vec2 south;
  if (m > W - 0.5) {
    // a polar cap: its one neighbour is the whole next ring, read as the mean of the ring's cells
    // (its coefficient on the pole side is 0, so north and south can both carry the ring)
    float ringRow = j < 0.5 ? 1.0 : H - 2.0;
    vec2 ring = vec2(0.0);
    for (int q = 0; q < POLE_TAPS; q++) ring += cell(float(q) * POLE_M, ringRow);
    ring /= float(POLE_TAPS);
    north = ring;
    south = ring;
  } else {
    north = across(first, m, max(j - 1.0, 0.0));
    south = across(first, m, min(j + 1.0, H - 1.0));
  }
  // h^2 times the Laplace-Beltrami operator on the unit sphere, conservative central differences (grid.ts)
  vec2 lap = row.w * (east + west - 2.0 * c) + row.y * (north - c) + row.z * (south - c);

  float u = c.x;
  float v = c.y;
  float uvv = u * v * v;
  vec2 rate = vec2(DU * lap.x - uvv + uFeed * (1.0 - u), DV * lap.y + uvv - (uFeed + uKill) * v);
  gl_FragColor = vec4(clamp(c + DT * rate, 0.0, 1.0), 0.0, 1.0);
}
`
}

export const copyFrag = /* glsl */ `
uniform sampler2D uSource;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(uSource, vUv).xy, 0.0, 1.0);
}
`

// ---------------------------------------------------------------- the coat

export const coatVert = /* glsl */ `
uniform float uMirror;   // 1: drawn as the reflection under the floor
uniform float uFloorY;
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;    // world distance below the floor (reflection only)

void main() {
  vDir = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDepth = max(0.0, uFloorY - world.y);
  vec4 mv = viewMatrix * world;
  vView = -mv.xyz;
  vNormal = normalize((viewMatrix * vec4(mat3(modelMatrix) * normal, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}
`

/**
 * The coat: substance (V) in the hot end of the act's ramp, bare skin in the cold end. One key
 * light from the upper left with a wrapped terminator, a soft sheen, a rim in the hot end, and
 * the marks glowing a little of their own, like phosphor. The pattern also bends the normal a
 * touch, so the marks stand slightly proud of the skin.
 */
export const coatFrag = /* glsl */ `
uniform vec3 uKey;      // unit vector toward the key light, view space
uniform vec3 uRamp[5];
uniform float uOpacity;
uniform float uMirror;
uniform float uGrow;    // 0..1: how much of the pattern is shown (bare skin at 0)
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;
${gridGlsl}
${rampGlsl}

const float PI = 3.14159265358979;

vec3 ramp(float t) {
  return ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], t);
}

// row j at texture x = s W (texels): linear between the centres of the two nearest cells
vec2 rowAt(float j, float x) {
  float m = rowInfo(j).x;
  float q = x / m - 0.5;
  float g = floor(q);
  return mix(cell(g * m, j), cell((g + 1.0) * m, j), q - g);
}

// (U, V) in a direction from the centre: bilinear over the reduced grid, seamless in phi and
// continuous over the caps (above the first row's centre both rows are the cap)
vec2 stateAt(vec3 d) {
  float ring = length(d.xz);
  float theta = atan(ring, d.y);
  float phi = ring > 1e-9 ? atan(d.z, d.x) : 0.0;
  float x = phi / (2.0 * PI) * W;
  float y = theta / PI * H - 0.5;
  float j0 = floor(y);
  float a = clamp(j0, 0.0, H - 1.0);
  float b = clamp(j0 + 1.0, 0.0, H - 1.0);
  return mix(rowAt(a, x), rowAt(b, x), y - j0);
}

void main() {
  vec3 d = normalize(vDir);
  vec2 s = stateAt(d);
  float u = s.x;
  float v = s.y * uGrow;

  float mark = smoothstep(0.1, 0.3, v);
  float core = smoothstep(0.24, 0.42, v);
  // where U is used up round a mark the skin darkens a little: a soft halo
  float hollow = smoothstep(0.35, 0.95, mix(1.0, u, uGrow));
  float tone = mix(0.1 + 0.08 * hollow, 0.6 + 0.3 * core, mark);
  vec3 albedo = ramp(tone);

  vec3 n = normalize(vNormal);
  vec3 e = normalize(vView);
  float ndl = dot(n, uKey);
  // wrapped Lambert: the terminator is soft, the night side never quite black
  float dif = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  float sheen = pow(max(dot(n, normalize(uKey + e)), 0.0), 22.0) * smoothstep(-0.1, 0.4, ndl);
  float fres = pow(1.0 - clamp(dot(n, e), 0.0, 1.0), 3.0);

  vec3 col = albedo * (0.05 + 1.1 * dif)
           + ramp(0.95) * (0.12 * sheen * (0.4 + 0.6 * mark))
           + ramp(0.84) * (0.55 * fres * (0.25 + 0.75 * mark))
           + ramp(0.62) * (0.16 * core);
  float a = uOpacity;
  if (uMirror > 0.5) {
    // the dark glossy floor: dim, and gone a short way under it
    col *= 0.22;
    a *= exp(-2.4 * vDepth);
  }
  gl_FragColor = vec4(col, a);
}
`
