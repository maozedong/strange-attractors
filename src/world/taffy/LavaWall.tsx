import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { LAMP_COUNT, LAMP_TEXELS, WAX_PALETTE, lavaBlobs } from './lava'
import { lavaFrag, lavaVert } from './lavaShaders'

export interface LavaWallProps {
  /** plane width, local units */
  width: number
  /** plane height, local units */
  height: number
  /** 0..1, fades the wall towards black. Default 1 */
  opacity?: number
}

const noRaycast = () => {}

function createRig() {
  // palette in linear light (THREE.Color converts from sRGB hex)
  const waxLinear = new Float32Array(WAX_PALETTE.length * 3)
  const c = new THREE.Color()
  WAX_PALETTE.forEach((w, i) => {
    c.set(w.hex)
    waxLinear[i * 3] = c.r
    waxLinear[i * 3 + 1] = c.g
    waxLinear[i * 3 + 2] = c.b
  })
  const data = new Float32Array(LAMP_COUNT * LAMP_TEXELS * 4)
  const texture = new THREE.DataTexture(data, LAMP_TEXELS, LAMP_COUNT, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.name = 'LavaWall.lamps'
  const uniforms = {
    uLamps: { value: texture },
    uSize: { value: new THREE.Vector2(1, 1) },
    uOpacity: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({
    name: 'LavaWall',
    vertexShader: lavaVert,
    fragmentShader: lavaFrag,
    uniforms,
  })
  const geometry = new THREE.PlaneGeometry(1, 1)
  return {
    waxLinear,
    data,
    texture,
    uniforms,
    material,
    geometry,
    dispose() {
      texture.dispose()
      material.dispose()
      geometry.dispose()
    },
  }
}

/**
 * A wall of 12 × 8 lava lamps (Cloudflare's lobby wall) on a width × height plane in the local
 * XY plane, facing +Z, centred on the origin. The wax moves on the wall clock (Date.now()), the
 * same clock `lavaKey` reads, so the key the instrument shows is the wax you see. Every blob is
 * computed on the CPU each frame (288 of them, in double precision) and uploaded as a 4 × 96
 * float texture; the plane's fragment shader draws one lamp per cell from it.
 */
export function LavaWall({ width, height, opacity = 1 }: LavaWallProps) {
  const live = useRef({ width, height, opacity })
  live.current.width = width
  live.current.height = height
  live.current.opacity = opacity
  const rig = useMemo(createRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    const p = live.current
    lavaBlobs(Date.now() / 1000, rig.data, rig.waxLinear)
    rig.texture.needsUpdate = true
    rig.uniforms.uSize.value.set(p.width, p.height)
    rig.uniforms.uOpacity.value = Math.min(Math.max(p.opacity, 0), 1)
    if (meshRef.current) meshRef.current.visible = p.opacity > 0
  })

  return (
    <mesh ref={meshRef} geometry={rig.geometry} material={rig.material} scale={[width, height, 1]} raycast={noRaycast} />
  )
}
