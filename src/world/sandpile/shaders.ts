import { paletteGlsl } from '../../scene/palette'

export const sandVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Both textures hold data, not colour: R = grains·85 (0, 85, 170, 255), G = flash 0..255. The
 * colours are the house palette's stops read as sRGB and decoded to linear here, as the other
 * opaque surfaces do (the scene renders in linear light; the post chain encodes at the end):
 *
 *   0 grains  #0b0912  near-black, a shade above the clear colour so the plane's extent reads
 *   1         #0b1d6b  deep blue   speedColor(0)
 *   2         #4d3fd6  violet      speedColor(0.35)
 *   3         #e96aa0  rose        speedColor(0.68)
 *   flash     #fff0c8  warm white  speedColor(1), scaled so its brightest channel is FLASH_PEAK
 *
 * The flash eases out as the square of its remaining strength. Live and pattern are mixed in
 * linear light by uMix (already eased). Brightest output: the flash, max channel 0.92 (rose
 * peaks at 0.81).
 */
export const sandFrag = /* glsl */ `
${paletteGlsl}
#define FLASH_PEAK 0.92
uniform sampler2D uLive;
uniform sampler2D uPattern;
uniform float uMix;
uniform float uOpacity;
varying vec2 vUv;

const vec3 EMPTY_SRGB = vec3(0.043, 0.035, 0.071);

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

// g: grains 0..3, exact (nearest texel, 85 / 255 = 1 / 3)
vec3 grainColor(float g) {
  vec3 c = EMPTY_SRGB;
  c = mix(c, speedColor(0.0), step(0.5, g));
  c = mix(c, speedColor(0.35), step(1.5, g));
  c = mix(c, speedColor(0.68), step(2.5, g));
  return srgbToLinear(c);
}

void main() {
  vec4 a = texture2D(uLive, vUv);
  vec3 live = grainColor(a.r * 3.0);
  float flash = a.g * a.g;
  live = mix(live, srgbToLinear(speedColor(1.0)) * FLASH_PEAK, flash);
  vec3 pattern = grainColor(texture2D(uPattern, vUv).r * 3.0);
  gl_FragColor = vec4(mix(live, pattern, uMix), uOpacity);
}
`
