/**
 * Colour functions shared by the swarm and anything else that paints particles.
 * Injected verbatim into shaders. Keep GLSL ES 1.0 compatible.
 *
 *  speedColor(t)  t∈[0,1]  slow → fast: deep ultramarine → electric violet → rose → warm white
 *  hueColor(h)    h∈[0,1]  a pastel wheel used when colouring particles by where they started
 *  hueRotate(c,a) rotate an RGB colour's hue by `a` radians (per-system tint)
 */
export const paletteGlsl = /* glsl */ `
vec3 speedColor(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.043, 0.114, 0.420); // #0b1d6b
  vec3 c1 = vec3(0.302, 0.247, 0.839); // #4d3fd6
  vec3 c2 = vec3(0.914, 0.416, 0.627); // #e96aa0
  vec3 c3 = vec3(1.000, 0.941, 0.784); // #fff0c8
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.35, t));
  c = mix(c, c2, smoothstep(0.35, 0.68, t));
  c = mix(c, c3, smoothstep(0.68, 1.0, t));
  return c;
}

vec3 hueColor(float h) {
  // fully saturated wheel, slightly lifted so no hue goes black; additive overlap whitens it anyway
  vec3 p = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  vec3 rgb = clamp(p - 1.0, 0.0, 1.0);
  return rgb * 0.92 + 0.08;
}

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}
`
