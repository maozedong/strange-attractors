/**
 * Moves every particle from one system's coordinate frame into another's so that its
 * on-screen position, (p - center) * scale, is unchanged:
 *   (np - toCenter) * toScale == (p - fromCenter) * fromScale
 * Speed (w) is carried over untouched; the next step or refresh recomputes it.
 */
export const remapFrag = /* glsl */ `
uniform sampler2D uState;
uniform vec3 uFromCenter;
uniform float uFromScale;
uniform vec3 uToCenter;
uniform float uToScale;
varying vec2 vUv;

void main() {
  vec4 s = texture2D(uState, vUv);
  vec3 np = (s.xyz - uFromCenter) * (uFromScale / uToScale) + uToCenter;
  gl_FragColor = vec4(np, s.w);
}
`
