/**
 * The Julia set of c as dust. Every particle runs the map backwards: z ← ±√(z − c), choosing
 * the sign at random, a few times a frame. Run backwards the Julia set attracts instead of
 * repels, so wherever a particle starts it is drawn onto the set within a handful of steps, and
 * the whole dust settles on it. Change c and the dust flows to the new set; push c out of the
 * Mandelbrot set and the set, and the dust with it, falls apart into a cloud of points.
 *
 * Source space: x = Re z, y = a small height above the plane (fixed per particle), z = −Im z,
 * so with an identity matrix the set lies in the world's xz-plane facing up. Aux (w) is 0..1:
 * how far out the particle's last step put it, for a little tonal variety.
 */
import * as THREE from 'three'
import type { DustSource } from '../../engine/Dust'
import { floatTarget } from '../../engine/sources'

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const frag = /* glsl */ `
uniform sampler2D uState;
uniform vec2 uC;
uniform float uSeed;
uniform float uLift;
uniform float uReset;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 csqrt(vec2 z) {
  float r = length(z);
  float x = sqrt(max(0.0, 0.5 * (r + z.x)));
  float y = sqrt(max(0.0, 0.5 * (r - z.x)));
  return vec2(x, z.y < 0.0 ? -y : y);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec4 s = texture2D(uState, vUv);
  vec2 z = vec2(s.x, -s.z);
  if (uReset > 0.5 || !(dot(z, z) < 16.0)) z = (vec2(hash12(cell + 1.7), hash12(cell + 9.1)) - 0.5) * 3.0;
  for (int i = 0; i < 6; i++) {
    z = csqrt(z - uC);
    if (hash12(cell + uSeed * 1.37 + float(i) * 17.3) < 0.5) z = -z;
  }
  float h = pow(hash12(cell + 3.3), 5.0) * uLift;
  gl_FragColor = vec4(z.x, h, -z.y, clamp(length(z) / 1.6, 0.0, 1.0));
}
`

export class JuliaDust implements DustSource {
  readonly prevTexture = null
  readonly matrix = new THREE.Matrix4()
  /** the constant */
  readonly c = new THREE.Vector2(-0.123, 0.745)
  /** height of the haze above the plane, source units */
  lift = 0.05

  private readonly renderer: THREE.WebGLRenderer
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private frame = 0
  private reset = 1

  constructor(renderer: THREE.WebGLRenderer, size: number) {
    this.renderer = renderer
    this.read = floatTarget(size)
    this.write = floatTarget(size)
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uState: { value: null },
        uC: { value: this.c },
        uSeed: { value: 0 },
        uLift: { value: this.lift },
        uReset: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
    for (let i = 0; i < 8; i++) this.step()
  }

  get texture() {
    return this.read.texture
  }

  update(dt: number) {
    if (dt <= 0) return
    this.step()
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
    this.material.dispose()
    ;(this.scene.children[0] as THREE.Mesh).geometry.dispose()
  }

  private step() {
    const r = this.renderer
    const u = this.material.uniforms
    u.uState.value = this.read.texture
    u.uSeed.value = (this.frame++ % 997) + 0.5
    u.uLift.value = this.lift
    u.uReset.value = this.reset
    this.reset = 0
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(this.write)
    r.render(this.scene, this.camera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
    const t = this.read
    this.read = this.write
    this.write = t
  }
}
