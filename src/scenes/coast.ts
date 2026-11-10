/**
 * How long is the coast of Britain? The coast lies flat on a dark sea, drawn in dust. A ruler
 * walks round it, chord by chord, three times, each time half as long, and the total keeps
 * growing. Then the same measurement on the butterfly: cover it in boxes, halve them, count.
 */
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { Engine } from '../engine/Engine'
import { rampColor } from '../engine/palettes'
import { PointsSource } from '../engine/sources'
import { at, easeInOut, easeOut, type SceneFactory } from '../film/types'
import { boxLattice, unitCubeEdges, MAX_BOXES } from '../fractal/coast/boxCounting'
import { loadBritain, type Britain, type BritainWalk } from '../fractal/coast/britain'
import { HeadPoints } from '../scene/trajectories/HeadPoints'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../scene/trajectories/lineMaterial'
import { sound } from '../sound/audio'
import { plate, readout } from './kit/hud'
import { Plot } from './kit/Plot'
import { FLOOR, ink, lorenzFlow, resetLorenz, silk } from './kit/shared'

/** world units per km, and the height of the sea */
const S = 2.15 / 970
const SEA = FLOOR + 0.004
/** the three rulers the narrator walks, km */
const WALKED = [200, 100, 50]
/** box edges, render units of the butterfly */
const EDGES = [0.125, 0.0625, 0.03125]
const EDGE_NAMES = ['1/8', '1/16', '1/32']

const fmt = (v: number) => Math.round(v).toLocaleString('en-US')
/** a ruler length as written: 200, 12.5 */
const km = (v: number) => (Number.isInteger(v) ? fmt(v) : String(v))

const keep = new WeakMap<Engine, PointsSource>()

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The coast in dust: particles spread evenly along the line, a few thrown just offshore as surf. */
function coastSource(engine: Engine, data: Britain): PointsSource {
  const kept = keep.get(engine)
  if (kept) return kept
  const src = new PointsSource(engine.size)
  const pts = data.points
  const m = pts.length / 3
  const [x0, y0, x1, y1] = data.bbox
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  // cumulative length, and which way is out to sea
  const cum = new Float64Array(m)
  let area = 0
  for (let i = 1; i < m; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2])
    area += pts[i * 3 - 3] * pts[i * 3 + 1] - pts[i * 3] * pts[i * 3 - 2]
  }
  const total = cum[m - 1]
  // counter-clockwise rings have the sea on the right of the direction of travel
  const outSign = area > 0 ? 1 : -1
  const r = rng(0xc0a57)
  const d = src.data
  let seg = 1
  for (let i = 0; i < src.count; i++) {
    const o = i * 4
    const kind = r()
    if (kind < 0.022) {
      // a faint sea: a few motes far out on the water
      const a = r() * Math.PI * 2
      const rad = 1.3 + 2.6 * Math.sqrt(r())
      d[o] = Math.cos(a) * rad * 1.3
      d[o + 1] = SEA
      d[o + 2] = Math.sin(a) * rad
      d[o + 3] = 0.12 + 0.12 * r()
      continue
    }
    // even spacing by arc length (a stratified sample, so no clumps)
    const s = ((i + r()) / src.count) * total
    if (s < cum[seg - 1]) seg = 1
    while (seg < m - 1 && cum[seg] < s) seg++
    const a = seg - 1
    const t = (s - cum[a]) / Math.max(1e-9, cum[seg] - cum[a])
    const ax = pts[a * 3]
    const ay = pts[a * 3 + 1]
    const bx = pts[seg * 3]
    const by = pts[seg * 3 + 1]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    // outward normal
    const nx = (dy / len) * outSign
    const ny = (-dx / len) * outSign
    let off = (r() - 0.5) * 0.7
    let aux = 0.6 + 0.12 * r()
    if (kind < 0.075) {
      // surf: just offshore, dimmer the further out
      const u = r()
      off = 1.5 + 13 * u * u
      aux = 0.5 - 0.22 * u
    }
    const kx = ax + dx * t + nx * off
    const ky = ay + dy * t + ny * off
    d[o] = (kx - cx) * S
    d[o + 1] = SEA + (r() - 0.5) * 0.002
    d[o + 2] = -(ky - cy) * S
    d[o + 3] = aux
  }
  src.commit()
  keep.set(engine, src)
  return src
}

// ---------------------------------------------------------------- a ruler walk, drawn

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
  float a = 1.0 - smoothstep(0.35, 1.0, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`

class Walk {
  readonly group = new THREE.Group()
  readonly walk: BritainWalk
  /** chords drawn so far (fractional: the head glides along the current one) */
  progress = 0
  opacity = 1
  private readonly geometry = new LineGeometry()
  private readonly material
  private readonly segs: Float32Array
  private readonly buffer: THREE.InterleavedBuffer
  private readonly verts: Float32Array
  private readonly dots: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly head = new HeadPoints(1)
  private readonly color: THREE.Color
  private partial = -1

  constructor(walk: BritainWalk, toWorld: (kx: number, ky: number, out: THREE.Vector3) => THREE.Vector3, color: THREE.Color) {
    this.walk = walk
    this.color = color
    const n = walk.vertices.length / 3
    this.verts = new Float32Array(n * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      toWorld(walk.vertices[i * 3], walk.vertices[i * 3 + 1], v)
      this.verts.set([v.x, v.y, v.z], i * 3)
    }
    this.geometry.setPositions(this.verts)
    const start = this.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    this.buffer = start.data
    this.segs = this.buffer.array as Float32Array
    this.geometry.instanceCount = 0
    this.material = createTrajectoryLineMaterial(1.6)
    this.material.vertexColors = false
    const line = new Line2(this.geometry, this.material)
    line.frustumCulled = false
    line.renderOrder = 21

    const dg = new THREE.BufferGeometry()
    dg.setAttribute('position', new THREE.BufferAttribute(this.verts, 3))
    dg.setDrawRange(0, 0)
    this.dots = new THREE.Points(
      dg,
      new THREE.ShaderMaterial({
        vertexShader: dotVert,
        fragmentShader: dotFrag,
        uniforms: { uSize: { value: 6 }, uColor: { value: new THREE.Color() } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    this.dots.frustumCulled = false
    this.dots.renderOrder = 22
    this.head.setCount(1)
    this.head.points.renderOrder = 23
    this.group.add(line, this.dots, this.head.points)
  }

  get segments() {
    return this.walk.segments
  }

  /** full ruler steps laid so far */
  get steps() {
    return Math.min(this.walk.count, Math.floor(this.progress))
  }

  update(dpr: number) {
    const segs = this.segs
    const v = this.verts
    const total = this.walk.segments
    const p = Math.min(total, Math.max(0, this.progress))
    const k = Math.min(Math.floor(p), total - 1)
    const f = p >= total ? 1 : p - k
    if (this.partial >= 0) {
      const e = (this.partial + 1) * 3
      segs[this.partial * 6 + 3] = v[e]
      segs[this.partial * 6 + 4] = v[e + 1]
      segs[this.partial * 6 + 5] = v[e + 2]
      this.partial = -1
    }
    const a = k * 3
    const hx = v[a] + (v[a + 3] - v[a]) * f
    const hy = v[a + 1] + (v[a + 4] - v[a + 1]) * f
    const hz = v[a + 2] + (v[a + 5] - v[a + 2]) * f
    const drawPartial = f > 1e-4 && f < 1
    if (drawPartial) {
      segs[k * 6 + 3] = hx
      segs[k * 6 + 4] = hy
      segs[k * 6 + 5] = hz
      this.partial = k
    }
    this.buffer.needsUpdate = true
    this.geometry.instanceCount = p >= total ? total : k + (drawPartial ? 1 : 0)
    this.dots.geometry.setDrawRange(0, Math.min(total, k + 1))
    const o = this.opacity
    const c = this.color
    this.material.color.copy(c).multiplyScalar(o)
    ;(this.dots.material.uniforms.uColor.value as THREE.Color).copy(c).multiplyScalar(0.8 * o)
    this.dots.material.uniforms.uSize.value = 6 * dpr
    this.head.setPosition(0, hx, hy, hz)
    this.head.setColor(0, new THREE.Color().copy(c).multiplyScalar(o * (p > 0 && p < total ? 1 : 0)))
    this.head.setPixelRatio(dpr)
    setLinePixelRatio(this.material, dpr)
    this.group.visible = o > 0.003 && p > 0
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    this.dots.geometry.dispose()
    this.dots.material.dispose()
    this.head.dispose()
  }
}

// ---------------------------------------------------------------- boxes on the butterfly

const latticeVert = /* glsl */ `
uniform float uEdge;
uniform float uSweep;
attribute float aBit;
attribute vec3 aCell;
attribute float aMask;
attribute float aWhen;
varying float vOn;
void main() {
  float on = mod(floor((aMask + 0.5) / aBit), 2.0);
  vOn = smoothstep(aWhen, aWhen + 0.12, uSweep);
  if (on < 0.5 || vOn <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4((aCell + position) * uEdge, 1.0);
}
`
const latticeFrag = /* glsl */ `
uniform vec3 uColor;
varying float vOn;
void main() {
  // a cell flares as the sweep reaches it, then settles
  gl_FragColor = vec4(uColor * vOn, 1.0);
}
`

class BoxLayer {
  readonly object: THREE.LineSegments<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  edge = 0
  count = 0
  opacity = 0
  sweep = 0
  private readonly cell: THREE.InstancedBufferAttribute
  private readonly mask: THREE.InstancedBufferAttribute
  private readonly when: THREE.InstancedBufferAttribute

  constructor(position: THREE.BufferAttribute, bit: THREE.BufferAttribute) {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', position)
    g.setAttribute('aBit', bit)
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOXES * 3), 3)
    this.mask = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOXES), 1)
    this.when = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOXES), 1)
    g.setAttribute('aCell', this.cell)
    g.setAttribute('aMask', this.mask)
    g.setAttribute('aWhen', this.when)
    g.instanceCount = 0
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    const m = new THREE.ShaderMaterial({
      vertexShader: latticeVert,
      fragmentShader: latticeFrag,
      uniforms: { uEdge: { value: 1 }, uSweep: { value: 0 }, uColor: { value: new THREE.Color() } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    this.object = new THREE.LineSegments(g, m)
    this.object.frustumCulled = false
    this.object.renderOrder = 20
    this.object.visible = false
  }

  fill(edge: number) {
    const lattice = boxLattice(edge)
    const n = lattice ? lattice.drawn : 0
    this.edge = edge
    this.count = lattice ? lattice.count : 0
    if (lattice) {
      ;(this.cell.array as Float32Array).set(lattice.cells)
      ;(this.mask.array as Float32Array).set(lattice.masks)
      // the sweep runs from the left wing to the right (render x), with a little scatter
      const w = this.when.array as Float32Array
      const r = rng(0xb0c5 + n)
      for (let i = 0; i < n; i++) {
        const x = (lattice.cells[i * 3] + 0.5) * edge
        w[i] = Math.min(0.88, Math.max(0, (x + 1.05) / 2.1)) * 0.82 + r() * 0.06
      }
      this.cell.needsUpdate = true
      this.mask.needsUpdate = true
      this.when.needsUpdate = true
    }
    this.object.geometry.instanceCount = n
    this.object.material.uniforms.uEdge.value = edge
  }

  update(color: THREE.Color, dpr: number) {
    const u = this.object.material.uniforms
    u.uSweep.value = this.sweep
    // smaller boxes are many more lines: each one quieter
    const k = Math.pow(this.edge / 0.125, 0.55) * this.opacity * dpr
    ;(u.uColor.value as THREE.Color).copy(color).multiplyScalar(k)
    this.object.visible = this.opacity > 0.003 && this.object.geometry.instanceCount > 0
  }

  dispose() {
    this.object.geometry.dispose()
    this.object.material.dispose()
  }
}

// ---------------------------------------------------------------- the scene

const coast: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const flow = lorenzFlow(engine)
  let data: Britain | null = null
  let src: PointsSource | null = null
  const ready = loadBritain().then((d) => {
    data = d
    src = coastSource(engine, d)
    return d
  })

  const [bx0, by0, bx1, by1] = [-243.29, -443.5, 280.73, 525.89]
  const cx = (bx0 + bx1) / 2
  const cy = (by0 + by1) / 2
  const toWorld = (kx: number, ky: number, out: THREE.Vector3) => out.set((kx - cx) * S, SEA + 0.004, -(ky - cy) * S)
  const walkColor = rampColor(palette, 0.92).multiplyScalar(1.7)
  const boxColor = rampColor(palette, 0.62).multiplyScalar(0.55)

  const walks: Walk[] = []
  let current: Walk | null = null
  let walking = 0
  let tickEvery = 1
  let lastSteps = 0
  const totals: string[] = []
  let total: ReturnType<typeof ctx.label> | null = null
  let figure: ReturnType<typeof ctx.label> | null = null
  let plot: Plot | null = null
  let big: ReturnType<typeof ctx.label> | null = null
  let plotShown = 3

  const coastLook = () => ({
    ...ink(palette),
    tone: 'aux' as const,
    toneBias: 0,
    toneScale: 1,
    size: 0.0021,
    minPx: 0.5,
    gain: 0.03,
    twinkle: 0.18,
  })

  /** walk the coast with a ruler, finishing in `seconds` */
  const walkRuler = (ruler: number, seconds: number) => {
    if (!data) return
    const w = data.walks.find((x) => x.ruler === ruler)
    if (!w) return
    // the previous walk steps back
    const prev = current
    if (prev) ctx.tween(0.8, (u) => (prev.opacity = 1 - u), { tag: `fade-${prev.walk.ruler}` })
    const walk = new Walk(w, toWorld, walkColor)
    root.add(walk.group)
    walks.push(walk)
    current = walk
    walking = w.segments / Math.max(0.8, seconds)
    lastSteps = 0
    tickEvery = Math.max(1, Math.round(walking / 3.5))
    if (!figure) figure = readout(ctx)
    figure.set(`${km(ruler)} km × 0 = 0 km`)
  }

  const finishWalk = () => {
    if (!current) return
    const w = current.walk
    if (!total) total = plate(ctx, '', '')
    if (w.ruler === WALKED[totals.length]) {
      // the film's three walks are listed side by side
      totals.push(fmt(w.count * w.ruler))
      total.setHtml(`${totals.join(' · ')} km<small>rulers of ${WALKED.slice(0, totals.length).join(', ')} km</small>`)
    } else {
      total.setHtml(`${fmt(w.count * w.ruler)} km<small>a ruler of ${km(w.ruler)} km</small>`)
    }
  }

  const drawPlot = () => {
    if (!plot || !data) return
    const { g, width: w, height: h } = plot
    plot.clear()
    const x0 = 8
    const y0 = h - 10
    const top = 10
    // log ruler, longest on the left; log length
    const lx = (r: number) => x0 + ((Math.log2(400) - Math.log2(r)) / (Math.log2(400) - Math.log2(6.25))) * (w - x0 - 8)
    const ly = (L: number) => y0 - ((Math.log(L) - Math.log(1800)) / (Math.log(6500) - Math.log(1800))) * (y0 - top)
    g.lineWidth = 1
    g.strokeStyle = plot.ink(0.22)
    g.beginPath()
    g.moveTo(x0, top)
    g.lineTo(x0, y0)
    g.lineTo(w, y0)
    g.stroke()
    const walks_ = data.walks.filter((x) => x.ruler <= 200).sort((a, b) => b.ruler - a.ruler)
    const shown = walks_.slice(0, plotShown)
    // the line through them
    g.strokeStyle = plot.ink(0.7)
    g.lineWidth = 1.25
    g.beginPath()
    shown.forEach((x, i) => {
      const X = lx(x.ruler)
      const Y = ly(x.count * x.ruler)
      if (i === 0) g.moveTo(X, Y)
      else g.lineTo(X, Y)
    })
    g.stroke()
    shown.forEach((x, i) => {
      g.fillStyle = plot!.ink(i < 3 ? 0.95 : 0.55)
      g.beginPath()
      g.arc(lx(x.ruler), ly(x.count * x.ruler), i < 3 ? 3 : 2.2, 0, Math.PI * 2)
      g.fill()
    })
    const last = shown[shown.length - 1]
    plot.setValue(`${fmt(last.count * last.ruler)} km`)
  }

  // the butterfly's boxes
  const cubeEdges = new THREE.BufferAttribute(unitCubeEdges(), 3)
  const bits = new Float32Array(24)
  for (let v = 0; v < 24; v++) bits[v] = 2 ** (v >> 1)
  const bitAttr = new THREE.BufferAttribute(bits, 1)
  const layers = [new BoxLayer(cubeEdges, bitAttr), new BoxLayer(cubeEdges, bitAttr)]
  const boxes = new THREE.Group()
  // render units are z-up, like the butterfly's own frame
  boxes.rotation.x = -Math.PI / 2
  for (const l of layers) boxes.add(l.object)
  root.add(boxes)
  let front = 0
  let edgeIndex = -1

  const showBoxes = (i: number, seconds: number) => {
    edgeIndex = i
    const old = layers[front]
    front = 1 - front
    const layer = layers[front]
    layer.fill(EDGES[i])
    layer.sweep = 0
    layer.opacity = 1
    ctx.tween(seconds, (u) => (layer.sweep = u), { tag: `sweep-${front}` })
    ctx.tween(seconds * 0.6, (u) => (old.opacity = Math.min(old.opacity, 1 - u)), { tag: `boxfade-${1 - front}` })
    sound.sfx('shimmer', 0.25)
    if (!figure) figure = readout(ctx)
  }

  const toButterfly = () => {
    current = null
    total?.remove()
    total = null
    plot?.remove()
    plot = null
    big?.remove()
    big = null
    figure?.remove()
    figure = null
    for (const w of walks) {
      const ww = w
      ctx.tween(1, (u) => (ww.opacity = Math.min(ww.opacity, 1 - u)))
    }
    resetLorenz(flow)
    dust.floorY = FLOOR
    engine.backdrop.floor = 1
    void dust.morphTo(flow, { ...silk(palette, flow.speedNorm), gain: 0.42 }, { seconds: 2.6, swirl: 0.8 })
    rig.shot({ target: [0, -0.08, 0], distance: 4.35, azimuth: 28, elevation: 13, orbit: 1.8, aperture: 0.004, fov: 38 }, 3.4)
  }

  return {
    enter() {
      // the coast lies on the sea itself: no mirror (it would draw every bay twice)
      dust.floorY = null
      engine.backdrop.floor = 0.5
      void ready.then(() => {
        if (src) void dust.morphTo(src, coastLook(), { seconds: 3, swirl: 0.9 })
      })
      // from the south, about fifty degrees up
      rig.shot(
        { target: [0, SEA, 0.24], distance: 3.55, azimuth: 6, elevation: 52, fov: 38, orbit: 0, aperture: 0.003, portrait: { distance: 2.4, target: [0, SEA, 0.1] } },
        3.4,
      )
    },

    cues: [
      // "Walk it with a ruler 200 kilometres long, and you get about 2,200 kilometres."
      at(1, () => walkRuler(200, Math.max(2.5, ctx.until(1, 'about') - 0.1))),
      // "Halve the ruler: 2,800."
      at(2, -0.25, () => walkRuler(100, Math.max(2, ctx.until(2) + 1.5))),
      // "Halve it again: 3,700."
      at(3, -0.4, () => walkRuler(50, Math.max(2.2, ctx.until(3, 'Halve') + 2.0))),
      // "A shorter ruler finds more bays, more headlands. The answer never settles."
      at(4, () => {
        plotShown = 3
        plot = new Plot(engine.labels.root, 'br', 220, 120, 'length against ruler')
        drawPlot()
        // in close to the sea lochs of the west coast
        const p = toWorld(-135, 285, new THREE.Vector3())
        rig.shot({ target: [p.x, SEA, p.z], distance: 1.0, azimuth: -10, elevation: 48, orbit: 0, aperture: 0.004 }, 4.5)
      }),
      at(4, 'never', () => {
        // the shorter rulers this data was also walked with: the total keeps climbing
        for (let k = 4; k <= 6; k++) ctx.after((k - 4) * 0.35, () => {
          plotShown = k
          drawPlot()
          sound.note(660 + k * 40, { gain: 0.06, seconds: 1 })
        })
      }),
      // "A coastline is more than a line, and less than a surface. Its dimension is about one and a quarter."
      at(5, () => {
        rig.shot({ target: [0.18, SEA, 0.24], distance: 3.55, azimuth: 0, elevation: 52, orbit: 0 }, 4)
        if (current) {
          const c = current
          ctx.tween(2, (u) => (c.opacity = 1 - 0.65 * u))
        }
      }),
      at(5, 'dimension', -0.1, () => {
        big = ctx.label('≈ 1.25', { kind: 'big', at: { screen: ctx.portrait ? [0.5, 0.2] : [0.76, 0.42] }, align: 'center' })
      }),
      // "The butterfly can be measured the same way. Cover it in boxes, and count."
      at(6, () => toButterfly()),
      at(6, 'boxes', -0.2, () => showBoxes(0, 1.8)),
      // "Shrink the boxes. Count again."
      at(7, () => showBoxes(1, 1.4)),
      at(7, 'Count', () => showBoxes(2, 1.5)),
      // "More than a sheet. Less than a solid. 2.06."
      // the butterfly steps left to make room for its number
      at(8, () => {
        const right = new THREE.Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 0).setY(0).normalize().multiplyScalar(0.62)
        rig.shot({ target: [right.x, -0.16, right.z], distance: 4.5, elevation: 14, orbit: 0.6, portrait: { target: [0, 0.05, 0], distance: 4.1 } }, 3)
      }),
      at(8, '2.06', -0.15, () => {
        // beside the butterfly; on a tall screen, above it
        big = ctx.label('2.06', { kind: 'big', at: { screen: ctx.portrait ? [0.5, 0.25] : [0.8, 0.42] }, align: 'center' })
      }),
      // "That number is what strange means."
      at(9, () => {
        big?.remove()
        big = null
        figure?.remove()
        figure = null
        for (const l of layers) {
          const ll = l
          ctx.tween(2.4, (u) => (ll.opacity = Math.min(ll.opacity, 1 - u)), { ease: easeInOut })
        }
        rig.shot({ target: [0, -0.24, 0], distance: 3.9, elevation: 11, orbit: 2.4 }, 6)
      }),
    ],

    explore() {
      // the coast with one ruler walking it; other rulers and the boxes are in the drawer
      void ready.then(() => ctx.after(3.2, () => walkRuler(100, 4)))
    },

    update(dt) {
      const dpr = engine.renderer.getPixelRatio()
      if (current && walking > 0 && dt > 0) {
        current.progress = Math.min(current.segments, current.progress + walking * dt)
        const s = current.steps
        if (s !== lastSteps) {
          for (let k = lastSteps + 1; k <= s; k++) if (k % tickEvery === 0) sound.note(880 + (k % 5) * 24, { gain: 0.05, seconds: 0.5 })
          lastSteps = s
          const w = current.walk
          figure?.set(`${km(w.ruler)} km × ${s} = ${fmt(s * w.ruler)} km`)
        }
        if (current.progress >= current.segments) {
          walking = 0
          finishWalk()
        }
      }
      for (const w of walks) w.update(dpr)
      for (const l of layers) l.update(boxColor, dpr)
      if (edgeIndex >= 0 && figure) {
        const l = layers[front]
        const n = Math.round(l.count * Math.min(1, l.sweep * 1.12))
        figure.set(`${fmt(n)} boxes  ·  edge ${EDGE_NAMES[edgeIndex]}`)
      }
    },

    exit() {
      plot?.remove()
      for (const w of walks) {
        const ww = w
        ctx.tween(1, (u) => (ww.opacity = Math.min(ww.opacity, 1 - u)))
      }
      for (const l of layers) {
        const ll = l
        ctx.tween(1.2, (u) => (ll.opacity = Math.min(ll.opacity, 1 - u)), { ease: easeOut })
      }
    },

    dispose() {
      plot?.remove()
      for (const w of walks) w.dispose()
      for (const l of layers) l.dispose()
      // the coast source is kept: the next scene may still be flying out of it
    },

    lab: [
      {
        kind: 'choice',
        label: 'Ruler',
        options: [400, 200, 100, 50, 25, 12.5].map((r) => ({ value: String(r), label: `${r} km` })),
        get: () => String(current?.walk.ruler ?? 200),
        set: (v) => {
          if (dust.source !== src && src) {
            for (const l of layers) l.opacity = 0
            edgeIndex = -1
            void dust.morphTo(src, coastLook(), { seconds: 2, swirl: 0.6 })
            dust.floorY = null
            rig.shot({ target: [0, SEA, 0.24], distance: 3.55, azimuth: 6, elevation: 52, orbit: 0 }, 2.5)
          }
          walkRuler(Number(v), 3)
        },
      },
      {
        kind: 'choice',
        label: 'Box size',
        options: EDGES.map((e, i) => ({ value: String(i), label: EDGE_NAMES[i] })),
        get: () => String(Math.max(0, edgeIndex)),
        set: (v) => {
          if (dust.source !== flow) toButterfly()
          showBoxes(Number(v), 1.4)
        },
      },
      { kind: 'readout', label: 'Measured length', get: () => (current ? `${fmt(current.steps * current.walk.ruler)} km` : '') },
      { kind: 'readout', label: 'Boxes', get: () => (edgeIndex >= 0 ? fmt(layers[front].count) : '') },
    ],
    notes: [
      'The ruler walk is Lewis Fry Richardson\'s: from a starting point, swing a ruler of fixed length until it touches the coast again, and repeat. Each total here counts the full ruler lengths; the last short chord back to the start is left out. The coast is the mainland of Great Britain from Natural Earth\'s 1:10m data, projected flat.',
      'Plotted on logarithmic scales, length against ruler is a straight line. Its slope gives the coast\'s dimension: about 1.25 in Mandelbrot\'s 1967 paper, and 1.26 for this data, walked with rulers from 400 km down to 6 km. A smooth curve would give exactly 1.',
      'Box counting does the same for any shape: halve the box and count how many more you need. A sheet needs four times as many, a solid eight. The butterfly sits between, at 2.06. With the few box sizes drawn here the count rises only about 3.6 times per halving (a dimension near 1.85); the true value appears only as the boxes shrink much further.',
    ],
  }
}

export default coast
