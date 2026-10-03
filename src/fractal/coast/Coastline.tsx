import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { useStore } from '../../store'
import { HeadPoints } from '../../scene/trajectories/HeadPoints'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import { britainData, loadBritain, nearestWalkIndex, type Britain } from './britain'

const INK = '#efe8dc'
const WARM = '#ffb07a'

/** the coastline: thin, additive, at this fraction of the ink colour (the wide bloom gives the glow) */
const COAST_PX = 1.2
const COAST_GAIN = 0.55
/** the walk: brighter warm chords with a dot where each one lands */
const WALK_PX = 2
const DOT_PX = 5
/** below this fraction of a chord the head segment is not drawn (a zero-length fat line has no direction) */
const MIN_FRACTION = 1e-4

const noRaycast = () => {}

export interface CoastlineProps {
  /** width of the box the island is fitted into, local units */
  width: number
  /** height of that box, local units */
  height: number
  /** 0..1, fades everything. Default 1 */
  opacity?: number
}

/**
 * The mainland coast of Great Britain (Natural Earth 10 m) in the group's local XY plane, north
 * up, scaled uniformly to fit `width` × `height` and centred on the origin. On top of it,
 * Richardson's ruler walk for `coast.ruler` (the nearest precomputed ruler), revealed up to
 * `coast.walk` ∈ [0, 1] with the walker's head gliding along the current chord. Reads the store
 * every frame; never re-renders for it. Renders nothing until /data/britain.json has loaded.
 */
export function Coastline({ width, height, opacity = 1 }: CoastlineProps) {
  const data = useBritain()
  if (!data) return null
  return <CoastlineScene data={data} width={width} height={height} opacity={opacity} />
}

function useBritain(): Britain | null {
  const [data, setData] = useState<Britain | null>(britainData)
  useEffect(() => {
    if (data) return
    let alive = true
    loadBritain().then(
      (d) => {
        if (alive) setData(d)
      },
      (err: unknown) => console.warn('Coastline: could not load the coastline data', err),
    )
    return () => {
      alive = false
    }
  }, [data])
  return data
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

function createFatLine(px: number) {
  const material = createTrajectoryLineMaterial(px)
  // one flat colour: the shared material is built for per-vertex colours
  material.vertexColors = false
  return material
}

function createCoast(points: Float32Array) {
  const geometry = new LineGeometry()
  geometry.setPositions(points)
  const material = createFatLine(COAST_PX)
  const line = new Line2(geometry, material)
  line.frustumCulled = false
  line.raycast = noRaycast
  line.renderOrder = 1
  return { line, geometry, material }
}

const dotVert = /* glsl */ `
uniform float uSize;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`

const dotFrag = /* glsl */ `
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.55, 1.0, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}
`

/**
 * Buffers for the walk, sized for the longest walk (the shortest ruler) and rewritten only when
 * the ruler changes. The chord line keeps every chord of the selected walk in its instance
 * buffer; the frame loop shows the first k and points the end of chord k at the head.
 */
function createWalk(capacity: number) {
  const geometry = new LineGeometry()
  geometry.setPositions(new Float32Array(Math.max(capacity, 2) * 3))
  const segBuffer = (geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data
  segBuffer.setUsage(THREE.DynamicDrawUsage)
  const segs = segBuffer.array as Float32Array
  geometry.instanceCount = 0
  const material = createFatLine(WALK_PX)
  const line = new Line2(geometry, material)
  line.frustumCulled = false
  line.raycast = noRaycast
  line.renderOrder = 2

  const dotGeometry = new THREE.BufferGeometry()
  const dotPositions = new THREE.BufferAttribute(new Float32Array(Math.max(capacity, 1) * 3), 3)
  dotGeometry.setAttribute('position', dotPositions)
  dotGeometry.setDrawRange(0, 0)
  dotGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
  const dotMaterial = new THREE.ShaderMaterial({
    name: 'Coastline.dots',
    vertexShader: dotVert,
    fragmentShader: dotFrag,
    uniforms: { uSize: { value: DOT_PX }, uColor: { value: new THREE.Color(WARM) } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const dots = new THREE.Points(dotGeometry, dotMaterial)
  dots.frustumCulled = false
  dots.raycast = noRaycast
  dots.renderOrder = 3

  const head = new HeadPoints(1)
  head.setCount(1)
  head.points.renderOrder = 4
  head.points.raycast = noRaycast

  const root = new THREE.Group()
  root.add(line, dots, head.points)
  root.visible = false

  return {
    root,
    geometry,
    segBuffer,
    segs,
    material,
    dotGeometry,
    dotPositions,
    dotMaterial,
    head,
    dispose() {
      geometry.dispose()
      material.dispose()
      dotGeometry.dispose()
      dotMaterial.dispose()
      head.dispose()
    },
  }
}

interface SceneProps {
  data: Britain
  width: number
  height: number
  opacity: number
}

function CoastlineScene(props: SceneProps) {
  const { data, width, height } = props
  const live = useLatest(props)

  const coast = useMemo(() => createCoast(data.points), [data])
  useEffect(
    () => () => {
      coast.geometry.dispose()
      coast.material.dispose()
    },
    [coast],
  )

  const capacity = useMemo(() => data.walks.reduce((m, w) => Math.max(m, w.segments + 1), 0), [data])
  const walk = useMemo(() => createWalk(capacity), [capacity])
  useEffect(() => () => walk.dispose(), [walk])

  // uniform fit, centred: km → local units
  const fit = useMemo(() => {
    const [x0, y0, x1, y1] = data.bbox
    const s = Math.max(0, Math.min(width / (x1 - x0), height / (y1 - y0)))
    return { s, x: -0.5 * (x0 + x1) * s, y: -0.5 * (y0 + y1) * s }
  }, [data, width, height])

  const [st] = useState(() => ({
    ink: new THREE.Color(INK),
    warm: new THREE.Color(WARM),
    tmp: new THREE.Color(),
    /** walk currently in the buffers, −1 = none */
    walkIndex: -1,
    /** chord whose end currently points at the head, −1 = none */
    partial: -1,
    /** last head position written, in km along the walk; NaN forces a write */
    lastDistance: NaN,
    lastOpacity: -1,
    lastDpr: -1,
  }))

  /** copy walk `wi` into the chord and dot buffers */
  function loadWalk(wi: number) {
    const w = data.walks[wi]
    const v = w.vertices
    const segs = walk.segs
    for (let j = 0; j < w.segments; j++) {
      const a = j * 3
      const o = j * 6
      segs[o] = v[a]
      segs[o + 1] = v[a + 1]
      segs[o + 2] = v[a + 2]
      segs[o + 3] = v[a + 3]
      segs[o + 4] = v[a + 4]
      segs[o + 5] = v[a + 5]
    }
    walk.segBuffer.needsUpdate = true
    ;(walk.dotPositions.array as Float32Array).set(v)
    walk.dotPositions.needsUpdate = true
    st.walkIndex = wi
    st.partial = -1
    st.lastDistance = NaN
  }

  useFrame((state) => {
    const p = live.current
    const o = p.opacity
    const dpr = state.gl.getPixelRatio()
    if (dpr !== st.lastDpr) {
      st.lastDpr = dpr
      setLinePixelRatio(coast.material, dpr)
      setLinePixelRatio(walk.material, dpr)
      walk.head.setPixelRatio(dpr)
      walk.dotMaterial.uniforms.uSize.value = DOT_PX * dpr
    }
    if (o !== st.lastOpacity) {
      st.lastOpacity = o
      coast.material.color.copy(st.ink).multiplyScalar(COAST_GAIN * o)
      walk.material.color.copy(st.warm).multiplyScalar(o)
      ;(walk.dotMaterial.uniforms.uColor.value as THREE.Color).copy(st.warm).multiplyScalar(o)
      walk.head.setColor(0, st.tmp.copy(st.warm).multiplyScalar(o))
    }
    coast.line.visible = o > 0

    const { ruler, walk: progress } = useStore.getState().coast
    const show = ruler > 0 && o > 0 && data.walks.length > 0
    walk.root.visible = show
    if (!show) return

    const wi = nearestWalkIndex(data.walks, ruler)
    if (wi !== st.walkIndex) loadWalk(wi)
    const w = data.walks[wi]
    const v = w.vertices

    // distance along the walk; every chord is one ruler long except the leftover at the end
    const total = w.count * w.ruler + w.leftoverKm
    const d = clamp01(progress) * total
    if (d === st.lastDistance) return
    st.lastDistance = d
    const k = Math.min(Math.floor(d / w.ruler), w.segments - 1)
    const len = k < w.count ? w.ruler : w.leftoverKm
    const f = len > 0 ? clamp01((d - k * w.ruler) / len) : 1

    const a = k * 3
    const hx = v[a] + f * (v[a + 3] - v[a])
    const hy = v[a + 1] + f * (v[a + 4] - v[a + 1])

    // the chord that pointed at the head last frame gets its true end back
    const segs = walk.segs
    // (restored unconditionally: when the head jumps back onto this same chord's start the
    // chord must not keep last frame's shortened end)
    if (st.partial >= 0) {
      const o6 = st.partial * 6
      const e = (st.partial + 1) * 3
      segs[o6 + 3] = v[e]
      segs[o6 + 4] = v[e + 1]
    }
    const drawPartial = f > MIN_FRACTION
    if (drawPartial) {
      segs[k * 6 + 3] = hx
      segs[k * 6 + 4] = hy
      st.partial = k
    } else {
      st.partial = -1
    }
    walk.segBuffer.needsUpdate = true
    walk.geometry.instanceCount = k + (drawPartial ? 1 : 0)
    // a dot on every vertex reached (the final vertex is the start again, already dotted)
    walk.dotGeometry.setDrawRange(0, k + 1)
    walk.head.setPosition(0, hx, hy, 0)
  })

  return (
    <group position={[fit.x, fit.y, 0]} scale={fit.s}>
      <primitive object={coast.line} />
      <primitive object={walk.root} />
    </group>
  )
}
