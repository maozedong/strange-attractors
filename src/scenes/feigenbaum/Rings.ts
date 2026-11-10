/**
 * Small rings of light drawn round points in the scene, a constant size on screen: markers for
 * the forks of the diagram. Additive, unlit, coloured from the act's ramp.
 */
import * as THREE from 'three'
import { rampColor, type Palette } from '../../engine/palettes'

const vert = /* glsl */ `
attribute float aOn;
uniform float uPx;
varying float vOn;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aOn > 0.001 ? uPx : 0.0;
  vOn = aOn;
}
`

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPx;
varying float vOn;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p) * uPx * 0.5;          // pixels from the centre
  float r = uPx * 0.5 - 4.0;                // ring radius, pixels
  float line = exp(-pow((d - r) / 0.9, 2.0));
  float dot = exp(-pow(d / 1.1, 2.0)) * 0.9;
  float a = (line + dot) * vOn * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`

export class Rings {
  readonly object: THREE.Points
  /** 0..1 each ring */
  readonly on: Float32Array
  opacity = 1
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.ShaderMaterial
  private readonly pos: THREE.BufferAttribute
  private readonly onAttr: THREE.BufferAttribute

  constructor(count: number, palette: Palette) {
    this.on = new Float32Array(count)
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.onAttr = new THREE.BufferAttribute(this.on, 1).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('position', this.pos)
    this.geometry.setAttribute('aOn', this.onAttr)
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uColor: { value: rampColor(palette, 0.93).multiplyScalar(1.5) },
        uOpacity: { value: 1 },
        uPx: { value: 30 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    this.object = new THREE.Points(this.geometry, this.material)
    this.object.frustumCulled = false
    this.object.renderOrder = 20
  }

  set(i: number, p: THREE.Vector3) {
    const a = this.pos.array as Float32Array
    a[i * 3] = p.x
    a[i * 3 + 1] = p.y
    a[i * 3 + 2] = p.z
  }

  /** after writing positions: diameter in device pixels */
  commit(px: number) {
    this.pos.needsUpdate = true
    this.onAttr.needsUpdate = true
    this.material.uniforms.uPx.value = px
    this.material.uniforms.uOpacity.value = this.opacity
    this.object.visible = this.opacity > 0.001
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
