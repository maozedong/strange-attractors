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
import { paletteGlsl } from '../../scene/palette'
import { DT, DU, DV, GRID_H, GRID_W, type RowTable } from './grid'

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
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}
`

export const coatFrag = /* glsl */ `
uniform vec3 uKey;      // unit vector toward the key light, view space
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;
${gridGlsl}
${paletteGlsl}

const float PI = 3.14159265358979;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
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

// the coat's colours, linear
const vec3 SKIN = vec3(0.0232, 0.0137, 0.0273);      // #2a1f2e
const vec3 RIM = vec3(0.105, 0.072, 0.62);           // the palette's electric violet, dimmed

void main() {
  vec2 s = stateAt(normalize(vDir));
  float u = s.x;
  float v = s.y;

  // V draws the pattern; where U is used up around it the skin darkens a little (a soft halo)
  float mark = smoothstep(0.1, 0.3, v);
  float glow = smoothstep(0.26, 0.42, v);
  vec3 skin = SKIN * mix(0.55, 1.0, smoothstep(0.35, 0.9, u));
  vec3 fur = srgbToLinear(speedColor(0.75 + 0.25 * glow));
  vec3 albedo = mix(skin, fur, mark);

  vec3 n = normalize(vNormal);
  vec3 e = normalize(vView);
  float ndl = dot(n, uKey);
  // wrapped Lambert: the terminator is soft, the night side never quite black
  float dif = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
  float spec = pow(max(dot(n, normalize(uKey + e)), 0.0), 36.0) * smoothstep(-0.1, 0.3, ndl);
  float fres = pow(1.0 - clamp(dot(n, e), 0.0, 1.0), 3.0);

  vec3 col = albedo * (0.06 + 0.78 * dif)
           + vec3(1.0, 0.92, 0.82) * (0.05 * spec)
           + mix(RIM, albedo, 0.3) * (0.5 * fres);
  // keep the brightest marks at 0.9 linear (hue kept), just above the main bloom's threshold
  float peak = max(max(col.r, col.g), max(col.b, 1e-4));
  col *= min(1.0, 0.9 / peak);
  gl_FragColor = vec4(col, 1.0);
}
`
