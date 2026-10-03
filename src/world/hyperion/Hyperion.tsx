import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useStore } from '../../store'
import { worldTele } from '../telemetry'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import {
  HYPERION_DT,
  HYPERION_ECCENTRICITY,
  HYPERION_PERIOD_DAYS,
  createPair,
  orbitPosition,
  resetPair,
  type TumbleSim,
} from './dynamics'
import { buildMoonShape } from './shape'
import {
  RING_INNER,
  RING_OUTER,
  SATURN_FLATTENING,
  SATURN_RADIUS,
  ghostFrag,
  ghostVert,
  ringFrag,
  ringVert,
  saturnFrag,
  saturnVert,
} from './shaders'

/**
 * Saturn's chaotically tumbling moon (Wisdom, Peale & Mignard 1984). Cinematic, not to scale.
 *
 * Stage frame (group-local; the camera orbits its origin): Saturn at the origin with its pole
 * and the ring tilted TILT about +X, toward +Z. Hyperion rides a Keplerian ellipse (a = 3,
 * e = 0.1) in the ring plane, periapsis on the tilted +X, prograde. Its attitude comes from
 * dynamics.ts (rigid body, gravity-gradient torque, RK4), stepped `hyperion.speed` orbits per
 * real second. The twin, started TWIN_OFFSET_RAD apart, is always integrated (so it can be
 * shown at any moment) and drawn when `hyperion.twin` is on: at the same orbital point, moved
 * `twinOffset` across the view toward the ring's pole as seen on screen. The pointers start in
 * the ring plane, so this keeps the two needles parallel and apart instead of one stabbing the
 * other; looking down the pole it slides to the camera's right instead.
 *
 * Lit by its own sun and ambient light, which exist only while this stage is mounted.
 */

export interface HyperionStageProps {
  /** size of the moon (and its pointer) relative to the default ~0.2-unit mean radius. Default 1 */
  moonScale?: number
  /** how far the twin is drawn from the real moon, across the view, render units. Default 0.45 */
  twinOffset?: number
}

/** Saturn's obliquity, roughly: tips the pole and the ring plane toward +Z */
export const HYPERION_TILT = (26 * Math.PI) / 180
/** stage-local position of the sun; it shines toward the origin */
export const HYPERION_SUN: [number, number, number] = [5, 2, 3]
/** semi-major axis of the drawn orbit, render units */
export const HYPERION_ORBIT_A = 3

const INK = '#efe8dc'
/** the sun's illuminance, so the moon's lit face peaks near 0.4 (albedo × E / π) */
const SUN_INTENSITY = 5.5
const AMBIENT_INTENSITY = 0.15
/** Saturn's and the ring's own direct gain (their shaders, not the three.js lights) */
const SATURN_SUN = 0.9
const SATURN_AMBIENT = 0.015
const RING_SUN = 1.15
const MOON_COLOR = '#9c8a76'
const GHOST_OPACITY = 0.35
const POINTER_LENGTH = 0.5
const POINTER_PX = 1.5
// 0.4 keeps the needles under the bloom threshold where they cross the bright B ring
const POINTER_GAIN = 0.4
const ORBIT_PX = 1
const ORBIT_GAIN = 0.2
const ORBIT_SEGMENTS = 512
/** RK4 steps per frame, at most (beyond it the clock slows rather than stalls the frame) */
const MAX_STEPS_PER_FRAME = 200

const TAU = 2 * Math.PI
const noRaycast = () => {}
/** dynamics frame (orbit in x-y, normal +z) → Saturn's frame (ring in x-z, pole +y): −90° about x */
const DYN_TO_STAGE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)

/**
 * Where the two moons are right now, in world coordinates, for a camera that wants to follow
 * them. Written every frame while the stage is mounted.
 */
export const hyperionLive = {
  moon: new THREE.Vector3(),
  twin: new THREE.Vector3(),
}

function createLine(points: number[], px: number, gain: number, renderOrder: number) {
  const geometry = new LineGeometry()
  geometry.setPositions(points)
  const material: LineMaterial = createTrajectoryLineMaterial(px)
  material.vertexColors = false
  // drawn into the scene: Saturn hides the far side of the orbit, the moon its own axis
  material.depthTest = true
  material.color.set(INK).multiplyScalar(gain)
  const line = new Line2(geometry, material)
  line.frustumCulled = false
  line.raycast = noRaycast
  line.renderOrder = renderOrder
  return { line, geometry, material }
}

function createRig(moonScale: number) {
  // the sun's direction in Saturn's (tilted) frame, for the planet and ring shaders
  const sunDir = new THREE.Vector3(...HYPERION_SUN).normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0), -HYPERION_TILT)

  const saturnGeometry = new THREE.SphereGeometry(SATURN_RADIUS, 160, 96).scale(1, SATURN_FLATTENING, 1)
  const saturnMaterial = new THREE.ShaderMaterial({
    name: 'Hyperion.saturn',
    vertexShader: saturnVert,
    fragmentShader: saturnFrag,
    uniforms: {
      uLight: { value: sunDir },
      uSun: { value: SATURN_SUN },
      uAmbient: { value: SATURN_AMBIENT },
    },
  })

  const ringGeometry = new THREE.RingGeometry(RING_INNER, RING_OUTER, 256, 1).rotateX(-Math.PI / 2)
  const ringMaterial = new THREE.ShaderMaterial({
    name: 'Hyperion.ring',
    vertexShader: ringVert,
    fragmentShader: ringFrag,
    uniforms: { uLight: { value: sunDir }, uSun: { value: RING_SUN } },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    // premultiplied: the shader writes (light, coverage)
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })

  const shape = buildMoonShape(moonScale)
  const moonGeometry = new THREE.BufferGeometry()
  moonGeometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3))
  moonGeometry.setIndex(new THREE.BufferAttribute(shape.index, 1))
  const rgb = new Float32Array(shape.shade.length * 3)
  for (let i = 0; i < shape.shade.length; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = shape.shade[i]
  moonGeometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
  moonGeometry.setAttribute('aShade', new THREE.BufferAttribute(shape.shade, 1))
  moonGeometry.computeVertexNormals()
  moonGeometry.computeBoundingSphere()
  const moonMaterial = new THREE.MeshStandardMaterial({
    name: 'Hyperion.moon',
    color: MOON_COLOR,
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
  })
  const ghostMaterial = new THREE.ShaderMaterial({
    name: 'Hyperion.ghost',
    vertexShader: ghostVert,
    fragmentShader: ghostFrag,
    uniforms: { uOpacity: { value: GHOST_OPACITY } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const pointer = [0, 0, 0, POINTER_LENGTH * moonScale, 0, 0]
  const moonAxis = createLine(pointer, POINTER_PX, POINTER_GAIN, 4)
  const twinAxis = createLine(pointer, POINTER_PX, POINTER_GAIN, 4)

  const orbitPoints: number[] = []
  const e = HYPERION_ECCENTRICITY
  const b = HYPERION_ORBIT_A * Math.sqrt(1 - e * e)
  for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
    const E = (i / ORBIT_SEGMENTS) * TAU
    orbitPoints.push(HYPERION_ORBIT_A * (Math.cos(E) - e), 0, -b * Math.sin(E))
  }
  const orbit = createLine(orbitPoints, ORBIT_PX, ORBIT_GAIN, 2)

  const lightTarget = new THREE.Object3D()

  return {
    saturnGeometry,
    saturnMaterial,
    ringGeometry,
    ringMaterial,
    moonGeometry,
    moonMaterial,
    ghostMaterial,
    moonAxis,
    twinAxis,
    orbit,
    lightTarget,
    lines: [moonAxis.material, twinAxis.material, orbit.material],
    dispose() {
      saturnGeometry.dispose()
      saturnMaterial.dispose()
      ringGeometry.dispose()
      ringMaterial.dispose()
      moonGeometry.dispose()
      moonMaterial.dispose()
      ghostMaterial.dispose()
      for (const l of [moonAxis, twinAxis, orbit]) {
        l.geometry.dispose()
        l.material.dispose()
      }
    },
  }
}

/** frame-loop scratch, allocated once */
function createScratch() {
  return {
    serial: NaN,
    /** fractional steps owed to the next frame */
    carry: 0,
    lastDpr: 0,
    q: new Float64Array(4),
    pos: new Float64Array(2),
    quat: new THREE.Quaternion(),
    invTilt: new THREE.Quaternion(),
    cam: new THREE.Vector3(),
    view: new THREE.Vector3(),
    pole: new THREE.Vector3(),
    up: new THREE.Vector3(),
    right: new THREE.Vector3(),
  }
}

type Scratch = ReturnType<typeof createScratch>

/**
 * The twin's position in Saturn's frame: `offset` from the moon, perpendicular to the line of
 * sight, toward the ring's pole as it appears on screen (kept on the screen's upper side).
 * Within ~20° of looking down the pole that direction vanishes, so it blends to screen-right.
 */
function placeTwin(s: Scratch, tilt: THREE.Object3D, moon: THREE.Vector3, camera: THREE.Camera, offset: number, out: THREE.Vector3) {
  tilt.getWorldQuaternion(s.invTilt).invert()
  tilt.worldToLocal(s.cam.setFromMatrixPosition(camera.matrixWorld))
  const v = s.view.subVectors(moon, s.cam).normalize()
  s.up.setFromMatrixColumn(camera.matrixWorld, 1).applyQuaternion(s.invTilt)
  s.right.setFromMatrixColumn(camera.matrixWorld, 0).applyQuaternion(s.invTilt)
  // the pole (0, 1, 0) minus its component along the line of sight
  const p = s.pole.set(0, 1, 0).addScaledVector(v, -v.y)
  if (p.dot(s.up) < 0) p.negate()
  const len = p.length()
  const r = s.right.addScaledVector(v, -s.right.dot(v)).normalize()
  const w = smoothstep(0.12, 0.35, len)
  if (len > 1e-6) p.multiplyScalar(w / len)
  p.addScaledVector(r, 1 - w).normalize()
  out.copy(moon).addScaledVector(p, offset)
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function HyperionStage({ moonScale = 1, twinOffset = 0.45 }: HyperionStageProps) {
  const rig = useMemo(() => createRig(moonScale), [moonScale])
  useEffect(() => () => rig.dispose(), [rig])
  const [sim] = useState<TumbleSim>(() => createPair())
  const [scratch] = useState(createScratch)
  const live = useRef({ twinOffset })
  live.current.twinOffset = twinOffset

  const tilt = useRef<THREE.Group>(null)
  const moon = useRef<THREE.Group>(null)
  const twin = useRef<THREE.Group>(null)

  useFrame((state, delta) => {
    const tg = tilt.current
    const mg = moon.current
    const wg = twin.current
    if (!tg || !mg || !wg) return
    const s = scratch
    const h = useStore.getState().hyperion

    if (h.resetSerial !== s.serial) {
      s.serial = h.resetSerial
      resetPair(sim)
      s.carry = 0
    }
    if (h.running && h.speed > 0) {
      const owed = s.carry + (Math.max(0, delta) * h.speed * TAU) / HYPERION_DT
      let n = Math.floor(owed)
      s.carry = owed - n
      if (n > MAX_STEPS_PER_FRAME) {
        n = MAX_STEPS_PER_FRAME
        s.carry = 0
      }
      sim.advance(n)
    }

    // the orbit: dynamics plane (x, y) → Saturn's frame (x, 0, −y)
    orbitPosition(sim.t, HYPERION_ECCENTRICITY, HYPERION_ORBIT_A, s.pos)
    mg.position.set(s.pos[0], 0, -s.pos[1])
    sim.quaternion(0, s.q)
    mg.quaternion.multiplyQuaternions(DYN_TO_STAGE, s.quat.set(s.q[1], s.q[2], s.q[3], s.q[0]))

    // the twin: same orbital point, moved across the view (same depth, same apparent size)
    wg.visible = h.twin
    if (h.twin) {
      sim.quaternion(1, s.q)
      wg.quaternion.multiplyQuaternions(DYN_TO_STAGE, s.quat.set(s.q[1], s.q[2], s.q[3], s.q[0]))
      placeTwin(s, tg, mg.position, state.camera, live.current.twinOffset, wg.position)
    }

    const dpr = state.gl.getPixelRatio()
    if (dpr !== s.lastDpr) {
      s.lastDpr = dpr
      for (const m of rig.lines) setLinePixelRatio(m, dpr)
    }

    const orbits = sim.t / TAU
    worldTele.hyperionOrbits = orbits
    worldTele.hyperionDays = orbits * HYPERION_PERIOD_DAYS
    worldTele.hyperionTwinAngle = h.twin ? (sim.longAxisAngle(0, 1) * 180) / Math.PI : NaN
    mg.getWorldPosition(hyperionLive.moon)
    if (h.twin) wg.getWorldPosition(hyperionLive.twin)
    else hyperionLive.twin.copy(hyperionLive.moon)
  })

  return (
    <group>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <directionalLight position={HYPERION_SUN} intensity={SUN_INTENSITY} target={rig.lightTarget} />
      <primitive object={rig.lightTarget} />
      <group ref={tilt} rotation-x={HYPERION_TILT}>
        <mesh geometry={rig.saturnGeometry} material={rig.saturnMaterial} raycast={noRaycast} />
        <mesh geometry={rig.ringGeometry} material={rig.ringMaterial} raycast={noRaycast} renderOrder={1} />
        <primitive object={rig.orbit.line} />
        <group ref={moon}>
          <mesh geometry={rig.moonGeometry} material={rig.moonMaterial} raycast={noRaycast} />
          <primitive object={rig.moonAxis.line} />
        </group>
        <group ref={twin} visible={false}>
          <mesh geometry={rig.moonGeometry} material={rig.ghostMaterial} raycast={noRaycast} renderOrder={3} />
          <primitive object={rig.twinAxis.line} />
        </group>
      </group>
    </group>
  )
}
