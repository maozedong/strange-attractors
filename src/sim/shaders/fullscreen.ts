/**
 * Vertex shader shared by every simulation pass. The quad is a PlaneGeometry(2, 2), so its
 * positions already span clip space; we bypass the camera entirely so no matrix or clipping
 * subtlety can shift a texel. `vUv` lands exactly on texel centres of the target.
 */
export const fullscreenVert = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
