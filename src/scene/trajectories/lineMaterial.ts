import { AdditiveBlending } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/**
 * Two shader changes for additive lines rendered without MSAA (Scene uses antialias:false and
 * EffectComposer multisampling={0}). Both are applied or neither is.
 *
 * 1. No round end caps. LineMaterial draws each segment as its own quad with round caps, so
 *    neighbouring segments overlap in a disc at every joint; additive blending counts that
 *    overlap twice and you get a bright bead at every history point. Discarding the cap region
 *    (|uv.y| > 1, the same region LineMaterial drops when dashed) leaves butt joints, which only
 *    gap or overlap by a sliver at sharp bends.
 * 2. Analytic anti-aliasing. The quad is widened by `lineAA` CSS px (one device pixel) and the
 *    colour is scaled by a box-filter coverage ramp centred on the true edge. With additive
 *    blending, partial coverage is just a colour scale, and the ramp keeps the integrated
 *    width equal to `linewidth`.
 *
 * Set to false to get the stock LineMaterial.
 */
const PATCH_SHADER = true

type Patch = [stage: 'vertex' | 'fragment', hook: string, replacement: string]

const PATCHES: Patch[] = [
  ['vertex', 'uniform float linewidth;', 'uniform float linewidth;\n\t\tuniform float lineAA;'],
  ['vertex', 'offset *= linewidth;', 'offset *= linewidth + lineAA;'],
  ['fragment', 'uniform float linewidth;', 'uniform float linewidth;\n\t\tuniform float lineAA;'],
  [
    'fragment',
    '#include <clipping_planes_fragment>',
    '#include <clipping_planes_fragment>\n\t\t\tif ( abs( vUv.y ) > 1.0 ) discard;',
  ],
  [
    'fragment',
    '#include <color_fragment>',
    '#include <color_fragment>\n\t\t\tdiffuseColor.rgb *= clamp( 0.5 * ( linewidth + lineAA ) * ( 1.0 - abs( vUv.x ) ) / lineAA, 0.0, 1.0 );',
  ],
]

export function createTrajectoryLineMaterial(linewidth: number): LineMaterial {
  const m = new LineMaterial({
    vertexColors: true,
    linewidth,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
    worldUnits: false,
    // additive glow sums in linear light; tone mapping belongs after blending (the composer does it)
    toneMapped: false,
  })
  if (!PATCH_SHADER) return m

  m.uniforms.lineAA = { value: 1 }
  m.onBeforeCompile = (shader) => {
    const src = { vertex: shader.vertexShader, fragment: shader.fragmentShader }
    for (const [stage, hook] of PATCHES) {
      if (!src[stage].includes(hook)) {
        console.warn(`Trajectories: LineMaterial ${stage} shader changed (missing "${hook}"); using stock lines`)
        return
      }
    }
    for (const [stage, hook, replacement] of PATCHES) src[stage] = src[stage].replace(hook, replacement)
    shader.vertexShader = src.vertex
    shader.fragmentShader = src.fragment
  }
  m.customProgramCacheKey = () => 'trajectory-line:butt-caps+aa'
  return m
}

/** AA fringe of one device pixel, expressed in the CSS-pixel units LineMaterial works in. */
export function setLinePixelRatio(m: LineMaterial, dpr: number): void {
  const u = m.uniforms.lineAA
  if (u) u.value = 1 / Math.max(dpr, 1e-3)
}
