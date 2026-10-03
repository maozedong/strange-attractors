import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../store'
import { MAX_BOXES, boxLattice, lorenzSample, unitCubeEdges } from './boxCounting'

const INK = '#efe8dc'
/** brightness of one cube edge, as a fraction of the ink colour, per CSS pixel of line width */
const BOX_GAIN = 0.3
/** cross-fade time when the edge changes, s */
const FADE_S = 0.4

const noRaycast = () => {}

export interface BoxCountProps {
  /** 0..1, fades everything. Default 1 */
  opacity?: number
}

/**
 * Edge-only cube lattice. One instance per occupied cell: `aCell` holds its integer grid
 * coordinates and `aMask` the 12-bit set of edges it owns (so a lattice edge shared by up to
 * four cells is drawn once and additive blending stays even). Each of the 24 vertices of the
 * unit-cube edge list carries 2^edge in `aBit`; the masks are small integers stored exactly in
 * floats, and an edge that is not owned is moved outside the clip volume.
 */
const latticeVert = /* glsl */ `
uniform float uEdge;
attribute float aBit;
attribute vec3 aCell;
attribute float aMask;
void main() {
  float on = mod(floor((aMask + 0.5) / aBit), 2.0);
  if (on < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4((aCell + position) * uEdge, 1.0);
}
`

const latticeFrag = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
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

interface Layer {
  object: THREE.LineSegments<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  cell: THREE.InstancedBufferAttribute
  mask: THREE.InstancedBufferAttribute
  /** edge currently in the buffers; 0 = empty */
  edge: number
  /** 0..1 cross-fade weight */
  alpha: number
}

function createLayers(): { layers: [Layer, Layer]; dispose: () => void } {
  const position = new THREE.BufferAttribute(unitCubeEdges(), 3)
  const bitValues = new Float32Array(24)
  for (let v = 0; v < 24; v++) bitValues[v] = 2 ** (v >> 1)
  const bit = new THREE.BufferAttribute(bitValues, 1)

  const make = (): Layer => {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', position)
    geometry.setAttribute('aBit', bit)
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOXES * 3), 3).setUsage(THREE.DynamicDrawUsage)
    const mask = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOXES), 1).setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aCell', cell)
    geometry.setAttribute('aMask', mask)
    geometry.instanceCount = 0
    // positions are unit-cube corners, not the lattice; nothing should compute bounds from them
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    const material = new THREE.ShaderMaterial({
      name: 'BoxCount.lattice',
      vertexShader: latticeVert,
      fragmentShader: latticeFrag,
      uniforms: { uEdge: { value: 1 }, uColor: { value: new THREE.Color(0, 0, 0) } },
      toneMapped: false,
      ...additive,
    })
    const object = new THREE.LineSegments(geometry, material)
    object.frustumCulled = false
    object.raycast = noRaycast
    object.renderOrder = 2
    object.visible = false
    return { object, cell, mask, edge: 0, alpha: 0 }
  }

  const layers: [Layer, Layer] = [make(), make()]
  return {
    layers,
    dispose() {
      for (const l of layers) {
        l.object.geometry.dispose()
        l.object.material.dispose()
      }
    },
  }
}

let warnedTooFine = false

/** Put the occupied cells of `edge` into the layer's instance buffers. */
function fill(layer: Layer, edge: number): void {
  const lattice = boxLattice(edge)
  const n = lattice ? lattice.drawn : 0
  if (!lattice && !warnedTooFine) {
    warnedTooFine = true
    console.warn(`BoxCount: edge ${edge} is too fine to grid; nothing drawn`)
  }
  if (lattice && n > 0) {
    ;(layer.cell.array as Float32Array).set(lattice.cells)
    ;(layer.mask.array as Float32Array).set(lattice.masks)
    layer.cell.clearUpdateRanges()
    layer.cell.addUpdateRange(0, n * 3)
    layer.cell.needsUpdate = true
    layer.mask.clearUpdateRanges()
    layer.mask.addUpdateRange(0, n)
    layer.mask.needsUpdate = true
  }
  layer.object.geometry.instanceCount = n
  layer.object.material.uniforms.uEdge.value = edge
  layer.edge = edge
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step)
}

/** The latest props, for frame loops that must not re-subscribe when they change. */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/**
 * Box counting on the Lorenz butterfly: the cubes of edge `coast.box` (render units; 0 hides)
 * that a 200k-point trajectory of the default Lorenz attractor passes through, drawn as a thin
 * additive wire lattice. Mount inside the swarm's group (rotation-x −π/2): it works in render
 * units (p − frame.center) × frame.scale of lorenz at its default parameters, on a grid aligned
 * to the render-space origin. Cross-fades over 0.4 s when the edge changes; draws at most
 * MAX_BOXES cubes (edges down to ≈ 0.008). Reads the store every frame; never re-renders for it.
 */
export function BoxCount({ opacity = 1 }: BoxCountProps) {
  const live = useLatest({ opacity })
  const lattice = useMemo(createLayers, [])
  useEffect(() => () => lattice.dispose(), [lattice])

  // the trajectory sample (~20 ms of RK4) once the page is idle, so the first edge only pays for
  // the count; if boxes are asked for sooner, the first fill computes it
  useEffect(() => {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(() => lorenzSample(), { timeout: 4000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(() => lorenzSample(), 1000)
    return () => clearTimeout(id)
  }, [])

  const [st] = useState(() => ({ front: 0, ink: new THREE.Color(INK) }))

  useFrame((state, delta) => {
    const target = useStore.getState().coast.box
    const layers = lattice.layers
    let front = layers[st.front]
    let back = layers[1 - st.front]

    if (target > 0 && target !== front.edge) {
      if (target === back.edge) {
        // going back to what is fading out: reverse the fade
        st.front = 1 - st.front
      } else if (front.alpha <= back.alpha) {
        // new content goes into whichever layer is dimmer, so a swap never pops a bright layer
        fill(front, target)
      } else {
        fill(back, target)
        st.front = 1 - st.front
      }
      front = layers[st.front]
      back = layers[1 - st.front]
    }

    const step = Math.min(delta, 0.1) / FADE_S
    front.alpha = approach(front.alpha, target > 0 ? 1 : 0, step)
    back.alpha = approach(back.alpha, 0, step)

    // GL lines are one device pixel wide: scale by the pixel ratio so the lattice carries the
    // same ink per CSS pixel at any density
    const gain = BOX_GAIN * live.current.opacity * state.gl.getPixelRatio()
    for (const l of layers) {
      const a = l.alpha * gain
      l.object.visible = a > 0 && l.object.geometry.instanceCount > 0
      if (l.object.visible) (l.object.material.uniforms.uColor.value as THREE.Color).copy(st.ink).multiplyScalar(a)
    }
  })

  return (
    <group>
      <primitive object={lattice.layers[0].object} />
      <primitive object={lattice.layers[1].object} />
    </group>
  )
}
