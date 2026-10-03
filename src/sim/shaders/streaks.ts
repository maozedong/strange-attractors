import { paletteGlsl } from '../../scene/palette'

/**
 * Motion-blur streaks: every particle is a screen-space quad stretched from its position
 * back along its velocity by `uExposure` time units (one frame's worth of motion at the
 * nominal frame rate), so the swarm reads as flow lines, like a long-exposure photograph.
 *
 * Base quad vertex `position` carries (end, side): end 0 = head, 1 = tail; side ±1.
 * Instanced attributes `ref` (texel uv) and `aHue` come from the simulation.
 * `derivGlsl` (uniform int uSystem, float P[8], vec3 deriv(vec3)) is prepended by the caller.
 */
export function buildStreakVert(derivGlsl: string): string {
  return /* glsl */ `
${paletteGlsl}
${derivGlsl}

uniform sampler2D uPos;
uniform vec3 uCenter;
uniform float uScale;
uniform float uSpeedNorm;
uniform float uColorMode;
uniform float uWidth;      // device pixels
uniform float uExposure;   // system time units of blur
uniform float uMinLen;     // device pixels: slow particles still show as a short dash
uniform float uMaxLen;     // device pixels: fast particles are capped
uniform vec2 uResolution;  // device pixels
uniform float uMirror;     // 1 = draw the reflection in the floor instead of the particle
uniform float uFloorY;     // world y of the floor plane

attribute vec2 ref;
attribute float aHue;

varying vec3 vColor;
varying vec2 vCoord;
varying float vFade;

void main() {
  vec4 d = texture2D(uPos, ref);
  vec3 p = d.xyz;
  vec3 vel = deriv(p);

  vec3 head = (p - uCenter) * uScale;
  vec3 tail = (p - vel * uExposure - uCenter) * uScale;
  vec4 wh = modelMatrix * vec4(head, 1.0);
  vec4 wt = modelMatrix * vec4(tail, 1.0);
  vFade = 1.0;
  if (uMirror > 0.5) {
    // a dark glossy floor: the reflection dims with the particle's height above it
    float h = max(0.0, wh.y - uFloorY);
    vFade = 0.5 * exp(-1.1 * h);
    wh.y = 2.0 * uFloorY - wh.y;
    wt.y = 2.0 * uFloorY - wt.y;
  }
  vec4 hc = projectionMatrix * viewMatrix * wh;
  vec4 tc = projectionMatrix * viewMatrix * wt;

  vec2 halfRes = uResolution * 0.5;
  vec2 hs = hc.xy / hc.w * halfRes;
  vec2 ts = tc.xy / tc.w * halfRes;
  vec2 dir = ts - hs;
  float len = length(dir);
  dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);

  // clamp the on-screen length into [uMinLen, uMaxLen] by moving the tail
  float want = clamp(len, uMinLen, uMaxLen);
  vec2 tailPx = hs + dir * want;
  vec4 tcl = len > 1e-4 ? mix(hc, tc, want / len) : hc;
  if (len <= 1e-4) tcl.xy = (tailPx / halfRes) * hc.w;

  vec4 clip = mix(hc, tcl, position.x);
  vec2 n = vec2(-dir.y, dir.x);
  clip.xy += (n * position.y * uWidth * 0.5) / halfRes * clip.w;
  gl_Position = clip;

  float t = d.w / max(uSpeedNorm, 1e-6);
  vColor = mix(speedColor(t), hueColor(aHue), uColorMode);
  vCoord = position.xy;
}
`
}

/** Soft across the width, brighter at the head, fading to the tail. */
export const streakFrag = /* glsl */ `
uniform float uOpacity;
uniform float uGain;

varying vec3 vColor;
varying vec2 vCoord;
varying float vFade;

void main() {
  float across = 1.0 - vCoord.y * vCoord.y;
  across *= across;
  float along = 1.0 - vCoord.x * 0.9;
  gl_FragColor = vec4(vColor * (across * along * uOpacity * uGain * vFade), 1.0);
}
`
