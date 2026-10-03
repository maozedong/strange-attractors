/**
 * GLSL for the lava-lamp wall, GLSL ES 1.0 style (three translates it for WebGL 2). One plane;
 * each fragment finds its cell, then draws that cell's lamp from signed distances: shelf, metal
 * base, glass with bulb-lit liquid and metaball wax, cap. Values are linear light; the brightest
 * (lit wax plus the glass highlight) stay under MAX_VALUE. verify.ts mirrors `main` on the CPU
 * (shadeLava) to check that bound and render a preview; change both together.
 */
import { BLOBS_PER_LAMP, LAMP_COLS, LAMP_COUNT, LAMP_ROWS, LAMP_SHAPE, LAMP_TEXELS } from './lava'

const f = (x: number) => x.toFixed(6)
const S = LAMP_SHAPE

/** hard ceiling on any channel, linear */
export const LAVA_MAX_VALUE = 0.9

export const lavaVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const lavaFrag = /* glsl */ `
uniform sampler2D uLamps;
uniform vec2 uSize;
uniform float uOpacity;
varying vec2 vUv;

const float COLS = ${f(LAMP_COLS)};
const float ROWS = ${f(LAMP_ROWS)};
const float LAMPS = ${f(LAMP_COUNT)};
const float TEXELS = ${f(LAMP_TEXELS)};

const float BASE_BOT = ${f(S.baseBottom)};
const float BASE_TOP = ${f(S.baseTop)};
const float BASE_HB = ${f(S.baseHalfBottom)};
const float BASE_HT = ${f(S.baseHalfTop)};
const float GLASS_LOW_Y = ${f(S.glassLowY)};
const float GLASS_LOW_R = ${f(S.glassLowR)};
const float GLASS_HIGH_Y = ${f(S.glassHighY)};
const float GLASS_HIGH_R = ${f(S.glassHighR)};
const float GLASS_WALL = ${f(S.glassWall)};
const float CAP_BOT = ${f(S.capBottom)};
const float CAP_TOP = ${f(S.capTop)};
const float CAP_HB = ${f(S.capHalfBottom)};
const float CAP_HT = ${f(S.capHalfTop)};
const float POOL = ${f(S.poolDepth)};
const float MAX_VALUE = ${f(LAVA_MAX_VALUE)};

const vec3 WALL = vec3(0.0095, 0.0062, 0.0046);
const vec3 SHELF = vec3(0.016, 0.0105, 0.0078);
const vec3 METAL = vec3(0.020, 0.017, 0.015);
const vec3 WARM_WHITE = vec3(1.0, 0.93, 0.84);
const vec3 BULB_LIGHT = vec3(1.0, 0.74, 0.42);

vec4 lampTexel(float lamp, float j) {
  return texture2D(uLamps, vec2((j + 0.5) / TEXELS, (lamp + 0.5) / LAMPS));
}

float dot2(vec2 v) {
  return dot(v, v);
}

// x * x (pow(x, 2.0) is undefined for x < 0)
float sq(float x) {
  return x * x;
}

// signed distance to a vertical trapezoid centred on the origin (Inigo Quilez, MIT):
// half-width r1 at the bottom (y = -he), r2 at the top
float sdTrapezoid(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he);
  vec2 k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, p.y < 0.0 ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0.0, 1.0);
  float sgn = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return sgn * sqrt(min(dot2(ca), dot2(cb)));
}

// signed distance to an uneven capsule (Inigo Quilez, MIT): circle r1 at the origin, r2 at (0, h)
float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}

// coverage of the inside of a signed distance, antialiased over aa
float fill(float sd, float aa) {
  return 1.0 - smoothstep(-aa, aa, sd);
}

void main() {
  vec2 grid = vec2(COLS, ROWS);
  vec2 cellF = vUv * grid;
  vec2 cell = min(floor(cellF), grid - 1.0);
  vec2 cellSize = uSize / grid;
  float unit = min(cellSize.x, cellSize.y);
  // lamp units: the cell's smaller side, origin at the cell centre
  vec2 q = (cellF - cell - 0.5) * cellSize / unit;
  float lamp = (ROWS - 1.0 - cell.y) * COLS + cell.x;
  // one pixel in lamp units, from the continuous uv (q itself jumps by a lamp at cell edges,
  // where its derivatives would smear the silhouettes into grid lines)
  vec2 lampPerUv = uSize / unit;
  float aa = max(max(fwidth(vUv.x) * lampPerUv.x, fwidth(vUv.y) * lampPerUv.y), 1e-5);

  vec4 look = lampTexel(lamp, ${f(BLOBS_PER_LAMP)});
  vec3 wax = look.rgb;
  float bulb = look.a;
  vec3 glow = mix(wax, BULB_LIGHT, 0.45) * bulb;

  float glassBottom = GLASS_LOW_Y - GLASS_LOW_R;
  float glassTop = GLASS_HIGH_Y + GLASS_HIGH_R;
  float sdGlass = sdUnevenCapsule(q - vec2(0.0, GLASS_LOW_Y), GLASS_LOW_R, GLASS_HIGH_R, GLASS_HIGH_Y - GLASS_LOW_Y);
  float sdBase = sdTrapezoid(q - vec2(0.0, 0.5 * (BASE_BOT + BASE_TOP)), BASE_HB, BASE_HT, 0.5 * (BASE_TOP - BASE_BOT));
  float sdCap = sdTrapezoid(q - vec2(0.0, 0.5 * (CAP_BOT + CAP_TOP)), CAP_HB, CAP_HT, 0.5 * (CAP_TOP - CAP_BOT));

  // the wall behind, with this lamp's light spilling onto it
  float out_ = max(sdGlass, 0.0);
  vec3 col = WALL + glow * 0.035 * exp(-out_ * out_ / 0.0042);

  // the shelf under the row: a face lit from above, a pale top edge, the lamp's light on it
  float shelfTop = BASE_BOT;
  float onShelf = 1.0 - smoothstep(shelfTop - aa, shelfTop + aa, q.y);
  vec3 shelf = SHELF + WARM_WHITE * 0.018 * exp(-sq((q.y - shelfTop) / max(0.004, aa)));
  shelf += glow * 0.03 * exp(-q.x * q.x / 0.012) * smoothstep(shelfTop - 0.03, shelfTop, q.y);
  col = mix(col, shelf, onShelf);

  // glass: liquid lit from the bulb below, metaball wax, then the glass itself
  float y01 = clamp((q.y - glassBottom) / (glassTop - glassBottom), 0.0, 1.0);
  vec3 liquid = glow * (0.03 + 0.11 * exp(-3.2 * y01));
  float field = POOL * POOL / max((q.y - glassBottom) * (q.y - glassBottom), 1e-6);
  for (int j = 0; j < ${BLOBS_PER_LAMP}; j++) {
    vec4 b = lampTexel(lamp, float(j));
    // stretched upright while it moves: taller and narrower, same area
    vec2 d = (q - b.xy) * vec2(sqrt(b.w), 1.0 / sqrt(b.w));
    field += b.z * b.z / max(dot(d, d), 1e-6);
  }
  float fw = clamp(fwidth(field), 1e-3, 0.5);
  float waxMask = smoothstep(1.0 - fw, 1.0 + fw, field);
  float heat = exp(-1.6 * y01);
  float core = smoothstep(1.0, 3.0, field);
  vec3 waxLit = wax * bulb * (0.42 + 0.33 * heat) * (0.82 + 0.18 * core);
  float inner = fill(sdGlass + GLASS_WALL, aa);
  vec3 content = mix(liquid, waxLit, waxMask * inner);
  // rim: the glass wall catches light along the silhouette; a soft highlight down the left flank
  float rim = exp(-sq((sdGlass + 0.5 * GLASS_WALL) / max(0.5 * GLASS_WALL, aa)));
  float hw = mix(GLASS_LOW_R, GLASS_HIGH_R, clamp((q.y - GLASS_LOW_Y) / (GLASS_HIGH_Y - GLASS_LOW_Y), 0.0, 1.0));
  float spec = exp(-sq((q.x / hw + 0.6) / 0.11)) * smoothstep(glassBottom + 0.02, glassBottom + 0.12, q.y) *
    (1.0 - smoothstep(glassTop - 0.1, glassTop - 0.01, q.y));
  content += mix(glow, WARM_WHITE, 0.5) * (0.07 * rim) + WARM_WHITE * (0.085 * spec);
  col = mix(col, content, fill(sdGlass, aa));

  // metal base: dark, a soft vertical sheen, and the bulb's light escaping round its collar
  float baseH = (q.y - BASE_BOT) / (BASE_TOP - BASE_BOT);
  float bw = mix(BASE_HB, BASE_HT, clamp(baseH, 0.0, 1.0));
  vec3 base = METAL * (0.7 + 0.6 * baseH) + WARM_WHITE * 0.03 * exp(-sq((q.x / bw + 0.45) / 0.2));
  base += glow * 0.16 * exp(-sq((q.y - BASE_TOP) / 0.012)) + glow * 0.025 * smoothstep(0.4, 1.0, baseH);
  col = mix(col, base, fill(sdBase, aa));

  // metal cap
  float cw = mix(CAP_HB, CAP_HT, clamp((q.y - CAP_BOT) / (CAP_TOP - CAP_BOT), 0.0, 1.0));
  vec3 cap = METAL + WARM_WHITE * 0.025 * exp(-sq((q.x / cw + 0.45) / 0.22)) +
    glow * 0.05 * exp(-sq((q.y - CAP_BOT) / 0.015));
  col = mix(col, cap, fill(sdCap, aa));

  // the whole wall a little darker towards its edges
  vec2 e = (vUv - 0.5) * 2.0;
  col *= 1.0 - 0.42 * smoothstep(0.3, 1.5, length(e * vec2(1.0, 0.92)));

  gl_FragColor = vec4(min(col, vec3(MAX_VALUE)) * uOpacity, 1.0);
}
`
