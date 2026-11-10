/**
 * The solid things in the Hyperion scene: Saturn's globe, Hyperion itself and its ghost twin.
 * Saturn keeps its true colours (soft butterscotch bands), graded warm; it carries the shadow of
 * its rings, a soft terminator with a warm edge, darkening toward the limb. Hyperion is a
 * sponge: the shape from the old stage, its surface pitted by two scales of cellular craters
 * shaded in the fragment shader. Everything is lit by one sun, given per frame.
 */
import * as THREE from 'three'
import { buildMoonShape } from '../../world/hyperion/shape'
import { SATURN_FLAT, SATURN_R, ringGlsl } from './rings'

const saturnVert = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vWorldN;
varying vec3 vView;
void main() {
  vObj = position;
  vN = normalize(normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const saturnFrag = /* glsl */ `
uniform vec3 uLight;      // toward the sun, Saturn's frame
uniform float uSun;
uniform float uOpacity;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vWorldN;
varying vec3 vView;

const float R = ${SATURN_R.toFixed(5)};
${ringGlsl}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

/** soft latitude bands, a pale equatorial zone, greyer blue-green poles; a little turbulence */
vec3 bands(float lat, float lon) {
  float w = lat + 0.012 * sin(lon * 5.0 + lat * 31.0) + 0.02 * (vnoise(vec2(lon * 6.0, lat * 40.0)) - 0.5);
  float b = 0.5 * sin(w * 10.0 + 0.6) + 0.3 * sin(w * 19.0 + 1.9) + 0.2 * sin(w * 37.0 + 0.4) + 0.12 * sin(w * 71.0);
  vec3 c = mix(vec3(0.9, 0.78, 0.56), vec3(0.72, 0.55, 0.35), 0.5 + 0.45 * b);
  c = mix(c, vec3(0.94, 0.85, 0.64), 0.7 * exp(-w * w / 0.01));
  c = mix(c, vec3(0.62, 0.6, 0.52), smoothstep(0.85, 1.35, abs(lat)));
  return toLinear(c);
}

void main() {
  vec3 n = normalize(vN);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.z, n.x);
  vec3 albedo = bands(lat, lon) * vec3(1.04, 0.97, 0.88);

  float ndl = dot(n, uLight);
  // a soft terminator, warmer and redder where the light grazes
  float dif = smoothstep(-0.10, 0.75, ndl);
  dif = dif * dif * (0.6 + 0.4 * dif);
  vec3 tint = mix(vec3(1.0, 0.55, 0.32), vec3(1.0), smoothstep(0.0, 0.45, ndl));
  vec3 v = normalize(vView);
  float nv = clamp(dot(normalize(vWorldN), v), 0.0, 1.0);
  float limb = 0.5 + 0.5 * pow(nv, 0.45);

  // the rings' shadow: trace toward the sun to the ring plane
  float shade = 1.0;
  float t = -vObj.y / uLight.y;
  vec2 h = vObj.xz + t * uLight.xz;
  float x = length(h) / R;
  float fw = fwidth(x);
  if (vObj.y * uLight.y < 0.0) shade = 1.0 - 0.9 * clamp(ringOpacity(x, fw), 0.0, 1.0);

  // a thin warm glow on the lit limb (haze high in the atmosphere)
  float rim = pow(1.0 - nv, 3.5) * smoothstep(-0.2, 0.3, ndl);
  // light thrown back up from the sunlit face of the rings
  float ringshine = 0.018 * max(0.0, n.y * sign(uLight.y));

  vec3 col = albedo * (uSun * dif * shade * limb * tint + ringshine + 0.004);
  col += vec3(1.0, 0.62, 0.36) * rim * 0.28 * uSun;
  gl_FragColor = vec4(col, uOpacity);
}
`

/** Saturn's globe: a squashed sphere, opaque, writes depth so the far side of the rings hides */
export function createSaturn() {
  const geometry = new THREE.SphereGeometry(SATURN_R, 160, 100).scale(1, SATURN_FLAT, 1)
  const material = new THREE.ShaderMaterial({
    vertexShader: saturnVert,
    fragmentShader: saturnFrag,
    uniforms: {
      uLight: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: 0.92 },
      uOpacity: { value: 0 },
    },
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1
  return {
    mesh,
    material,
    set opacity(v: number) {
      setOpacity(material, v)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

function setOpacity(material: THREE.ShaderMaterial, v: number) {
  material.uniforms.uOpacity.value = v
  const solid = v > 0.995
  material.transparent = !solid
  material.depthWrite = v > 0.4
  material.visible = v > 0.002
}

// ---------------------------------------------------------------- the moon

export const MOON_SCALE = 0.32

const moonVert = /* glsl */ `
attribute float aShade;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying float vShade;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vShade = aShade;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

/** cellular pits: 0 on the rim, deeper toward each cell's centre */
const spongeGlsl = /* glsl */ `
const float SPONGE_SCALE = ${(1 / (0.26 * MOON_SCALE)).toFixed(4)};
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// distance to the nearest feature point (x) and the vector from here to it (yzw)
vec4 worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec4 best = vec4(8.0, 0.0, 0.0, 0.0);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + hash3(i + g) - f;
    float d = dot(r, r);
    if (d < best.x) best = vec4(d, r);
  }
  best.x = sqrt(best.x);
  return best;
}
// one size of round bowls: height (x) and its gradient (yzw), in the noise's own units
vec4 bowls(vec3 q, float R) {
  vec4 w = worley(q);
  float x = min(w.x / R, 1.0);
  float h = sqrt(1.0 - x * x);
  vec3 dF = -w.yzw / max(w.x, 1e-4);
  return vec4(h, (-x / (R * max(h, 0.18))) * dF);
}
// packed bowls with steep walls and sharp rims, two sizes: height and its gradient in object units
vec4 sponge(vec3 p) {
  vec3 q = p * SPONGE_SCALE;
  vec4 a = bowls(q * 2.6, 0.66);
  vec4 b = bowls(q * 6.5 + 7.3, 0.55);
  return vec4(0.75 * a.x + 0.25 * b.x, (0.75 * 2.6 * a.yzw + 0.25 * 6.5 * b.yzw) * SPONGE_SCALE);
}
`

const moonFrag = /* glsl */ `
uniform vec3 uLight;     // toward the sun, world
uniform vec3 uFillDir;   // toward Saturn, world
uniform vec3 uAlbedo;
uniform vec3 uFill;
uniform float uSun;
uniform float uBump;
uniform float uOpacity;
uniform mat3 uRot;     // the body's turn, object → world
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying float vShade;
${spongeGlsl}

void main() {
  vec4 sp = sponge(vObj);
  float h = sp.x;
  // bump: the height's gradient in the body's own space, turned into the world
  vec3 g = uRot * sp.yzw;
  vec3 n = normalize(vN);
  // g is the gradient of depth: the surface tilts down into each bowl
  n = normalize(n + uBump * (g - dot(g, n) * n));

  float ndl = dot(n, uLight);
  // a rough, dusty surface: light falls off more gently than Lambert near the terminator
  float dif = pow(clamp((ndl + 0.12) / 1.12, 0.0, 1.0), 1.2);
  // crater floors are darker than the rims
  float cavity = mix(1.0, 0.62, h);
  vec3 alb = uAlbedo * vShade * cavity;
  vec3 col = alb * (uSun * dif + uFill * max(dot(n, uFillDir), 0.0) + vec3(0.006));
  gl_FragColor = vec4(col, uOpacity);
}
`

const ghostFrag = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying float vShade;
${spongeGlsl}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWorld);
  float nv = abs(dot(n, v));
  float rim = pow(1.0 - nv, 2.2);
  float lit = 0.5 + 0.5 * dot(n, uLight);
  float h = sponge(vObj).x;
  float body = (0.08 + 0.3 * lit * lit) * mix(1.0, 0.45, h) * vShade;
  gl_FragColor = vec4(uColor * (body + 1.1 * rim) * uOpacity, 1.0);
}
`

export function createMoons() {
  const shape = buildMoonShape(MOON_SCALE)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(shape.index, 1))
  geometry.setAttribute('aShade', new THREE.BufferAttribute(shape.shade, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const light = new THREE.Vector3(0, 1, 0)
  const moonMaterial = new THREE.ShaderMaterial({
    vertexShader: moonVert,
    fragmentShader: moonFrag,
    uniforms: {
      uLight: { value: light },
      uFillDir: { value: new THREE.Vector3(1, 0, 0) },
      // Hyperion is a reddish grey-brown, graded warm
      uAlbedo: { value: new THREE.Color(0.44, 0.33, 0.24) },
      uFill: { value: new THREE.Color(0.05, 0.035, 0.02) },
      uSun: { value: 1.35 },
      uBump: { value: 0.0026 },
      uRot: { value: new THREE.Matrix3() },
      uOpacity: { value: 0 },
    },
    toneMapped: false,
  })
  const ghostMaterial = new THREE.ShaderMaterial({
    vertexShader: moonVert,
    fragmentShader: ghostFrag,
    uniforms: {
      uLight: { value: light },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const moon = new THREE.Mesh(geometry, moonMaterial)
  const ghost = new THREE.Mesh(geometry, ghostMaterial)
  moon.renderOrder = 2
  ghost.renderOrder = 12
  ghost.visible = false
  return {
    moon,
    ghost,
    light,
    moonMaterial,
    ghostMaterial,
    set moonOpacity(v: number) {
      setOpacity(moonMaterial, v)
    },
    set ghostOpacity(v: number) {
      ghostMaterial.uniforms.uOpacity.value = v
      ghost.visible = v > 0.002
    },
    dispose() {
      geometry.dispose()
      moonMaterial.dispose()
      ghostMaterial.dispose()
    },
  }
}
