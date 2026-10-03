/**
 * Shaders for the cat-map stage. GLSL ES 1.0 style; three maps texture2D / gl_FragColor to
 * GLSL ES 3.0 on WebGL 2.
 *
 * gatherFrag runs on a full-screen quad into an N x N RGBA8 target (NearestFilter, no
 * blending, no dithering). Each destination texel reads exactly one source texel at its
 * centre, so an 8-bit value goes in as c / 255 and is written back as c: the permutation
 * moves bytes, never blends them, and the picture returns bit-identical after the period.
 *
 *   without CAT_STEP   a copy: dest(x, y) <- src(x, y)          (uploads the source image)
 *   with CAT_STEP      one step of the cat map (x, y) -> (2x + y, x + y) mod N, as a gather:
 *                      dest(x, y) <- src((x - y) mod N, (-x + 2y) mod N)
 *
 * The modulo q - N floor((q + 0.5) / N) is exact for integer q: (q + 0.5) / N sits at least
 * 0.5 / N away from an integer, far more than float rounding (a GPU may divide through a
 * reciprocal; verify-cat.ts checks both in float32 for every texel). gl_FragCoord.xy is the
 * texel centre (x + 0.5, y + 0.5) of the bound target, origin bottom-left = texture row 0.
 */
export const gatherFrag = /* glsl */ `
uniform sampler2D uSrc;
uniform float uN;

void main() {
  vec2 p = floor(gl_FragCoord.xy);
#ifdef CAT_STEP
  vec2 q = vec2(p.x - p.y, 2.0 * p.y - p.x);
  q -= uN * floor((q + 0.5) / uN);
#else
  vec2 q = p;
#endif
  gl_FragColor = texture2D(uSrc, (q + 0.5) / uN);
}
`

/** The visible plane: PlaneGeometry uv, so v = 0 (texture row 0) is the bottom edge. */
export const displayVert = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The texture holds the photo's sRGB bytes untouched (decoding on upload would round dark
 * tones to 8-bit linear and band them). The scene renders in linear light and the post
 * chain encodes to sRGB at the end, so decode here, per texel, with the exact sRGB curve.
 */
export const displayFrag = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c * (1.0 / 12.92);
  vec3 hi = pow((c + 0.055) * (1.0 / 1.055), vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(srgbToLinear(c), 1.0);
}
`
