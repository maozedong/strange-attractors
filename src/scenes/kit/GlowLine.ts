/**
 * A thin glowing line in the world, drawn on from one end like a pen stroke: a flat ribbon of
 * fixed world width, lying in the plane its `normal` names (a mark on the floor, or a hairline
 * facing the camera). Colour comes from the act's ramp; values above 1 bloom.
 */
import * as THREE from 'three'

const vert = /* glsl */ `
attribute float along;
varying float vAlong;
varying float vSide;
void main() {
  vAlong = along;
  vSide = uv.y * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uDraw;     // 0..1 of the length drawn
uniform float uOpacity;
uniform float uHead;     // brightness of the moving pen tip
varying float vAlong;
varying float vSide;
void main() {
  float drawn = 1.0 - smoothstep(uDraw - 0.015, uDraw, vAlong);
  if (drawn <= 0.0) discard;
  float across = 1.0 - vSide * vSide;
  float tip = exp(-pow((uDraw - vAlong) * 40.0, 2.0)) * uHead * step(uDraw, 0.999);
  gl_FragColor = vec4(uColor * (across * drawn * uOpacity * (1.0 + tip)), 1.0);
}
`

export class GlowLine {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial
  private readonly geometry: THREE.BufferGeometry

  /**
   * @param points the path, world units
   * @param width ribbon width, world units
   * @param normal the ribbon lies across this direction (up for a mark on the floor; toward the camera for a hairline)
   */
  constructor(points: THREE.Vector3[], width: number, color: THREE.Color, normal = new THREE.Vector3(0, 1, 0)) {
    const n = points.length
    const pos = new Float32Array(n * 2 * 3)
    const along = new Float32Array(n * 2)
    const uv = new Float32Array(n * 2 * 2)
    let total = 0
    const lengths = [0]
    for (let i = 1; i < n; i++) {
      total += points[i].distanceTo(points[i - 1])
      lengths.push(total)
    }
    const t = new THREE.Vector3()
    const side = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)]
      const b = points[Math.min(n - 1, i + 1)]
      t.subVectors(b, a).normalize()
      side.crossVectors(t, normal).normalize().multiplyScalar(width / 2)
      const p = points[i]
      pos.set([p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z], i * 6)
      const u = total > 0 ? lengths[i] / total : 0
      along[i * 2] = u
      along[i * 2 + 1] = u
      uv.set([u, 0, u, 1], i * 4)
    }
    const index: number[] = []
    for (let i = 0; i < n - 1; i++) {
      const k = i * 2
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.geometry.setAttribute('along', new THREE.BufferAttribute(along, 1))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    this.geometry.setIndex(index)
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uColor: { value: color.clone() },
        uDraw: { value: 0 },
        uOpacity: { value: 1 },
        uHead: { value: 1.5 },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.renderOrder = 8
    this.mesh.frustumCulled = false
  }

  get draw() {
    return this.material.uniforms.uDraw.value as number
  }
  set draw(v: number) {
    this.material.uniforms.uDraw.value = v
  }
  get opacity() {
    return this.material.uniforms.uOpacity.value as number
  }
  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v
    this.mesh.visible = v > 0.001
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
