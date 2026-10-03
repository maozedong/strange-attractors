import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../store'
import { worldTele } from '../telemetry'
import { createFlock, MAX_BOIDS, MAX_DT, rampHawk, spawnFlock, stepFlock } from './boids'
import { createBirdPose, writeBirdMatrices, writePose } from './orient'

/**
 * A murmuration: Reynolds's boids (./boids), ten thousand starlings and no leader.
 *
 * Driven by `flock` in the store, read every frame: `count` (clamped to 0..MAX_BOIDS) and
 * `resetSerial` respawn the flock in a ball with random headings; `running` steps it or
 * freezes it; `rules` switches one rule off; `hawk` fades a predator in (it enters at the far
 * end of its figure-eight and crosses the centre 3.5 s later) or out. Writes
 * `worldTele.flockCount` and `worldTele.flockAlignment` every frame, and `murmurationLive`.
 *
 * Drawing: one InstancedMesh of a small flat kite, each instance flying along its velocity
 * and banked into its turn (./orient). Unlit ink, brighter when the wings face the eye and
 * dim edge-on, so a turn that runs through the flock shows as a travelling shimmer. The
 * blend is a "screen" (src + dst·(1 − src)): additive where birds are sparse, saturating to
 * white where they pile up, so a dense fold glows without blowing out. The hawk is the same
 * kite, larger and opaque dark ivory, drawn first with depth so it reads as a dark shape
 * inside the bright flock.
 *
 * Local frame: the flock lives in a ball of radius ~2.2 round the origin (98 % of birds
 * within 2.0). At fov 40° a camera ~7 units from the origin has the flock fill ~70 % of the
 * frame height; ~8.6 keeps the whole ball, near side included, in frame.
 */

export interface MurmurationProps {
  /** 0..1 fade for the whole stage. Default 1 */
  opacity?: number
  /** size of every bird (and the hawk) relative to a 0.035-long starling. Default 1 */
  birdScale?: number
}

/** Live flock numbers for cameras and narration, in the stage's local frame. */
export const murmurationLive = {
  /** mean bird position */
  centroid: new THREE.Vector3(),
  /** where the hawk is, and how present (0 = gone, 1 = fully in) */
  hawk: new THREE.Vector3(),
  hawkPresence: 0,
}

const INK = '#efe8dc'
/** dark ivory: a dim version of the ink */
const HAWK_INK = '#80796d'

/** the kite: nose to tail, wingtip to wingtip, render units */
const BIRD_LENGTH = 0.035
const BIRD_SPAN = 0.03
/** wingtips raised a few degrees and swept back a little, like a gliding starling */
const DIHEDRAL = (7 * Math.PI) / 180
const SWEEP = 0.003
const HAWK_SCALE = 1.7

/** screen-blend strength of one bird seen face-on */
const GAIN = 0.55
/** brightness of a bird seen exactly edge-on, relative to face-on */
const EDGE_ON = 0.18
const HAWK_EDGE_ON = 0.55

const noRaycast = () => {}

/**
 * A flat kite of 4 triangles fanned round the crossing of its spars, nose along +Z, wings
 * along ±X, up +Y. Non-indexed, so each triangle carries its own face normal.
 */
function buildKite(): THREE.BufferGeometry {
  const front = BIRD_LENGTH * 0.38
  const back = BIRD_LENGTH - front
  const cross = -SWEEP
  const h = (BIRD_SPAN / 2) * Math.tan(DIHEDRAL)
  const N = [0, 0, front]
  const T = [0, 0, -back]
  const L = [-BIRD_SPAN / 2, h, cross]
  const R = [BIRD_SPAN / 2, h, cross]
  const O = [0, 0, cross]
  // counter-clockwise seen from above (+Y)
  const tris = [O, N, R, O, R, T, O, T, L, O, L, N]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3))
  geometry.computeVertexNormals()
  return geometry
}

const birdVert = /* glsl */ `
uniform float uEdgeOn;
varying float vShade;
void main() {
#ifdef USE_INSTANCING
  mat4 local = instanceMatrix;
#else
  mat4 local = mat4(1.0);
#endif
  vec4 mv = modelViewMatrix * local * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * (mat3(local) * normal));
  vec3 toEye = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
  // the wing's angle to the eye: face-on bright, edge-on dim (either side, the kite is flat)
  vShade = mix(uEdgeOn, 1.0, abs(dot(n, toEye)));
  gl_Position = projectionMatrix * mv;
}
`

const birdFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
uniform float uOpacity;
varying float vShade;
void main() {
#ifdef OPAQUE_BIRD
  gl_FragColor = vec4(uColor * vShade, uOpacity);
#else
  gl_FragColor = vec4(uColor * (vShade * uGain * uOpacity), 1.0);
#endif
}
`

function createRig() {
  const geometry = buildKite()
  const flockMaterial = new THREE.ShaderMaterial({
    name: 'Murmuration.birds',
    vertexShader: birdVert,
    fragmentShader: birdFrag,
    uniforms: {
      uColor: { value: new THREE.Color(INK) },
      uGain: { value: GAIN },
      uOpacity: { value: 1 },
      uEdgeOn: { value: EDGE_ON },
    },
    side: THREE.DoubleSide,
    // the blend does not care about order, so skip three's back-then-front double pass
    forceSinglePass: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // screen: src + dst·(1 − src)
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })
  const hawkMaterial = new THREE.ShaderMaterial({
    name: 'Murmuration.hawk',
    vertexShader: birdVert,
    fragmentShader: birdFrag,
    defines: { OPAQUE_BIRD: '' },
    uniforms: {
      uColor: { value: new THREE.Color(HAWK_INK) },
      uGain: { value: 1 },
      uOpacity: { value: 1 },
      uEdgeOn: { value: HAWK_EDGE_ON },
    },
    side: THREE.DoubleSide,
    forceSinglePass: true,
    // transparent only so the stage can fade; it still writes depth and hides birds behind it
    transparent: true,
    depthWrite: true,
    depthTest: true,
  })

  const birds = new THREE.InstancedMesh(geometry, flockMaterial, MAX_BOIDS)
  birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  birds.count = 0
  birds.frustumCulled = false
  birds.raycast = noRaycast
  birds.renderOrder = 2

  const hawk = new THREE.Mesh(geometry, hawkMaterial)
  hawk.matrixAutoUpdate = false
  hawk.frustumCulled = false
  hawk.raycast = noRaycast
  hawk.renderOrder = 1
  hawk.visible = false

  return {
    birds,
    hawk,
    flockMaterial,
    hawkMaterial,
    /** reused every frame: upload only the live instances */
    range: { start: 0, count: 0 },
    dispose() {
      birds.dispose()
      geometry.dispose()
      flockMaterial.dispose()
      hawkMaterial.dispose()
    },
  }
}

function createSim() {
  const { flock: fs } = useStore.getState()
  const flock = createFlock(MAX_BOIDS, (Math.random() * 0x7fffffff) | 1)
  spawnFlock(flock, fs.count)
  return {
    flock,
    pose: createBirdPose(MAX_BOIDS),
    serial: fs.resetSerial,
    /** the instance matrices are stale (respawn, new scale) even if the flock is paused */
    dirty: true,
    scale: 1,
  }
}

export function Murmuration({ opacity = 1, birdScale = 1 }: MurmurationProps) {
  // latest props for the frame loop, which must not restart when they change
  const live = useRef({ opacity, birdScale })
  live.current.opacity = opacity
  live.current.birdScale = birdScale
  const group = useRef<THREE.Group>(null)
  const rig = useMemo(createRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  const [sim] = useState(createSim)

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const fs = useStore.getState().flock
    const f = sim.flock
    const dt = Math.min(Math.max(delta, 0), MAX_DT)

    const want = Math.max(0, Math.min(MAX_BOIDS, Math.floor(Number.isFinite(fs.count) ? fs.count : 0)))
    if (want !== f.n || fs.resetSerial !== sim.serial) {
      spawnFlock(f, want)
      sim.serial = fs.resetSerial
      sim.dirty = true
    }
    if (fs.running) stepFlock(f, dt, fs.rules, fs.hawk)
    else rampHawk(f, dt, fs.hawk)

    const scale = Number.isFinite(live.current.birdScale) ? Math.max(0, live.current.birdScale) : 1
    if (scale !== sim.scale) {
      sim.scale = scale
      sim.dirty = true
    }
    if (fs.running || sim.dirty) {
      const attr = rig.birds.instanceMatrix
      writeBirdMatrices(f, sim.pose, attr.array as Float32Array, fs.running ? dt : 0, scale)
      rig.range.count = f.n * 16
      attr.updateRanges.length = 0
      attr.updateRanges.push(rig.range)
      attr.needsUpdate = true
      sim.dirty = false
    }
    rig.birds.count = f.n

    // the hawk: same kite, grown in and out with its presence, banked along its path
    const h = f.hawk
    const p = f.hawkPresence
    const grow = p * p * (3 - 2 * p)
    rig.hawk.visible = grow > 0.001
    if (rig.hawk.visible) {
      writePose(rig.hawk.matrix.elements, 0, h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8], HAWK_SCALE * scale * grow)
      rig.hawk.matrixWorldNeedsUpdate = true
    }

    worldTele.flockCount = f.n
    worldTele.flockAlignment = f.alignment
    murmurationLive.centroid.set(f.centroid[0], f.centroid[1], f.centroid[2])
    murmurationLive.hawk.set(h[0], h[1], h[2])
    murmurationLive.hawkPresence = p

    const fade = Math.max(0, Math.min(1, live.current.opacity))
    rig.flockMaterial.uniforms.uOpacity.value = fade
    rig.hawkMaterial.uniforms.uOpacity.value = fade
    g.visible = fade > 0.001
  })

  return (
    <group ref={group}>
      <primitive object={rig.hawk} />
      <primitive object={rig.birds} />
    </group>
  )
}
