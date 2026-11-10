/**
 * A wall of lava lamps, 6 × 4: the first 24 lamps of the old wall (src/world/taffy/lava.ts),
 * drawn larger, their wax in the act's hot colours. Every blob is computed on the CPU in double
 * precision each frame and uploaded as a small float texture; one plane's fragment shader draws
 * a lamp per cell from signed distances (shelf, metal base, glass lit from the bulb below,
 * metaball wax, cap) with a soft highlight down the glass. The key is a hash of the same blobs,
 * so the hex on screen is the wax you see.
 */
import * as THREE from 'three'
import { rampColor, type Palette } from '../../engine/palettes'
import { LAMPS, LAMP_SHAPE, fnv256Byte, fnv256Hex, fnv256Reset, glassHalfWidth, type LampParams } from '../../world/taffy/lava'

export const COLS = 6
export const ROWS = 4
const COUNT = COLS * ROWS
const BLOBS = 3
/** texels per lamp: one per blob, then the lamp's wax colour and bulb */
const TEXELS = BLOBS + 1
/** where each of the old wall's eight wax colours sits on the act's ramp */
const WAX_TONE = [0.5, 0.44, 0.64, 0.8, 0.56, 0.72, 0.4, 0.86]

const S = LAMP_SHAPE
const GLASS_BOTTOM = S.glassLowY - S.glassLowR
const GLASS_TOP = S.glassHighY + S.glassHighR
const TAU = Math.PI * 2
const frac = (x: number) => x - Math.floor(x)

function blobHeight(lamp: LampParams, j: number, t: number): number {
  const c = frac(lamp.riseHz[j] * t + lamp.risePhase[j])
  const s = 0.5 - 0.5 * Math.cos(TAU * c)
  const linger = s * s * (3 - 2 * s)
  const wob = 0.5 + 0.5 * Math.sin(TAU * frac(lamp.wobbleHz[j] * t + lamp.wobblePhase[j]))
  return Math.min(Math.max(0.9 * linger + 0.1 * wob, 0), 1)
}

const BLOB_LOW = GLASS_BOTTOM + S.poolDepth * 0.6
const blobHigh = (r: number) => GLASS_TOP - S.glassWall - 1.6 * r

/** blobs at time t (seconds): (x, y, radius, stretch) per blob, lamp units */
function blobs(t: number, out: Float32Array | Float64Array) {
  const dt = 0.05
  for (let i = 0; i < COUNT; i++) {
    const lamp = LAMPS[i]
    for (let j = 0; j < BLOBS; j++) {
      const r = lamp.radius[j]
      const lo = BLOB_LOW
      const hi = blobHigh(r)
      const y = lo + (hi - lo) * blobHeight(lamp, j, t)
      const vy = ((blobHeight(lamp, j, t + dt) - blobHeight(lamp, j, t - dt)) * (hi - lo)) / (2 * dt)
      const stretch = 1 + 0.45 * Math.min(Math.abs(vy) / 0.03, 1)
      const ax = r / Math.sqrt(stretch)
      const ay = r * Math.sqrt(stretch)
      let free = Infinity
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * TAU
        const room = glassHalfWidth(y + ay * Math.sin(th)) - S.glassWall - Math.abs(ax * Math.cos(th))
        if (room < free) free = room
      }
      free = Math.max(free, 0)
      const x = free * lamp.sway[j] * Math.sin(TAU * frac(lamp.swayHz[j] * t + lamp.swayPhase[j]))
      const o = (i * TEXELS + j) * 4
      out[o] = x
      out[o + 1] = y
      out[o + 2] = r
      out[o + 3] = stretch
    }
  }
}

const keyBlobs = new Float64Array(COUNT * TEXELS * 4)
const quantise = (v: number, lo: number, hi: number) => Math.min(255, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * 256)))

/** every blob centre to a byte in x and y, hashed (FNV-1a 256): 64 hex characters */
export function wallKey(t: number): string {
  blobs(t, keyBlobs)
  fnv256Reset()
  for (let i = 0; i < COUNT; i++) {
    for (let j = 0; j < BLOBS; j++) {
      const o = (i * TEXELS + j) * 4
      fnv256Byte(quantise(keyBlobs[o], -0.13, 0.13))
      fnv256Byte(quantise(keyBlobs[o + 1], GLASS_BOTTOM, GLASS_TOP))
    }
  }
  return fnv256Hex()
}

const f = (x: number) => x.toFixed(6)

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const frag = /* glsl */ `
uniform sampler2D uLamps;
uniform vec2 uSize;
uniform float uOpacity;
uniform float uGain;
uniform vec3 uWall;
uniform vec3 uMetal;
uniform vec3 uBulb;
uniform vec3 uWhite;
varying vec2 vUv;

const float COLS = ${f(COLS)};
const float ROWS = ${f(ROWS)};
const float LAMPS = ${f(COUNT)};
const float TEXELS = ${f(TEXELS)};
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

vec4 lampTexel(float lamp, float j) {
  return texture2D(uLamps, vec2((j + 0.5) / TEXELS, (lamp + 0.5) / LAMPS));
}
float dot2(vec2 v) { return dot(v, v); }
float sq(float x) { return x * x; }

// signed distances (Inigo Quilez, MIT)
float sdTrapezoid(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he);
  vec2 k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, p.y < 0.0 ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0.0, 1.0);
  float sgn = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return sgn * sqrt(min(dot2(ca), dot2(cb)));
}
float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}
float fill(float sd, float aa) { return 1.0 - smoothstep(-aa, aa, sd); }

void main() {
  vec2 grid = vec2(COLS, ROWS);
  vec2 cellF = vUv * grid;
  vec2 cell = min(floor(cellF), grid - 1.0);
  vec2 cellSize = uSize / grid;
  float unit = min(cellSize.x, cellSize.y);
  vec2 q = (cellF - cell - 0.5) * cellSize / unit;
  float lamp = (ROWS - 1.0 - cell.y) * COLS + cell.x;
  vec2 lampPerUv = uSize / unit;
  float aa = max(max(fwidth(vUv.x) * lampPerUv.x, fwidth(vUv.y) * lampPerUv.y), 1e-5);

  vec4 look = lampTexel(lamp, ${f(BLOBS)});
  vec3 wax = look.rgb;
  float bulb = look.a;
  vec3 glow = mix(wax, uBulb, 0.45) * bulb;

  float glassBottom = GLASS_LOW_Y - GLASS_LOW_R;
  float glassTop = GLASS_HIGH_Y + GLASS_HIGH_R;
  float sdGlass = sdUnevenCapsule(q - vec2(0.0, GLASS_LOW_Y), GLASS_LOW_R, GLASS_HIGH_R, GLASS_HIGH_Y - GLASS_LOW_Y);
  float sdBase = sdTrapezoid(q - vec2(0.0, 0.5 * (BASE_BOT + BASE_TOP)), BASE_HB, BASE_HT, 0.5 * (BASE_TOP - BASE_BOT));
  float sdCap = sdTrapezoid(q - vec2(0.0, 0.5 * (CAP_BOT + CAP_TOP)), CAP_HB, CAP_HT, 0.5 * (CAP_TOP - CAP_BOT));

  // the wall, with this lamp's light spilling onto it
  float out_ = max(sdGlass, 0.0);
  vec3 col = uWall + glow * 0.05 * exp(-out_ * out_ / 0.006);

  // the shelf under the row
  float shelfTop = BASE_BOT;
  float onShelf = 1.0 - smoothstep(shelfTop - aa, shelfTop + aa, q.y);
  vec3 shelf = uWall * 1.6 + uWhite * 0.02 * exp(-sq((q.y - shelfTop) / max(0.004, aa)));
  shelf += glow * 0.04 * exp(-q.x * q.x / 0.012) * smoothstep(shelfTop - 0.03, shelfTop, q.y);
  col = mix(col, shelf, onShelf);

  // glass: liquid lit from the bulb, metaball wax, then the glass itself
  float y01 = clamp((q.y - glassBottom) / (glassTop - glassBottom), 0.0, 1.0);
  vec3 liquid = glow * (0.035 + 0.13 * exp(-3.2 * y01));
  float field = POOL * POOL / max((q.y - glassBottom) * (q.y - glassBottom), 1e-6);
  for (int j = 0; j < ${BLOBS}; j++) {
    vec4 b = lampTexel(lamp, float(j));
    vec2 d = (q - b.xy) * vec2(sqrt(b.w), 1.0 / sqrt(b.w));
    field += b.z * b.z / max(dot(d, d), 1e-6);
  }
  float fw = clamp(fwidth(field), 1e-3, 0.5);
  float waxMask = smoothstep(1.0 - fw, 1.0 + fw, field);
  float heat = exp(-1.6 * y01);
  float core = smoothstep(1.0, 3.0, field);
  // wax is lit from inside: brighter low down and in its thick middle, a little rim darkening
  vec3 waxLit = wax * bulb * (0.42 + 0.38 * heat) * (0.72 + 0.28 * core);
  float inner = fill(sdGlass + GLASS_WALL, aa);
  vec3 content = mix(liquid, waxLit, waxMask * inner);
  float rim = exp(-sq((sdGlass + 0.5 * GLASS_WALL) / max(0.5 * GLASS_WALL, aa)));
  float hw = mix(GLASS_LOW_R, GLASS_HIGH_R, clamp((q.y - GLASS_LOW_Y) / (GLASS_HIGH_Y - GLASS_LOW_Y), 0.0, 1.0));
  // a soft window highlight down the left of the glass, and a fainter one on the right
  float spec = exp(-sq((q.x / hw + 0.58) / 0.1)) + 0.35 * exp(-sq((q.x / hw - 0.66) / 0.06));
  spec *= smoothstep(glassBottom + 0.02, glassBottom + 0.12, q.y) * (1.0 - smoothstep(glassTop - 0.1, glassTop - 0.01, q.y));
  content += mix(glow, uWhite, 0.5) * (0.08 * rim) + uWhite * (0.075 * spec);
  col = mix(col, content, fill(sdGlass, aa));

  // metal base and cap: dark, a soft sheen, the bulb's light escaping round the collar
  float baseH = (q.y - BASE_BOT) / (BASE_TOP - BASE_BOT);
  float bw = mix(BASE_HB, BASE_HT, clamp(baseH, 0.0, 1.0));
  vec3 base = uMetal * (0.7 + 0.6 * baseH) + uWhite * 0.03 * exp(-sq((q.x / bw + 0.45) / 0.2));
  base += glow * 0.18 * exp(-sq((q.y - BASE_TOP) / 0.012)) + glow * 0.03 * smoothstep(0.4, 1.0, baseH);
  col = mix(col, base, fill(sdBase, aa));
  float cw = mix(CAP_HB, CAP_HT, clamp((q.y - CAP_BOT) / (CAP_TOP - CAP_BOT), 0.0, 1.0));
  vec3 cap = uMetal + uWhite * 0.025 * exp(-sq((q.x / cw + 0.45) / 0.22)) + glow * 0.06 * exp(-sq((q.y - CAP_BOT) / 0.015));
  col = mix(col, cap, fill(sdCap, aa));

  vec2 e = (vUv - 0.5) * 2.0;
  col *= 1.0 - 0.45 * smoothstep(0.35, 1.5, length(e * vec2(1.0, 0.92)));
  gl_FragColor = vec4(col * uGain, uOpacity);
}
`

export function createLampWall(palette: Palette, width: number, height: number) {
  const data = new Float32Array(COUNT * TEXELS * 4)
  const texture = new THREE.DataTexture(data, TEXELS, COUNT, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  const c = new THREE.Color()
  for (let i = 0; i < COUNT; i++) {
    const lamp = LAMPS[i]
    rampColor(palette, WAX_TONE[lamp.wax] ?? 0.7, c)
    const o = (i * TEXELS + BLOBS) * 4
    data[o] = c.r
    data[o + 1] = c.g
    data[o + 2] = c.b
    data[o + 3] = lamp.bulb
  }
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uLamps: { value: texture },
      uSize: { value: new THREE.Vector2(width, height) },
      uOpacity: { value: 0 },
      uGain: { value: 1.6 },
      uWall: { value: palette.sky.clone().multiplyScalar(1.4) },
      uMetal: { value: rampColor(palette, 0.1).multiplyScalar(0.6) },
      uBulb: { value: rampColor(palette, 0.95) },
      uWhite: { value: rampColor(palette, 1) },
    },
    toneMapped: false,
  })
  const geometry = new THREE.PlaneGeometry(width, height)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1
  mesh.visible = false
  return {
    mesh,
    material,
    update(t: number) {
      blobs(t, data)
      texture.needsUpdate = true
    },
    set opacity(v: number) {
      material.uniforms.uOpacity.value = v
      material.transparent = v < 0.995
      material.depthWrite = v > 0.4
      mesh.visible = v > 0.002
    },
    dispose() {
      texture.dispose()
      material.dispose()
      geometry.dispose()
    },
  }
}
