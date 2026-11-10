/**
 * Saturn's rings as dust: every particle a moonlet on its own circular Kepler orbit, inner ones
 * overtaking outer ones (angular speed ∝ r^−3/2). Radii are drawn from the real ring profile
 * (faint C ring, dense B ring, the Cassini division, the A ring with the Encke gap, the thin
 * F ring), so the bands appear because the particles are there, not because they are painted.
 * The planet's shadow falls across them. A sprinkle of particles is kept back as distant stars.
 */
import * as THREE from 'three'
import { FragmentSource } from '../kit/FragmentSource'

/** Saturn's equatorial radius, world units */
export const SATURN_R = 0.55
/** polar / equatorial */
export const SATURN_FLAT = 0.9

/** ring structure in Saturn radii */
const C_IN = 1.24
const B_IN = 1.525
const B_OUT = 1.95
const A_IN = 2.025
const A_OUT = 2.27
const ENCKE = 2.214
const F_RING = 2.32

const band = (x: number, lo: number, hi: number, w: number) => {
  const s = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  return s(lo - w, lo + w, x) * (1 - s(hi - w, hi + w, x))
}

/** optical depth-like opacity at x Saturn radii (the same numbers as the GLSL below) */
export function ringOpacity(x: number): number {
  let op = 0.12 * band(x, C_IN, B_IN, 0.015)
  op += (0.62 + 0.3 * Math.min(1, Math.max(0, (x - 1.56) / 0.26))) * band(x, B_IN, B_OUT, 0.006)
  op += 0.05 * band(x, B_OUT, A_IN, 0.006)
  let a = 0.5 * band(x, A_IN, A_OUT, 0.006)
  a *= 1 - 0.92 * Math.exp(-(((x - ENCKE) / 0.0045) ** 2))
  op += a
  op += 0.35 * Math.exp(-(((x - F_RING) / 0.004) ** 2))
  return op
}

/** reflectivity: the B ring brightest, the C ring and the division grey and dim */
function ringAlbedo(x: number): number {
  let al = 0.3
  al += (0.86 - 0.3) * band(x, B_IN + 0.05, B_OUT + 0.02, 0.06)
  al += (0.68 - 0.3) * band(x, A_IN, A_OUT + 0.05, 0.02)
  al += (0.6 - 0.3) * Math.exp(-(((x - F_RING) / 0.01) ** 2))
  // fine ringlets
  al *= 1 + 0.09 * Math.sin(x * 97 + 0.7) + 0.06 * Math.sin(x * 233 + 2.1) + 0.04 * Math.sin(x * 521 + 0.3)
  return al
}

/** GLSL twin of ringOpacity, for the shadow the rings throw on the globe */
export const ringGlsl = /* glsl */ `
float ringBand(float x, float lo, float hi, float w) {
  return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x));
}
float ringOpacity(float x, float w) {
  float op = 0.12 * ringBand(x, ${C_IN.toFixed(4)}, ${B_IN.toFixed(4)}, max(w, 0.015));
  op += (0.62 + 0.3 * clamp((x - 1.56) / 0.26, 0.0, 1.0)) * ringBand(x, ${B_IN.toFixed(4)}, ${B_OUT.toFixed(4)}, max(w, 0.006));
  op += 0.05 * ringBand(x, ${B_OUT.toFixed(4)}, ${A_IN.toFixed(4)}, max(w, 0.006));
  float a = 0.5 * ringBand(x, ${A_IN.toFixed(4)}, ${A_OUT.toFixed(4)}, max(w, 0.006));
  float ew = max(w, 0.0045);
  a *= 1.0 - 0.92 * (0.0045 / ew) * exp(-pow((x - ${ENCKE.toFixed(4)}) / ew, 2.0));
  op += a;
  float fw = max(w, 0.004);
  op += 0.35 * (0.004 / fw) * exp(-pow((x - ${F_RING.toFixed(4)}) / fw, 2.0));
  return op;
}
`

const ringFrag = /* glsl */ `
uniform sampler2D uData;
uniform vec3 uLight;     // toward the sun, ring frame (ring in xz, pole +y)
uniform float uOmega;    // radians per second at r = 1
uniform float uTime;
varying vec2 vUv;

const float R = ${SATURN_R.toFixed(5)};
const float FLAT = ${SATURN_FLAT.toFixed(5)};

/** 1 in sunlight, 0 inside the planet's shadow (the globe is an ellipsoid: squash y to a sphere) */
float sunlit(vec3 p, vec3 l) {
  vec3 ps = vec3(p.x, p.y / FLAT, p.z);
  vec3 ls = normalize(vec3(l.x, l.y / FLAT, l.z));
  float tc = -dot(ps, ls);
  if (tc <= 0.0) return 1.0;
  float d = length(ps + tc * ls);
  return smoothstep(R * 0.975, R * 1.02, d);
}

void main() {
  vec4 d = texture2D(uData, vUv);
  if (d.x > 10.0) {
    // a star: d = (radius, azimuth, cos polar, brightness)
    float s = sqrt(1.0 - d.z * d.z);
    gl_FragColor = vec4(d.x * vec3(s * cos(d.y), d.z, s * sin(d.y)), d.w);
    return;
  }
  float th = d.y + uOmega * pow(d.x, -1.5) * uTime;
  vec3 p = vec3(d.x * cos(th), d.z, -d.x * sin(th));
  float lit = sunlit(p, uLight);
  // the sunlit face reflects; seen from the other face only the thin parts let light through
  gl_FragColor = vec4(p, d.w * mix(0.035, 1.0, lit));
}
`

/** share of the dust kept back as stars */
const STAR_SHARE = 0.012

export function createRings(renderer: THREE.WebGLRenderer, size: number) {
  const count = size * size
  const data = new Float32Array(count * 4)
  let seed = 0x5a7c4e11
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand())

  // inverse CDF of (particles per unit area × circumference) across the rings
  const N = 8192
  const lo = 1.2
  const hi = 2.36
  const cdf = new Float64Array(N + 1)
  for (let i = 0; i < N; i++) {
    const x = lo + ((i + 0.5) / N) * (hi - lo)
    // a dim ring needs some particles to be seen at all: density follows opacity, softened
    const op = ringOpacity(x)
    cdf[i + 1] = cdf[i] + Math.pow(op, 0.9) * x * (x < B_IN ? 0.6 : 1)
  }
  const total = cdf[N]
  const sampleX = (u: number) => {
    const target = u * total
    let a = 0
    let b = N
    while (b - a > 1) {
      const m = (a + b) >> 1
      if (cdf[m] < target) a = m
      else b = m
    }
    const f = (target - cdf[a]) / Math.max(1e-12, cdf[b] - cdf[a])
    return lo + ((a + f) / N) * (hi - lo)
  }

  const stars = Math.floor(count * STAR_SHARE)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    if (i % Math.round(1 / STAR_SHARE) === 0 && i / Math.round(1 / STAR_SHARE) < stars) {
      data[o] = 26 + 10 * rand()
      data[o + 1] = rand() * Math.PI * 2
      data[o + 2] = rand() * 2 - 1
      // most stars faint, a few bright
      data[o + 3] = 0.16 + 0.5 * Math.pow(rand(), 6)
      continue
    }
    const x = sampleX(rand())
    data[o] = x * SATURN_R
    data[o + 1] = rand() * Math.PI * 2
    // a few metres thick in reality; here a hair, thicker in the dense B ring's wake
    data[o + 2] = gauss() * 0.0016
    const al = ringAlbedo(x) * (0.94 + 0.12 * rand())
    data[o + 3] = Math.min(1, al)
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true

  const light = new THREE.Vector3(-0.6, 0.45, 0.6).normalize()
  const src = new FragmentSource(renderer, size, ringFrag, {
    uData: { value: tex },
    uLight: { value: light },
    uOmega: { value: 0.05 },
  })
  src.run()
  return {
    source: src,
    light,
    dispose() {
      src.dispose()
      tex.dispose()
    },
  }
}
