/** Copies a CPU-built DataTexture (xyz = position, w = speed) into a state target. */
export const initFrag = /* glsl */ `
uniform sampler2D uSource;
varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(uSource, vUv);
}
`
