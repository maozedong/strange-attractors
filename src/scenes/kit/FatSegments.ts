/**
 * A batch of glowing line segments whose ends and colours a scene rewrites in place (rods,
 * trails, rings of weather). House line material: additive, butt-jointed, anti-aliased, on top
 * of the dust. `mirror()` makes a second, dimmer draw of the same buffers for a reflection in
 * the floor.
 */
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'

const noRaycast = () => {}

export class FatSegments {
  readonly line: LineSegments2
  readonly geometry: LineSegmentsGeometry
  /** start xyz, end xyz per segment */
  readonly pos: Float32Array
  /** start rgb, end rgb per segment (linear, may exceed 1) */
  readonly col: Float32Array
  readonly capacity: number
  private readonly materials: { m: LineMaterial; k: number }[] = []
  private readonly posBuf: THREE.InterleavedBuffer
  private readonly colBuf: THREE.InterleavedBuffer
  private readonly width: number
  private shown = 0

  constructor(capacity: number, width: number, renderOrder = 20) {
    this.capacity = capacity
    this.width = width
    const g = new LineSegmentsGeometry()
    g.setPositions(new Float32Array(capacity * 6))
    g.setColors(new Float32Array(capacity * 6))
    this.posBuf = (g.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data
    this.colBuf = (g.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data
    this.posBuf.setUsage(THREE.DynamicDrawUsage)
    this.pos = this.posBuf.array as Float32Array
    this.col = this.colBuf.array as Float32Array
    g.instanceCount = 0
    this.geometry = g
    const m = createTrajectoryLineMaterial(width)
    this.materials.push({ m, k: 1 })
    this.line = new LineSegments2(g, m)
    this.line.frustumCulled = false
    this.line.raycast = noRaycast
    this.line.renderOrder = renderOrder
  }

  /** segments drawn */
  get count() {
    return this.shown
  }

  set count(n: number) {
    this.shown = Math.max(0, Math.min(this.capacity, n))
    this.geometry.instanceCount = this.shown
  }

  /** upload the first `count` segments' ends (and colours) */
  commit(colors = false) {
    const n = this.shown * 6
    if (n === 0) return
    this.posBuf.clearUpdateRanges()
    this.posBuf.addUpdateRange(0, n)
    this.posBuf.needsUpdate = true
    if (colors) this.commitColors()
  }

  commitColors() {
    const n = this.shown * 6
    if (n === 0) return
    this.colBuf.clearUpdateRanges()
    this.colBuf.addUpdateRange(0, n)
    this.colBuf.needsUpdate = true
  }

  /** set every segment end's colour */
  fillColor(c: THREE.Color, from = 0, to = this.capacity) {
    const a = this.col
    for (let i = from * 2; i < to * 2; i++) {
      a[i * 3] = c.r
      a[i * 3 + 1] = c.g
      a[i * 3 + 2] = c.b
    }
    this.colBuf.clearUpdateRanges()
    this.colBuf.needsUpdate = true
  }

  /** a second draw of the same buffers at `k` of the brightness (for a reflection) */
  mirror(k: number): LineSegments2 {
    const m = createTrajectoryLineMaterial(this.width)
    m.side = THREE.DoubleSide
    this.materials.push({ m, k })
    const l = new LineSegments2(this.geometry, m)
    l.frustumCulled = false
    l.raycast = noRaycast
    l.renderOrder = this.line.renderOrder - 1
    return l
  }

  /** overall brightness multiplier (mirrors keep their own fraction of it) */
  set opacity(v: number) {
    for (const { m, k } of this.materials) {
      m.opacity = v * k
      m.uniforms.opacity.value = v * k
    }
    const on = v > 0.0005
    for (const { m } of this.materials) m.visible = on
  }

  setPixelRatio(dpr: number) {
    for (const { m } of this.materials) setLinePixelRatio(m, dpr)
  }

  dispose() {
    this.geometry.dispose()
    for (const { m } of this.materials) m.dispose()
  }
}

const pointVert = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uDpr;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uDpr;
}
`

const pointFrag = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  // a solid bead with a soft rim and a faint halo
  float disc = 1.0 - smoothstep(0.42, 0.62, r);
  float halo = (1.0 - r) * (1.0 - r) * 0.35;
  gl_FragColor = vec4(vColor * (disc + halo) * uOpacity, 1.0);
}
`

/** Round glowing beads of a given pixel size each (weights, heads, stations). */
export class Beads {
  readonly points: THREE.Points
  readonly pos: Float32Array
  readonly col: Float32Array
  readonly size: Float32Array
  readonly capacity: number
  private readonly geometry = new THREE.BufferGeometry()
  private readonly materials: { m: THREE.ShaderMaterial; k: number }[] = []
  private readonly posAttr: THREE.BufferAttribute
  private readonly colAttr: THREE.BufferAttribute
  private readonly sizeAttr: THREE.BufferAttribute

  constructor(capacity: number, renderOrder = 22) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    this.col = new Float32Array(capacity * 3)
    this.size = new Float32Array(capacity)
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.colAttr = new THREE.BufferAttribute(this.col, 3)
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1)
    this.geometry.setAttribute('position', this.posAttr)
    this.geometry.setAttribute('aColor', this.colAttr)
    this.geometry.setAttribute('aSize', this.sizeAttr)
    this.geometry.setDrawRange(0, 0)
    const m = this.material()
    this.materials.push({ m, k: 1 })
    this.points = new THREE.Points(this.geometry, m)
    this.points.frustumCulled = false
    this.points.raycast = noRaycast
    this.points.renderOrder = renderOrder
  }

  set count(n: number) {
    this.geometry.setDrawRange(0, Math.max(0, Math.min(this.capacity, n)))
  }

  commit(colors = false) {
    this.posAttr.needsUpdate = true
    if (colors) {
      this.colAttr.needsUpdate = true
      this.sizeAttr.needsUpdate = true
    }
  }

  mirror(k: number): THREE.Points {
    const m = this.material()
    this.materials.push({ m, k })
    const p = new THREE.Points(this.geometry, m)
    p.frustumCulled = false
    p.raycast = noRaycast
    p.renderOrder = this.points.renderOrder - 1
    return p
  }

  set opacity(v: number) {
    for (const { m, k } of this.materials) {
      m.uniforms.uOpacity.value = v * k
      m.visible = v > 0.0005
    }
  }

  setPixelRatio(dpr: number) {
    for (const { m } of this.materials) m.uniforms.uDpr.value = dpr
  }

  dispose() {
    this.geometry.dispose()
    for (const { m } of this.materials) m.dispose()
  }

  private material() {
    return new THREE.ShaderMaterial({
      vertexShader: pointVert,
      fragmentShader: pointFrag,
      uniforms: { uDpr: { value: 1 }, uOpacity: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  }
}

/** world-space reflection in a horizontal floor at height `y` */
export function floorMirror(y: number): THREE.Group {
  const g = new THREE.Group()
  g.scale.y = -1
  g.position.y = 2 * y
  return g
}
