import type { AttractorSystem } from '../../types'

/** Hard limit of the `uniform float P[8]` contract in src/types.ts. */
export const MAX_PARAMS = 8

/**
 * Builds the integration fragment shader from the whole catalog. Each system's `glsl` body
 * becomes one branch of `deriv`, selected at runtime by `uSystem` (its index in SYSTEMS).
 * The branch is uniform across all fragments, so GPUs pay almost nothing for it, and
 * switching systems never recompiles.
 *
 * Output texel: vec4(position after one RK4 step, |dp/dt| at the start of the step).
 */
/**
 * The derivative function shared by the integrator and the renderer: `uniform int uSystem`,
 * `uniform float P[8]` and `vec3 deriv(vec3 v)` with one branch per catalog entry.
 */
export function buildDerivGlsl(systems: readonly AttractorSystem[]): string {
  const branches = systems
    .map((s, i) => {
      const body = s.glsl
        .trim()
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n')
      // the comment sits on its own line so shader error excerpts name the culprit
      return `  ${i === 0 ? 'if' : 'else if'} (uSystem == ${i}) {\n    // system ${i}: ${s.id}\n${body}\n  }`
    })
    .join('\n')
  return /* glsl */ `
uniform int uSystem;
uniform float P[${MAX_PARAMS}];

vec3 deriv(vec3 v) {
  vec3 d = vec3(0.0);
${branches}
  return d;
}
`
}

export function buildStepFrag(systems: readonly AttractorSystem[]): string {
  return /* glsl */ `
uniform sampler2D uState;
uniform float uDt;
uniform float uTime;
uniform vec3 uSeedCenter;
uniform float uSeedRadius;
uniform vec3 uBoundCenter;
uniform float uBound;
varying vec2 vUv;
${buildDerivGlsl(systems)}
// "Hash without Sine" (Dave Hoskins, MIT). Stable for the small, integer-ish inputs we feed it.
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// Uniform point in the unit ball from three uniforms in [0, 1).
vec3 randomPointInBall(vec3 u) {
  float z = 2.0 * u.x - 1.0;
  float phi = 6.283185307 * u.y;
  float r = pow(u.z, 1.0 / 3.0);
  float s = sqrt(max(0.0, 1.0 - z * z));
  return r * vec3(s * cos(phi), s * sin(phi), z);
}

void main() {
  vec3 p = texture2D(uState, vUv).xyz;

  // classical RK4
  vec3 k1 = deriv(p);
  vec3 k2 = deriv(p + (0.5 * uDt) * k1);
  vec3 k3 = deriv(p + (0.5 * uDt) * k2);
  vec3 k4 = deriv(p + uDt * k3);
  vec3 np = p + (uDt / 6.0) * (k1 + 2.0 * (k2 + k3) + k4);
  float speed = length(k1);

  // Respawn test. Written as !(x < limit) so it is also true for NaN (every comparison
  // with NaN is false) and for Inf (an overflowing dot is +Inf). One test covers
  // "escaped", "overflowed" and "NaN".
  vec3 off = np - uBoundCenter;
  if (!(dot(off, off) < uBound * uBound)) {
    // Hash the integer texel coordinate and a small per-pass seed, not vUv + time: once time
    // reaches the thousands, adding it to a 0..1 uv rounds neighbouring texels to the same value.
    vec3 u = hash33(vec3(gl_FragCoord.xy, uTime));
    np = uSeedCenter + uSeedRadius * randomPointInBall(u);
    speed = length(deriv(np));
  }

  gl_FragColor = vec4(np, speed);
}
`
}
