import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import { getSystem } from '../systems'

const MAX = 4

/**
 * Small camera-facing rings at the system's equilibria ("still points"), drawn in the
 * same frame as the swarm. Fades in and out with the store flag.
 */
export function FixedPoints() {
  const group = useRef<THREE.Group>(null)
  const meshes = useRef<THREE.Mesh[]>([])
  const mats = useMemo(
    () =>
      Array.from({ length: MAX }, () =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color('#efe8dc'),
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
    [],
  )
  const ring = useMemo(() => new THREE.RingGeometry(0.028, 0.034, 48), [])
  const dot = useMemo(() => new THREE.CircleGeometry(0.006, 24), [])
  const opacity = useRef(0)
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera }, dt) => {
    const { showFixedPoints, systemId, params, swarmVisible } = useStore.getState()
    const sys = getSystem(systemId)
    const pts = sys.fixedPoints?.(params) ?? []
    const want = showFixedPoints && swarmVisible && pts.length > 0 ? 1 : 0
    opacity.current += (want - opacity.current) * (1 - Math.exp(-dt * 5))
    const frame = sys.frame(params)
    if (!group.current) return
    group.current.visible = opacity.current > 0.01
    for (let i = 0; i < MAX; i++) {
      const m = meshes.current[i]
      if (!m) continue
      const p = pts[i]
      if (!p) {
        m.visible = false
        continue
      }
      m.visible = true
      // system z is up: (x, y, z) → (x, z, -y)
      tmp.set((p[0] - frame.center[0]) * frame.scale, (p[2] - frame.center[2]) * frame.scale, -(p[1] - frame.center[1]) * frame.scale)
      m.position.copy(tmp)
      m.quaternion.copy(camera.quaternion)
      const dist = camera.position.distanceTo(tmp)
      m.scale.setScalar(dist / 3)
      mats[i].opacity = opacity.current * 0.9
    }
  })

  return (
    <group ref={group}>
      {Array.from({ length: MAX }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) meshes.current[i] = el
          }}
          material={mats[i]}
          renderOrder={10}
        >
          <primitive object={ring} attach="geometry" />
          <mesh geometry={dot} material={mats[i]} />
        </mesh>
      ))}
    </group>
  )
}
