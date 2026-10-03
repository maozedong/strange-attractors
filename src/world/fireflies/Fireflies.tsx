import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useStore } from '../../store'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import { advanceStage, createStage, MAX_FIREFLIES } from './sim'
import { buildTree, TREE_BASE_Y } from './tree'

/**
 * A tree full of fireflies, each blinking on its own clock: the Kuramoto model (./sim), one
 * oscillator per firefly, coupled all-to-all with strength `fireflies.coupling`. Below the
 * critical coupling the crown twinkles at random; above it a core falls into step, then the
 * stragglers, until the whole tree flashes as one.
 *
 * Driven by `fireflies` in the store, read every frame: a `resetSerial` change draws new
 * clocks (phases and frequencies) and clears the telemetry series; a `count` change adds or
 * drops fireflies in place; `running` integrates or freezes. Writes `worldTele.firefliesOrder`
 * every frame and samples (t, r) into `firefliesT/firefliesR` every 0.1 simulated seconds.
 *
 * Local frame: the trunk's foot at (0, −1.3, 0), +Y up, the crown tops out near y = 1.3 and
 * spans about ±1.4 in x and z. Unlit, additive, depthTest off.
 */

export interface FirefliesProps {
  /** 0..1 fade for the whole stage. Default 1 */
  opacity?: number
}

const INK = '#efe8dc'
/** the flash colour, and the house warm white (top of the speedColor ramp) its cores lean toward */
const FIREFLY = '#d9f48a'
const WARM_WHITE = '#fff0c8'

/** tree line intensity, and how much a tree-wide flash lifts it (light spilling on the bark) */
const TREE_GAIN = 0.15
const TREE_SPILL = 0.7
/** CSS px per level: trunk, limbs, branches, twigs */
const TREE_WIDTHS = [2.6, 1.8, 1.25, 0.9]

/** CSS px at the reference depth (the stage origin's) */
const CORE_PX = 7
const HALO_PX = 22
const HALO_GAIN = 0.25
/** sprite size follows depth, clamped to this range around the reference */
const DEPTH_SCALE_MIN = 0.75
const DEPTH_SCALE_MAX = 1.35

const GROUND_RADIUS = 1.3
/** ground under the crown lit by the mean flash, linear gain at a full tree-wide flash */
const GROUND_SPILL = 0.05

const noRaycast = () => {}

// ---------------------------------------------------------------- shaders

const flyVert = /* glsl */ `
attribute float aFlash;
attribute float aGain;
uniform float uSize;
uniform float uDpr;
uniform float uRefDepth;
varying float vFlash;
varying float vGain;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depthScale = clamp(uRefDepth / max(-mv.z, 1e-3), ${DEPTH_SCALE_MIN.toFixed(2)}, ${DEPTH_SCALE_MAX.toFixed(2)});
  gl_PointSize = uSize * uDpr * depthScale;
  vFlash = aFlash;
  vGain = aGain;
}
`

const flyFrag = /* glsl */ `
uniform vec3 uFly;
uniform vec3 uWarm;
uniform float uGain;
uniform float uOpacity;
varying float vFlash;
varying float vGain;
// the dim glow every firefly keeps between flashes
const float DIM = 0.04;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float b = vFlash + DIM;
#ifdef HALO
  // wide, faint glow, exactly 0 at the rim
  float shape = exp(-5.0 * d2) * (1.0 - d2);
  vec3 col = uFly;
#else
  // a solid little disc with a soft edge, so 7 px stays round without MSAA
  float shape = 1.0 - smoothstep(0.2, 1.0, d2);
  // the hot centre of a flash leans toward warm white
  vec3 col = mix(uFly, uWarm, 0.35 * vFlash);
#endif
  gl_FragColor = vec4(col * (b * shape * uGain * vGain * uOpacity), 1.0);
  #include <colorspace_fragment>
}
`

const groundVert = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const groundFrag = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uFly;
uniform float uGlow;
uniform float uOpacity;
varying vec2 vP;
const float RADIUS = ${GROUND_RADIUS.toFixed(2)};
void main() {
  float d = length(vP) / RADIUS;
  if (d > 1.0) discard;
  // a whisper of ground with a faint edge (linear: 0.005 already reads once encoded)
  float fill = 0.005 * (1.0 - smoothstep(0.5, 1.0, d));
  float e = (d - 0.975) / 0.016;
  float rim = 0.03 * exp(-e * e);
  // light from the crown pooling under it
  float pool = exp(-3.0 * d * d) * uGlow * ${GROUND_SPILL.toFixed(3)};
  gl_FragColor = vec4((uInk * (fill + rim) + uFly * pool) * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`

// ---------------------------------------------------------------- GPU objects

function createRig(flashes: Float32Array) {
  const tree = buildTree(MAX_FIREFLIES)
  const ink = new THREE.Color(INK)

  // the tree: one fat-line set per level so the trunk is thicker than the twigs
  const lines: LineSegments2[] = []
  const lineMaterials: LineMaterial[] = []
  tree.segments.forEach((segs, level) => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(segs)
    const col = new Float32Array(segs.length)
    for (let i = 0; i < col.length; i += 3) {
      col[i] = ink.r * TREE_GAIN
      col[i + 1] = ink.g * TREE_GAIN
      col[i + 2] = ink.b * TREE_GAIN
    }
    geometry.setColors(col)
    const material = createTrajectoryLineMaterial(TREE_WIDTHS[level])
    const line = new LineSegments2(geometry, material)
    line.frustumCulled = false
    line.raycast = noRaycast
    line.renderOrder = 1
    lines.push(line)
    lineMaterials.push(material)
  })

  // the fireflies: perches (static), a per-firefly gain (static), the flash (every frame)
  const gain = new Float32Array(MAX_FIREFLIES)
  let seed = 0x51f1
  for (let i = 0; i < MAX_FIREFLIES; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    gain[i] = 0.7 + 0.3 * (seed / 4294967296)
  }
  const flyGeometry = new THREE.BufferGeometry()
  flyGeometry.setAttribute('position', new THREE.BufferAttribute(tree.perches, 3))
  flyGeometry.setAttribute('aGain', new THREE.BufferAttribute(gain, 1))
  const flashAttr = new THREE.BufferAttribute(flashes, 1).setUsage(THREE.DynamicDrawUsage)
  flyGeometry.setAttribute('aFlash', flashAttr)
  flyGeometry.setDrawRange(0, 0)
  flyGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 2.2)

  const fly = new THREE.Color(FIREFLY)
  const warm = new THREE.Color(WARM_WHITE)
  const flyMaterial = (halo: boolean) =>
    new THREE.ShaderMaterial({
      name: halo ? 'Fireflies.halo' : 'Fireflies.core',
      vertexShader: flyVert,
      fragmentShader: flyFrag,
      defines: halo ? { HALO: '' } : {},
      uniforms: {
        uSize: { value: halo ? HALO_PX : CORE_PX },
        uDpr: { value: 1 },
        uRefDepth: { value: 4.6 },
        uFly: { value: fly },
        uWarm: { value: warm },
        uGain: { value: halo ? HALO_GAIN : 1 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  const coreMaterial = flyMaterial(false)
  const haloMaterial = flyMaterial(true)
  const flyMaterials = [coreMaterial, haloMaterial]

  const groundGeometry = new THREE.PlaneGeometry(2 * GROUND_RADIUS, 2 * GROUND_RADIUS)
  const groundMaterial = new THREE.ShaderMaterial({
    name: 'Fireflies.ground',
    vertexShader: groundVert,
    fragmentShader: groundFrag,
    uniforms: { uInk: { value: ink }, uFly: { value: fly }, uGlow: { value: 0 }, uOpacity: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  })

  return {
    lines,
    lineMaterials,
    flyGeometry,
    flashAttr,
    coreMaterial,
    haloMaterial,
    flyMaterials,
    groundGeometry,
    groundMaterial,
    dispose() {
      for (const l of lines) l.geometry.dispose()
      for (const m of lineMaterials) m.dispose()
      flyGeometry.dispose()
      for (const m of flyMaterials) m.dispose()
      groundGeometry.dispose()
      groundMaterial.dispose()
    },
  }
}

// ---------------------------------------------------------------- the stage

export function Fireflies({ opacity = 1 }: FirefliesProps) {
  // latest props for the frame loop, which must not restart when they change
  const live = useRef({ opacity })
  live.current.opacity = opacity
  const group = useRef<THREE.Group>(null)
  const [stage] = useState(createStage)
  const rig = useMemo(() => createRig(stage.flashes), [stage])
  useEffect(() => () => rig.dispose(), [rig])

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    advanceStage(stage, useStore.getState().fireflies, delta)
    if (stage.changed) {
      rig.flashAttr.needsUpdate = true
      rig.flyGeometry.setDrawRange(0, stage.sim.count)
    }

    const fade = Math.max(0, Math.min(1, live.current.opacity))
    const dpr = state.gl.getPixelRatio()
    // sprites keep their nominal size at the depth of the stage's origin
    const refDepth = Math.max(0.1, -_v.setFromMatrixPosition(g.matrixWorld).applyMatrix4(state.camera.matrixWorldInverse).z)
    for (let i = 0; i < rig.flyMaterials.length; i++) {
      const m = rig.flyMaterials[i]
      m.uniforms.uDpr.value = dpr
      m.uniforms.uRefDepth.value = refDepth
      m.uniforms.uOpacity.value = fade
    }
    const spill = 1 + TREE_SPILL * stage.glow
    for (let i = 0; i < rig.lineMaterials.length; i++) {
      const m = rig.lineMaterials[i]
      m.resolution.set(state.size.width, state.size.height)
      setLinePixelRatio(m, dpr)
      m.opacity = fade
      m.color.setScalar(spill)
    }
    rig.groundMaterial.uniforms.uGlow.value = stage.glow
    rig.groundMaterial.uniforms.uOpacity.value = fade
    g.visible = fade > 0.001
  })

  return (
    <group ref={group}>
      <mesh
        geometry={rig.groundGeometry}
        material={rig.groundMaterial}
        position-y={TREE_BASE_Y}
        rotation-x={-Math.PI / 2}
        raycast={noRaycast}
        renderOrder={0}
      />
      {rig.lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
      <points geometry={rig.flyGeometry} material={rig.haloMaterial} frustumCulled={false} raycast={noRaycast} renderOrder={2} />
      <points geometry={rig.flyGeometry} material={rig.coreMaterial} frustumCulled={false} raycast={noRaycast} renderOrder={3} />
    </group>
  )
}

const _v = new THREE.Vector3()
