import * as THREE from 'three'

/**
 * The colour script. Every act has one ramp (five stops, cold to hot, linear-light RGB) that
 * colours the dust and everything else that glows, and three backdrop tones. Scenes never pick
 * colours of their own: they pick a position on the act's ramp.
 */
export type ActId = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface Palette {
  /** five stops, cold to hot */
  ramp: [THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color]
  /** backdrop: zenith, horizon glow, and the fog that drifts through it */
  sky: THREE.Color
  horizon: THREE.Color
  fog: THREE.Color
  /** UI accent as a CSS colour (timeline progress, focus) */
  accent: string
}

const c = (hex: string) => new THREE.Color(hex).convertSRGBToLinear()

function palette(stops: [string, string, string, string, string], sky: string, horizon: string, fog: string, accent: string): Palette {
  return {
    ramp: [c(stops[0]), c(stops[1]), c(stops[2]), c(stops[3]), c(stops[4])],
    sky: c(sky),
    horizon: c(horizon),
    fog: c(fog),
    accent,
  }
}

/**
 * 0 prologue + I: storm. Cold air deep blue, hot air amber.
 * II: water and ink. III: moss and chalk. IV: brass at dusk. V: phosphor. 6 epilogue: storm again.
 */
export const PALETTES: Record<ActId, Palette> = {
  0: palette(['#081a66', '#2a4fd0', '#c8468a', '#ffad55', '#fff3dc'], '#03040b', '#0e1436', '#1a1f58', '#ffb766'),
  1: palette(['#081a66', '#2a4fd0', '#c8468a', '#ffad55', '#fff3dc'], '#03040b', '#0e1436', '#1a1f58', '#ffb766'),
  2: palette(['#04283a', '#0e7286', '#59c9c0', '#c9f2df', '#fbfff4'], '#02070a', '#06222b', '#0b3a44', '#7fe0d2'),
  3: palette(['#0c2415', '#2c7d49', '#a5cf5c', '#f0e9a8', '#fffbe6'], '#030604', '#0c2114', '#17361f', '#c4e070'),
  4: palette(['#1f0d24', '#84365c', '#de8747', '#ffd08a', '#fff4e0'], '#070306', '#2a1220', '#3d1a2c', '#ffbd75'),
  5: palette(['#031c22', '#17705f', '#9fe04e', '#e9ff9c', '#fbffe8'], '#020607', '#052026', '#0a3833', '#c8f46a'),
  6: palette(['#081a66', '#2a4fd0', '#c8468a', '#ffad55', '#fff3dc'], '#03040b', '#0e1436', '#1a1f58', '#ffb766'),
}

/** GLSL: `vec3 ramp(vec3 stops[5], float t)`, smooth through the five stops. */
export const rampGlsl = /* glsl */ `
vec3 ramp5(vec3 s0, vec3 s1, vec3 s2, vec3 s3, vec3 s4, float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 c = mix(s0, s1, smoothstep(0.0, 1.0, t));
  c = mix(c, s2, smoothstep(1.0, 2.0, t));
  c = mix(c, s3, smoothstep(2.0, 3.0, t));
  c = mix(c, s4, smoothstep(3.0, 4.0, t));
  return c;
}
`

/** JS twin of ramp5, for CPU-side colours (labels, lines). Returns linear RGB. */
export function rampColor(p: Palette, t: number, out = new THREE.Color()): THREE.Color {
  const x = Math.min(1, Math.max(0, t)) * 4
  const ss = (a: number, b: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return u * u * (3 - 2 * u)
  }
  out.copy(p.ramp[0]).lerp(p.ramp[1], ss(0, 1)).lerp(p.ramp[2], ss(1, 2)).lerp(p.ramp[3], ss(2, 3)).lerp(p.ramp[4], ss(3, 4))
  return out
}
