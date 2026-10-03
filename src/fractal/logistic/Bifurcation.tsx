import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../store'
import { paletteGlsl } from '../../scene/palette'
import type { BifurcationCloud } from './cloud'
import { BASE_COLUMNS } from './cloud'
import { loadBifurcationCloud } from './cloudLoader'
import {
  PERIOD_DOUBLINGS,
  R_MAX,
  R_MIN,
  forkPoint,
  logistic,
  plotX,
  plotY,
  rToC,
  type Coord,
} from './math'

export {
  C_MAX,
  C_MIN,
  FEIGENBAUM_ALPHA,
  FEIGENBAUM_DELTA,
  FEIGENBAUM_POINT,
  PERIOD3_WINDOW,
  PERIOD_DOUBLINGS,
  R_MAX,
  R_MIN,
  Z_MAX,
  Z_MIN,
  cToX,
  cascadeFrame,
  forkPoint,
  plotX,
  plotY,
  rToC,
  rToX,
  xToY,
  xToZ,
  zToY,
  type CascadeFrame,
  type Coord,
} from './math'

const INK = '#efe8dc'

/** brightness of one point at the reference density; many overlap */
const DEFAULT_GAIN = 0.12
/** point diameter, CSS px (integer device sizes at dpr 1, 1.5 and 2 keep the points from shimmering) */
const DEFAULT_POINT_SIZE = 2
/** no single point gets brighter than this multiple of `gain`, however sparse the cloud gets */
const GAIN_CAP = 5.8
/** points within this distance (in r) behind the reveal edge glow */
const EDGE_WIDTH = 0.02

/** orbit trail on the cursor: this many iterates, added at this rate (so it turns over in ~1 s) */
const TRAIL = 64
const TRAIL_RATE = 60
const TRAIL_DOT_PX = 4.5

/** doublings that get a tick and a label */
const MARKED = PERIOD_DOUBLINGS.slice(0, 5)
const TICK_PX = 13
const TICK_BAR_PX = 1.25
/** label size stays within this range of its CSS size, however close the camera gets */
const LABEL_SCALE_MIN = 0.8
const LABEL_SCALE_MAX = 1.15
/** gap between the fork and the label's corner, CSS px */
const LABEL_GAP_X = 6
const LABEL_GAP_Y = 8
/** labels closer than this to an already shown label are hidden, CSS px */
const LABEL_PAD = 10

const noRaycast = () => {}

export interface BifurcationProps {
  /** plane width, local units */
  width: number
  /** plane height, local units */
  height: number
  /**
   * 'r' (default): the logistic diagram, r ∈ [2.5, 4] across, xₙ ∈ [0, 1] up.
   * 'c': the same orbits in z → z² + c coordinates, c ∈ [−2, 0.25] across, z ∈ [−2, 2] up, so
   * the diagram can stand on the real axis of a Mandelbrot plane. Switching is free.
   */
  coord?: Coord
  /** ticks and value labels at the first five period doublings */
  showDoublings?: boolean
  /** 0..1, fades everything */
  opacity?: number
  /** brightness of one point at the reference density. Default 0.12 */
  gain?: number
  /** point diameter, CSS px. Default 2 */
  pointSize?: number
  /** the r cursor and its orbit (still hidden while `fractal.reveal` is 0). Default true */
  cursor?: boolean
}

/**
 * The bifurcation diagram of the logistic map as a static GPU point cloud in the group's local
 * XY plane (facing +Z; the parent positions it), revealed up to `fractal.reveal`, with a cursor
 * at `fractal.r`. Reads the store every frame; never re-renders for it.
 */
export function Bifurcation({
  width,
  height,
  coord = 'r',
  showDoublings = false,
  opacity = 1,
  gain = DEFAULT_GAIN,
  pointSize = DEFAULT_POINT_SIZE,
  cursor = true,
}: BifurcationProps) {
  return (
    <group>
      <CloudPoints width={width} height={height} coord={coord} opacity={opacity} gain={gain} pointSize={pointSize} />
      <Cursor width={width} height={height} coord={coord} opacity={opacity} enabled={cursor} />
      <DoublingMarkers width={width} height={height} coord={coord} opacity={opacity} show={showDoublings} />
    </group>
  )
}

/** The latest props, for frame loops that must not re-subscribe when they change. */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// ================================================================ the point cloud

/**
 * Vertex shader. `position` holds (u, xₙ, w), see cloud.ts. The layout is computed here, so
 * one buffer serves both coordinate systems and the plane size can change without a rebuild.
 *
 * Brightness is density-normalised: additive points get brighter wherever more of them land on
 * a pixel, which would make the diagram brighter when drawn small, dimmer when zoomed, and
 * brighter where the columns are dense near r∞. So each point's gain is scaled by how far apart
 * its column is on screen (lines and clouds), and for chaotic points also by how stretched xₙ is
 * on screen (clouds only), relative to a reference density. A cap stops single points flaring
 * once zoomed past the sampling of the cloud.
 */
const cloudVert = /* glsl */ `
uniform float uRevealU;
uniform float uEdge;
uniform float uCoord;
uniform vec2 uPlane;
uniform float uGain;
uniform float uGainMax;
uniform float uOpacity;
uniform float uPointSize;
uniform float uViewportH;
varying vec3 vColor;

${paletteGlsl}

const float R_LOW = ${R_MIN.toFixed(1)};
const float R_SPAN = ${(R_MAX - R_MIN).toFixed(1)};
const float BASE_DU = ${(1 / BASE_COLUMNS).toExponential(8)};
// reference density: base columns this many CSS px apart, xn in [0, 1] spanning this many CSS px
const float REF_COL_PX = 0.5;
const float REF_ROW_PX = 600.0;
const float EDGE_R = ${EDGE_WIDTH.toFixed(3)};
const float EDGE_BOOST = 2.5;

void main() {
  float u = position.x;
  float xn = position.y;
  float wgt = position.z;

  // beyond the reveal: no fragments at all
  if (u > uRevealU) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }

  float r = R_LOW + R_SPAN * u;
  // 'r' layout: linear in u and xn. 'c' layout: c = r/2 - r^2/4 and z = r (1/2 - xn), mapped
  // from c in [-2, 0.25] and z in [-2, 2]; written in u, (c + 2) / 2.25 = 0.75 - 0.5 u - 0.25 u^2.
  vec2 pr = vec2(u - 0.5, xn - 0.5);
  vec2 pc = vec2(0.25 - 0.5 * u - 0.25 * u * u, 0.25 * r * (0.5 - xn));
  vec2 p = mix(pr, pc, uCoord) * uPlane;
  // local units per unit of u, and per unit of xn, in the active layout
  float dXdu = mix(1.0, 0.5 + 0.5 * u, uCoord) * uPlane.x;
  float dYdx = mix(1.0, 0.25 * r, uCoord) * uPlane.y;

  vec4 mv = modelViewMatrix * vec4(p, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;

  // CSS px per local unit along each local axis, at this depth (perspective or orthographic)
  float pxPerView = projectionMatrix[1][1] * 0.5 * uViewportH / max(gl_Position.w, 1e-6);
  float pxX = length(modelViewMatrix[0].xyz) * pxPerView;
  float pxY = length(modelViewMatrix[1].xyz) * pxPerView;

  float colPx = BASE_DU * dXdu * pxX;
  float rowPx = dYdx * pxY;
  float chaotic = step(0.0, wgt);
  float g = uGain * abs(wgt) * (colPx / REF_COL_PX) * mix(1.0, rowPx / REF_ROW_PX, chaotic);
  g = min(g, uGainMax);

  // leading edge of the reveal wipe
  float glow = uEdge * (1.0 - smoothstep(0.0, EDGE_R, (uRevealU - u) * R_SPAN));
  vec3 col = speedColor(0.25 + 0.6 * xn);
  col = mix(col, vec3(1.0, 0.95, 0.88), 0.35 * glow);
  vColor = col * g * (1.0 + EDGE_BOOST * glow) * uOpacity;
  gl_PointSize = uPointSize;
}
`

const cloudFrag = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(p, p);
  if (d2 > 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-2.0 * d2), 1.0);
}
`

/** Additive in colour, destination alpha left alone (as the swarm does). */
const additive = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const

function createCloudMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Bifurcation.cloud',
    vertexShader: cloudVert,
    fragmentShader: cloudFrag,
    uniforms: {
      uRevealU: { value: -1 },
      uEdge: { value: 1 },
      uCoord: { value: 0 },
      uPlane: { value: new THREE.Vector2(1, 1) },
      uGain: { value: DEFAULT_GAIN },
      uGainMax: { value: DEFAULT_GAIN * GAIN_CAP },
      uOpacity: { value: 1 },
      uPointSize: { value: DEFAULT_POINT_SIZE },
      uViewportH: { value: 1 },
    },
    ...additive,
  })
}

/** The shared cloud, or null while the worker is still building it. */
function useBifurcationCloud(): BifurcationCloud | null {
  const [cloud, setCloud] = useState<BifurcationCloud | null>(null)
  useEffect(() => {
    let alive = true
    void loadBifurcationCloud().then((c) => {
      if (alive) setCloud(c)
    })
    return () => {
      alive = false
    }
  }, [])
  return cloud
}

interface LayerProps {
  width: number
  height: number
  coord: Coord
  opacity: number
}

function CloudPoints(props: LayerProps & { gain: number; pointSize: number }) {
  const live = useLatest(props)
  const cloud = useBifurcationCloud()
  const pointsRef = useRef<THREE.Points>(null)

  const geometry = useMemo(() => {
    if (!cloud) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3))
    // positions are parameters, not local coordinates; nothing should compute bounds from them
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    return g
  }, [cloud])
  useEffect(() => () => geometry?.dispose(), [geometry])

  const material = useMemo(createCloudMaterial, [])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const pts = pointsRef.current
    if (!pts) return
    const { reveal } = useStore.getState().fractal
    const p = live.current
    const u = material.uniforms
    u.uRevealU.value = (reveal - R_MIN) / (R_MAX - R_MIN)
    // the glow marks a moving edge; with everything revealed there is no edge left
    u.uEdge.value = clamp01((R_MAX - reveal) / EDGE_WIDTH)
    u.uCoord.value = p.coord === 'c' ? 1 : 0
    ;(u.uPlane.value as THREE.Vector2).set(p.width, p.height)
    u.uGain.value = p.gain
    u.uGainMax.value = p.gain * GAIN_CAP
    u.uOpacity.value = p.opacity
    u.uPointSize.value = p.pointSize * state.gl.getPixelRatio()
    u.uViewportH.value = state.size.height
    pts.visible = reveal > R_MIN && p.opacity > 0
  })

  if (!geometry) return null
  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      raycast={noRaycast}
      visible={false}
    />
  )
}

// ================================================================ cursor and orbit

const dotVert = /* glsl */ `
attribute float aAlpha;
uniform float uSize;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vAlpha = aAlpha * uOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`

const dotFrag = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.5, 1.0, d)) * vAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`

/**
 * The orbit at the cursor: TRAIL dots on the cursor line. Vertex i holds the iterate of age
 * TRAIL-1-i, so the newest is drawn last (on top) and brightest. Normal blending, so the
 * dots of a periodic orbit stack into one solid dot rather than a flare.
 */
function createTrail() {
  const positions = new Float32Array(TRAIL * 3)
  const alpha = new Float32Array(TRAIL)
  for (let i = 0; i < TRAIL; i++) {
    const age = (TRAIL - 1 - i) / (TRAIL - 1)
    alpha[i] = 1 - 0.75 * age
  }
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(positions, 3)
  position.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
  const material = new THREE.ShaderMaterial({
    name: 'Bifurcation.orbit',
    vertexShader: dotVert,
    fragmentShader: dotFrag,
    uniforms: {
      uSize: { value: TRAIL_DOT_PX },
      uOpacity: { value: 1 },
      // a touch over 1 so the bloom picks the dots out
      uColor: { value: new THREE.Color(INK).multiplyScalar(1.25) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  return { geometry, material, position, positions }
}

/** The iterates behind the trail: a ring buffer fed at a fixed rate from one persistent x. */
interface Orbit {
  x: number
  ring: Float64Array
  head: number
  carry: number
  primed: boolean
}

function stepOrbit(o: Orbit, r: number) {
  let x = logistic(r, o.x)
  if (!(x > 0 && x < 1)) x = 0.5 // r outside [0, 4], or float collapse onto 0 or 1
  o.x = x
  o.ring[o.head] = x
  o.head = (o.head + 1) % TRAIL
}

function Cursor(props: LayerProps & { enabled: boolean }) {
  const live = useLatest(props)
  const group = useRef<THREE.Group>(null)
  const line = useRef<ComponentRef<typeof Line>>(null)
  const linePoints = useMemo(
    () => [
      [0, -props.height / 2, 0],
      [0, props.height / 2, 0],
    ] as [number, number, number][],
    [props.height],
  )
  const trail = useMemo(createTrail, [])
  useEffect(
    () => () => {
      trail.geometry.dispose()
      trail.material.dispose()
    },
    [trail],
  )
  const [orbit] = useState<Orbit>(() => ({ x: 0.5, ring: new Float64Array(TRAIL), head: 0, carry: 0, primed: false }))

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const { r, reveal } = useStore.getState().fractal
    const p = live.current
    const o = orbit

    // keep iterating even while hidden, so the orbit has settled whenever it appears
    if (!o.primed) {
      o.primed = true
      for (let i = 0; i < 1000; i++) stepOrbit(o, r)
      for (let i = 0; i < TRAIL; i++) stepOrbit(o, r)
    }
    o.carry += Math.min(delta, 0.25) * TRAIL_RATE
    const steps = Math.min(Math.floor(o.carry), 16)
    o.carry -= Math.floor(o.carry)
    for (let i = 0; i < steps; i++) stepOrbit(o, r)

    const show = p.enabled && reveal > R_MIN && p.opacity > 0 && r >= R_MIN && r <= R_MAX
    g.visible = show
    if (!show) return

    g.position.x = plotX(r, p.width, p.coord)
    for (let i = 0; i < TRAIL; i++) {
      // vertex i ← iterate of age TRAIL-1-i; ring[head-1] is the newest
      const x = o.ring[(o.head + i) % TRAIL]
      trail.positions[i * 3 + 1] = plotY(r, x, p.height, p.coord)
    }
    trail.position.needsUpdate = true
    trail.material.uniforms.uSize.value = TRAIL_DOT_PX * state.gl.getPixelRatio()
    trail.material.uniforms.uOpacity.value = p.opacity
    if (line.current) line.current.material.opacity = 0.5 * p.opacity
  })

  return (
    <group ref={group} visible={false}>
      <Line
        ref={line}
        points={linePoints}
        color={INK}
        lineWidth={1}
        transparent
        opacity={0.5}
        depthTest={false}
        depthWrite={false}
        renderOrder={2}
      />
      <points
        geometry={trail.geometry}
        material={trail.material}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={3}
      />
    </group>
  )
}

// ================================================================ doubling markers

const tickVert = /* glsl */ `
attribute float aAlpha;
uniform float uSize;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vAlpha = aAlpha * uOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = vAlpha > 0.002 ? uSize : 0.0;
}
`

/** a thin vertical bar drawn inside a point sprite, so the tick keeps its pixel size at any zoom */
const tickFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uBar;
uniform float uAA;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(uBar - uAA, uBar + uAA, abs(p.x));
  a *= 1.0 - smoothstep(0.38, 0.5, abs(p.y));
  a *= vAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`

function createTicks() {
  const positions = new Float32Array(MARKED.length * 3)
  const alpha = new Float32Array(MARKED.length)
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(positions, 3)
  const alphaAttr = new THREE.BufferAttribute(alpha, 1)
  alphaAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setAttribute('aAlpha', alphaAttr)
  const material = new THREE.ShaderMaterial({
    name: 'Bifurcation.ticks',
    vertexShader: tickVert,
    fragmentShader: tickFrag,
    uniforms: {
      uSize: { value: TICK_PX },
      uOpacity: { value: 1 },
      uBar: { value: 0.05 },
      uAA: { value: 0.04 },
      uColor: { value: new THREE.Color(INK) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  return { geometry, material, position, positions, alphaAttr, alpha }
}

function formatValue(r: number, coord: Coord): string {
  const v = coord === 'c' ? rToC(r) : r
  return v.toFixed(4).replace('-', '−')
}

/**
 * Whether the branch that runs into fork k arrives from below it (in local y). Found by
 * converging the same 2ᵏ-cycle a little before the doubling, where it is still stable.
 */
function incomingFromBelow(k: number, coord: Coord): boolean {
  const rk = PERIOD_DOUBLINGS[k]
  const rIn = rk - 0.2 * (rk - (k > 0 ? PERIOD_DOUBLINGS[k - 1] : 2.75))
  const fork = forkPoint(k)
  const n = 2 ** k
  let x = fork
  for (let i = 0; i < 400 * n; i++) x = logistic(rIn, x)
  let best = x
  for (let i = 0; i < n; i++) {
    x = logistic(rIn, x)
    if (Math.abs(x - fork) < Math.abs(best - fork)) best = x
  }
  return plotY(rIn, best, 1, coord) < plotY(rk, fork, 1, coord)
}

/**
 * Where a label sits around its fork: on the side the branch comes in from (left in 'r', right
 * in 'c', which is turned 180°), where there is a single line and open space, and above the
 * branch if it climbs into the fork, below it if it falls. Successive forks alternate.
 */
interface LabelPlacement {
  /** −1 left of the fork, +1 right */
  side: number
  above: boolean
}

function labelPlacement(k: number, coord: Coord): LabelPlacement {
  return { side: coord === 'c' ? 1 : -1, above: incomingFromBelow(k, coord) }
}

/** the CSS transform that puts the label's corner at its gap from the fork, then scales it about the fork */
function labelTransform(place: LabelPlacement, scale: number): string {
  const tx = place.side < 0 ? `calc(-50% - ${LABEL_GAP_X}px)` : `calc(50% + ${LABEL_GAP_X}px)`
  const ty = place.above ? `calc(-50% - ${LABEL_GAP_Y}px)` : `calc(50% + ${LABEL_GAP_Y}px)`
  return `scale(${scale.toFixed(4)}) translate(${tx}, ${ty})`
}

const LABEL_STYLE = { whiteSpace: 'nowrap' } as const
const LABEL_TEXT_STYLE = { display: 'inline-block', fontVariantNumeric: 'tabular-nums' } as const

/**
 * A tick through the fork at each of the first five doublings (the branch nearest ½, the one
 * cascadeFrame centres on) and its value as a label beside it. Labels fade in once the reveal
 * has passed them, and a label that would overlap one for an earlier doubling stays hidden
 * until the camera has zoomed far enough to separate them (at overview the last three are a
 * few pixels apart).
 */
function DoublingMarkers(props: LayerProps & { show: boolean }) {
  const live = useLatest(props)
  const { width, height, coord } = props
  const group = useRef<THREE.Group>(null)
  const ticks = useMemo(createTicks, [])
  useEffect(
    () => () => {
      ticks.geometry.dispose()
      ticks.material.dispose()
    },
    [ticks],
  )

  const anchors = useMemo(
    () => MARKED.map((r, k) => [plotX(r, width, coord), plotY(r, forkPoint(k), height, coord), 0] as [number, number, number]),
    [width, height, coord],
  )
  const texts = useMemo(() => MARKED.map((r) => formatValue(r, coord)), [coord])
  const placements = useMemo(() => MARKED.map((_, k) => labelPlacement(k, coord)), [coord])

  useEffect(() => {
    anchors.forEach((a, k) => ticks.positions.set(a, k * 3))
    ticks.position.needsUpdate = true
  }, [anchors, ticks])

  /** label scale at which drei's distanceFactor shows the label at its CSS size */
  const distanceFactor = 0.9 * width

  // per-label state, all preallocated
  const labels = useRef<(HTMLDivElement | null)[]>([])
  const spans = useRef<(HTMLSpanElement | null)[]>([])
  const [state] = useState(() => ({
    alpha: new Float64Array(MARKED.length),
    /** the opacity last written to each label's style, to skip redundant DOM writes */
    shownAlpha: new Float64Array(MARKED.length).fill(-1),
    innerScale: new Float64Array(MARKED.length),
    dims: new Float64Array(MARKED.length * 2),
    kept: new Float64Array(MARKED.length * 4),
    placements,
    world: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
  }))
  // label text and placement change with the layout: measure again and re-apply the offsets
  useEffect(() => {
    state.dims.fill(0)
    state.innerScale.fill(0)
    state.placements = placements
  }, [placements, state])

  const labelRefs = useMemo(
    () =>
      MARKED.map((_, k) => (el: HTMLDivElement | null) => {
        labels.current[k] = el
        if (el) {
          el.style.opacity = '0'
          el.style.visibility = 'hidden'
        }
      }),
    [],
  )
  const spanRefs = useMemo(
    () =>
      MARKED.map((_, k) => (el: HTMLSpanElement | null) => {
        spans.current[k] = el
      }),
    [],
  )

  // drei's <Html> picks its DOM parent from `events.connected`, which R3F only sets once the
  // canvas has committed; an <Html> mounted before that is re-parented and can come back empty.
  // Mounting the labels after the first frame keeps their parent fixed.
  const [labelsReady, setLabelsReady] = useState(false)
  const readyRequested = useRef(false)

  useFrame(({ camera, size, gl }, delta) => {
    if (!readyRequested.current) {
      readyRequested.current = true
      setLabelsReady(true)
    }
    const g = group.current
    if (!g) return
    const p = live.current
    const s = state
    const { reveal } = useStore.getState().fractal
    const dpr = gl.getPixelRatio()
    const k1 = 1 - Math.exp(-Math.min(delta, 0.1) * 8)

    const u = ticks.material.uniforms
    u.uSize.value = TICK_PX * dpr
    u.uBar.value = (0.5 * TICK_BAR_PX) / TICK_PX
    u.uAA.value = 0.5 / (TICK_PX * dpr)
    u.uOpacity.value = p.opacity

    // drei's scale: distanceFactor / (2·tan(fov/2)·distance) in perspective, distanceFactor·zoom in orthographic
    const persp = camera as THREE.PerspectiveCamera
    const perspective = persp.isPerspectiveCamera === true
    const fovScale = perspective ? 2 * Math.tan((persp.fov * Math.PI) / 360) : 1
    s.camPos.setFromMatrixPosition(camera.matrixWorld)
    let keptCount = 0
    let ticksChanged = false

    for (let k = 0; k < MARKED.length; k++) {
      const revealed = p.show && reveal >= MARKED[k] + 0.003
      // ticks follow show / reveal only (they may crowd; that bunching is the point)
      const tickNow = ticks.alpha[k]
      const tickTarget = revealed ? 1 : 0
      let tickNext = tickNow + (tickTarget - tickNow) * k1
      if (Math.abs(tickNext - tickTarget) < 1e-3) tickNext = tickTarget
      if (tickNext !== tickNow) {
        ticks.alpha[k] = tickNext
        ticksChanged = true
      }

      const el = labels.current[k]
      const span = spans.current[k]
      if (!el || !span) continue

      // where drei puts the label, and how big drei makes it
      const a = anchors[k]
      s.world.set(a[0], a[1], a[2])
      g.localToWorld(s.world)
      const dist = s.world.distanceTo(s.camPos)
      const htmlScale = perspective ? distanceFactor / (fovScale * Math.max(dist, 1e-6)) : distanceFactor * camera.zoom
      const scale = Math.min(LABEL_SCALE_MAX, Math.max(LABEL_SCALE_MIN, htmlScale))
      s.world.project(camera)
      const inFront = s.world.z < 1
      const sx = ((s.world.x + 1) / 2) * size.width
      const sy = ((1 - s.world.y) / 2) * size.height

      if (s.dims[k * 2] === 0 && el.offsetWidth > 0) {
        s.dims[k * 2] = el.offsetWidth
        s.dims[k * 2 + 1] = el.offsetHeight
      }
      const w = s.dims[k * 2] * scale
      const h = s.dims[k * 2 + 1] * scale
      const place = s.placements[k]
      const gx = LABEL_GAP_X * scale
      const gy = LABEL_GAP_Y * scale
      const x0 = place.side > 0 ? sx + gx : sx - gx - w
      const y0 = place.above ? sy - gy - h : sy + gy

      let want = revealed && inFront && w > 0
      if (want) {
        for (let j = 0; j < keptCount; j++) {
          const o = j * 4
          if (
            x0 < s.kept[o + 2] + LABEL_PAD &&
            x0 + w > s.kept[o] - LABEL_PAD &&
            y0 < s.kept[o + 3] + LABEL_PAD &&
            y0 + h > s.kept[o + 1] - LABEL_PAD
          ) {
            want = false
            break
          }
        }
      }
      if (want) {
        const o = keptCount * 4
        s.kept[o] = x0
        s.kept[o + 1] = y0
        s.kept[o + 2] = x0 + w
        s.kept[o + 3] = y0 + h
        keptCount++
      }

      const target = want ? 1 : 0
      let next = s.alpha[k] + (target - s.alpha[k]) * k1
      if (Math.abs(next - target) < 1e-3) next = target
      s.alpha[k] = next
      const shown = Math.round(next * p.opacity * 1000) / 1000
      if (shown !== s.shownAlpha[k]) {
        s.shownAlpha[k] = shown
        el.style.opacity = String(shown)
        el.style.visibility = shown > 0 ? 'visible' : 'hidden'
      }
      // undo drei's distance scaling beyond the clamp, so labels stay readable when the camera
      // dives into the cascade
      const inner = scale / htmlScale
      if (Math.abs(inner - s.innerScale[k]) > 0.002 * inner) {
        s.innerScale[k] = inner
        span.style.transform = labelTransform(place, inner)
      }
    }
    if (ticksChanged) ticks.alphaAttr.needsUpdate = true
  })

  return (
    <group ref={group}>
      <points
        geometry={ticks.geometry}
        material={ticks.material}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={4}
      />
      {labelsReady &&
        anchors.map((a, k) => (
          <Html
            key={k}
            ref={labelRefs[k]}
            position={a}
            center
            occlude={false}
            distanceFactor={distanceFactor}
            zIndexRange={[0, 0]}
            pointerEvents="none"
            className="label"
            style={LABEL_STYLE}
          >
            <span ref={spanRefs[k]} style={LABEL_TEXT_STYLE}>
              {texts[k]}
            </span>
          </Html>
        ))}
    </group>
  )
}
