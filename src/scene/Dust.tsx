import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'

const COUNT = 1400
const BOX = 7

const vert = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uDpr;
varying float vAlpha;
void main() {
  vec3 p = position;
  // slow drift, each mote on its own loop
  p.x += 0.12 * sin(uTime * 0.07 + aPhase * 6.2831);
  p.y += 0.08 * sin(uTime * 0.05 + aPhase * 12.566) + 0.015 * uTime * (0.5 + aPhase) ;
  p.y = mod(p.y + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
  p.z += 0.1 * cos(uTime * 0.06 + aPhase * 3.1);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uDpr * (2.5 / -mv.z);
  vAlpha = smoothstep(9.0, 2.0, -mv.z) * (0.35 + 0.65 * aPhase);
}
`
const frag = /* glsl */ `
uniform float uOpacity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.1, 0.5, d)) * vAlpha * uOpacity;
  gl_FragColor = vec4(vec3(0.94, 0.91, 0.86) * a * 0.22, 1.0);
}
`

/** Sparse motes drifting through the room: parallax when the camera orbits, nothing more. */
export function Dust() {
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uDpr: { value: 1 }, uOpacity: { value: 0 } }),
    [],
  )
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(COUNT * 3)
    const size = new Float32Array(COUNT)
    const phase = new Float32Array(COUNT)
    let seed = 12345
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (rnd() - 0.5) * BOX
      pos[i * 3 + 1] = (rnd() - 0.5) * BOX
      pos[i * 3 + 2] = (rnd() - 0.5) * BOX
      size[i] = 1.2 + rnd() * 2.2
      phase[i] = rnd()
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX)
    return g
  }, [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )
  const opacity = useRef(0)
  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime
    uniforms.uDpr.value = state.gl.getPixelRatio()
    const want = useStore.getState().stage === 'swarm' ? 1 : 0.35
    opacity.current += (want - opacity.current) * (1 - Math.exp(-dt * 2))
    uniforms.uOpacity.value = opacity.current
  })
  return <points geometry={geometry} material={material} frustumCulled={false} />
}
