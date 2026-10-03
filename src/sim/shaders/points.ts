import { paletteGlsl } from '../../scene/palette'

/**
 * Particle sprites. Each vertex is one particle; `ref` is the uv of its texel in the state
 * texture, which holds vec4(x, y, z, speed) in system units.
 */
export const pointsVert = /* glsl */ `
${paletteGlsl}

uniform sampler2D uPos;
uniform vec3 uCenter;
uniform float uScale;
uniform float uSpeedNorm;
uniform float uColorMode;
uniform float uSize;
uniform float uDpr;

attribute vec2 ref;
attribute float aHue;

varying vec3 vColor;

void main() {
  vec4 d = texture2D(uPos, ref);
  vec4 mvPosition = modelViewMatrix * vec4((d.xyz - uCenter) * uScale, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(uSize * uDpr * (3.0 / -mvPosition.z), 1.0, 24.0);

  float t = d.w / max(uSpeedNorm, 1e-6);
  vColor = mix(speedColor(t), hueColor(aHue), uColorMode);
}
`

/**
 * Soft disc. Additive: the colour itself carries the coverage, alpha is not used.
 * Written as 1 - smoothstep(lo, hi, r) because smoothstep with edge0 > edge1 is undefined in GLSL.
 */
export const pointsFrag = /* glsl */ `
uniform float uOpacity;
uniform float uGain;

varying vec3 vColor;

void main() {
  float a = 1.0 - smoothstep(0.12, 0.5, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vColor * (a * uOpacity * uGain), 1.0);
}
`
