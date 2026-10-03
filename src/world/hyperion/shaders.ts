/**
 * Saturn, its ring and the ghost twin. Saturn and the ring light themselves from the stage's sun
 * direction (passed in Saturn's frame: pole +Y, ring in the XZ plane) so they can carry the two
 * shadows that make Saturn read as Saturn: the planet's on the ring and the ring's on the planet.
 * Values are linear and kept under the main bloom's threshold (0.75): the lit limb tops out
 * near 0.7, the night side near 0.02.
 */
import { paletteGlsl } from '../../scene/palette'

export const SATURN_RADIUS = 0.9
/** polar / equatorial radius */
export const SATURN_FLATTENING = 0.9
export const RING_INNER = 1.25
export const RING_OUTER = 2.1

const f = (x: number) => x.toFixed(4)

/** the ring's radial profile, shared by the ring and the shadow it casts on the planet */
const ringGlsl = /* glsl */ `
const float SATURN_R = ${f(SATURN_RADIUS)};
const float FLAT = ${f(SATURN_FLATTENING)};

float band(float x, float lo, float hi, float w) {
  return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x));
}

/**
 * Opacity of the ring at radius r (render units), from Saturn's real profile in Saturn radii:
 * the faint C ring, the dense B ring, the Cassini division, the A ring with the Encke gap, and
 * the thin F ring. w is the smallest edge width (pass the pixel footprint to anti-alias).
 */
float ringProfile(float r, float w) {
  float x = r / SATURN_R;
  float op = 0.13 * band(x, 1.42, 1.525, max(w, 0.02));
  op += mix(0.6, 0.9, smoothstep(1.56, 1.82, x)) * band(x, 1.525, 1.95, max(w, 0.006));
  op += 0.05 * band(x, 1.95, 2.025, max(w, 0.006));
  float a = 0.5 * band(x, 2.025, 2.27, max(w, 0.006));
  float encke = max(w, 0.004);
  a *= 1.0 - 0.9 * (0.004 / encke) * (1.0 - smoothstep(0.0, encke, abs(x - 2.214)));
  op += a;
  float fw = max(w, 0.003);
  op += 0.35 * (0.003 / fw) * (1.0 - smoothstep(0.0, fw, abs(x - 2.322)));
  return op;
}
`

const srgbGlsl = /* glsl */ `
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
`

// ---------------------------------------------------------------- Saturn

export const saturnVert = /* glsl */ `
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vObj = position;
  vObjN = normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vViewN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`

export const saturnFrag = /* glsl */ `
uniform vec3 uLight;     // unit vector toward the sun, Saturn's frame
uniform float uSun;      // direct gain
uniform float uAmbient;  // floor on the night side
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
${ringGlsl}
${srgbGlsl}

/** soft latitude bands: a few sines, a bright equatorial zone, greyer poles */
vec3 bands(float lat) {
  float b = 0.5 * sin(lat * 9.0 + 0.6) + 0.3 * sin(lat * 17.0 + 1.9) + 0.2 * sin(lat * 29.0 + 0.4);
  vec3 c = mix(vec3(0.93, 0.86, 0.69), vec3(0.81, 0.68, 0.50), 0.5 + 0.4 * b);
  c = mix(c, vec3(0.95, 0.89, 0.74), 0.7 * exp(-lat * lat / 0.012));
  c = mix(c, vec3(0.62, 0.64, 0.66), smoothstep(0.95, 1.4, abs(lat)));
  return toLinear(c);
}

void main() {
  vec3 n = normalize(vObjN);
  vec3 albedo = bands(asin(clamp(n.y, -1.0, 1.0)));

  float ndl = dot(n, uLight);
  // Lambert with a short wrap, and a warmer twilight band at the terminator
  float dif = pow(clamp((ndl + 0.03) / 1.03, 0.0, 1.0), 0.9);
  vec3 tint = mix(vec3(1.0, 0.74, 0.52), vec3(1.0), smoothstep(0.0, 0.3, ndl));
  // limb darkening
  float nv = abs(dot(normalize(vViewN), normalize(-vViewPos)));
  float limb = 0.55 + 0.45 * sqrt(nv);

  // the ring's shadow: points across the ring plane from the sun see it through the ring
  // (the footprint is taken outside the branch: derivatives inside a non-uniform branch are
  // undefined, and without one the thin ringlets' shadows alias to crawling 1-px lines)
  float shade = 1.0;
  float tShadow = -vObj.y / uLight.y;
  vec2 hShadow = vObj.xz + tShadow * uLight.xz;
  float rShadow = length(hShadow);
  float wShadow = fwidth(rShadow) / SATURN_R;
  if (vObj.y * uLight.y < 0.0) {
    shade = 1.0 - 0.88 * clamp(ringProfile(rShadow, wShadow), 0.0, 1.0);
  }
  // a little ringshine on the hemisphere that faces the ring's sunlit face
  float ringshine = 0.012 * max(0.0, n.y * sign(uLight.y));

  vec3 col = albedo * (uSun * dif * shade * limb * tint + uAmbient + ringshine);
  gl_FragColor = vec4(col, 1.0);
}
`

// ---------------------------------------------------------------- the ring

export const ringVert = /* glsl */ `
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const ringFrag = /* glsl */ `
uniform vec3 uLight;
uniform float uSun;
varying vec3 vObj;
${ringGlsl}
${srgbGlsl}

float aa(float freq, float fw) { return clamp(1.0 - fw * freq / 3.14159, 0.0, 1.0); }

/** ±12 % ringlets, each harmonic faded out before it can alias */
float ringlets(float x, float fw) {
  return 1.0
    + 0.12 * sin(x * 97.0 + 0.7) * aa(97.0, fw)
    + 0.08 * sin(x * 233.0 + 2.1) * aa(233.0, fw)
    + 0.06 * sin(x * 521.0 + 0.3) * aa(521.0, fw);
}

vec3 ringAlbedo(float x) {
  vec3 c = vec3(0.50, 0.47, 0.45);
  c = mix(c, vec3(0.86, 0.78, 0.64), smoothstep(1.50, 1.62, x));
  c = mix(c, vec3(0.74, 0.70, 0.64), smoothstep(1.96, 2.04, x));
  return toLinear(c);
}

/** 0 inside Saturn's shadow, 1 in sunlight (the planet is an ellipsoid: squash y to a sphere) */
float planetShadow(vec3 p, vec3 l) {
  vec3 ps = vec3(p.x, p.y / FLAT, p.z);
  vec3 ls = normalize(vec3(l.x, l.y / FLAT, l.z));
  float tc = -dot(ps, ls);
  if (tc <= 0.0) return 1.0;
  float d = length(ps + tc * ls);
  return smoothstep(SATURN_R * 0.985, SATURN_R * 1.01, d);
}

void main() {
  float r = length(vObj.xz);
  float x = r / SATURN_R;
  float fw = fwidth(x);
  float op = clamp(ringProfile(r, fw) * ringlets(x, fw), 0.0, 0.96);
  if (op < 0.002) discard;
  vec3 albedo = ringAlbedo(x);
  float sun = uSun * planetShadow(vObj, uLight);
  // the sunlit face reflects; from the other face only light scattered through the thin parts
  // shows, so the dense B ring goes dark and the C ring and Cassini division glow
  float side = gl_FrontFacing ? 1.0 : -1.0;
  float lit = side * uLight.y > 0.0 ? op : 1.6 * op * (1.0 - op);
  gl_FragColor = vec4(albedo * sun * lit, op);
}
`

// ---------------------------------------------------------------- the ghost twin

export const ghostVert = /* glsl */ `
attribute float aShade;
varying vec3 vN;
varying vec3 vV;
varying float vShade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vShade = aShade;
  gl_Position = projectionMatrix * mv;
}
`

/**
 * The copy: unlit violet at uOpacity, a little denser at the silhouette so the tumbling shape
 * reads in 3D, with the same dark crater floors as the real moon so the faces can be compared.
 */
export const ghostFrag = /* glsl */ `
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
varying float vShade;
${paletteGlsl}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float rim = pow(max(0.0, 1.0 - abs(dot(n, v))), 2.5);
  float a = uOpacity * (0.75 * mix(0.45, 1.0, vShade) + 1.3 * rim);
  gl_FragColor = vec4(speedColor(0.4) * a, 1.0);
}
`
