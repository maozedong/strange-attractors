import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  type Color,
} from 'three'

/** Head diameter in CSS pixels; multiplied by the device pixel ratio because gl_PointSize is in framebuffer pixels */
const HEAD_PX = 10

const vertexShader = /* glsl */ `
uniform float uSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`

const fragmentShader = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float a = 1.0 - r;
  a *= a;                                      // soft halo, zero at the rim
  float core = 1.0 - smoothstep(0.0, 0.3, r);  // small bright centre
  gl_FragColor = vec4(vColor * (a * 0.6 + core * 1.2), 1.0);
  #include <colorspace_fragment>
}
`

/** One additive glowing point per trajectory, drawn on top of everything. */
export class HeadPoints {
  readonly points: Points<BufferGeometry, ShaderMaterial>
  private readonly position: BufferAttribute
  private readonly color: BufferAttribute

  constructor(max: number) {
    const geometry = new BufferGeometry()
    this.position = new BufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage)
    this.color = new BufferAttribute(new Float32Array(max * 3), 3)
    geometry.setAttribute('position', this.position)
    geometry.setAttribute('aColor', this.color)
    geometry.setDrawRange(0, 0)

    const material = new ShaderMaterial({
      uniforms: { uSize: { value: HEAD_PX } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    })

    this.points = new Points(geometry, material)
    this.points.frustumCulled = false
    this.points.renderOrder = 1
    this.points.visible = false
  }

  setCount(n: number): void {
    this.points.geometry.setDrawRange(0, n)
    this.points.visible = n > 0
  }

  setPosition(i: number, x: number, y: number, z: number): void {
    const a = this.position.array
    a[i * 3] = x
    a[i * 3 + 1] = y
    a[i * 3 + 2] = z
    this.position.needsUpdate = true
  }

  setColor(i: number, c: Color): void {
    const a = this.color.array
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
    this.color.needsUpdate = true
  }

  setPixelRatio(dpr: number): void {
    this.points.material.uniforms.uSize.value = HEAD_PX * dpr
  }

  dispose(): void {
    this.points.geometry.dispose()
    this.points.material.dispose()
  }
}
