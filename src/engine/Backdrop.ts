/**
 * The room the dust lives in. Not black: a night sky gradient in the act's colours, a band of
 * glow along the horizon, slow fog drifting through it, and a pool of light on the floor under
 * the subject. It is drawn from the camera's view rays, so it turns with the camera and gives
 * the eye a sense of how big the space is.
 *
 * Nothing in it is finer than a hand's width, so it is drawn small (a quarter of the canvas on
 * each side, a sixteenth of the pixels) into a half-float target and stretched over the screen
 * with the GPU's bilinear filter. The fog's per-pixel noise was the cost; stretched, the picture
 * is the same to the eye, and the dither at the end of the post chain still breaks up any bands.
 */
import * as THREE from 'three'
import type { Palette } from './palettes'

const vert = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

const frag = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform float uTime;
uniform float uFloorY;
uniform float uFloor;
uniform float uLevel;
varying vec2 vNdc;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec4 v = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);

  // sky: darkest overhead, a narrow band of light along the horizon
  float band = exp(-abs(dir.y) * 9.0);
  float wide = exp(-abs(dir.y) * 2.6);
  vec3 col = uSky * (0.35 + 0.65 * wide);
  col += uHorizon * (band * 0.9 + wide * 0.22);

  // fog: two slow layers sliding against each other, thickest near the horizon
  float t = uTime * 0.014;
  float n = fbm(dir * vec3(1.6, 3.2, 1.6) + vec3(t, t * 0.4, -t * 0.7));
  float m = fbm(dir * 4.3 - vec3(t * 0.6, 0.0, t));
  float fog = smoothstep(0.38, 0.8, n) * (0.4 + 0.6 * m);
  col += uFog * fog * (0.1 + 0.9 * wide) * 0.8;

  // floor: a pool of light under the subject, fading with distance
  if (dir.y < -0.002) {
    float hitT = (uFloorY - uCamPos.y) / dir.y;
    vec3 hit = uCamPos + dir * hitT;
    float r2 = dot(hit.xz, hit.xz);
    float pool = exp(-r2 * 0.11);
    col = mix(col, col * 0.55 + uHorizon * pool * 0.9, uFloor * smoothstep(0.0, 0.06, -dir.y));
  }

  gl_FragColor = vec4(col * uLevel * 5.0, 1.0);
}
`

const stretchFrag = /* glsl */ `
uniform sampler2D uRoom;
varying vec2 vNdc;
void main() {
  gl_FragColor = texture2D(uRoom, vNdc * 0.5 + 0.5);
}
`

/** canvas pixels per side for one pixel of the small room */
const SHRINK = 4

export class Backdrop {
  /** what the scene draws: the small room stretched over the screen */
  readonly mesh: THREE.Mesh
  private readonly room: THREE.Mesh
  private readonly roomScene = new THREE.Scene()
  private readonly roomCamera = new THREE.Camera()
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
  private readonly bufferSize = new THREE.Vector2()
  /** 0..1: how much the floor shows */
  floor = 1
  floorY = -1.25
  /** overall brightness; scenes with bright props can turn the room down */
  level = 1
  private readonly uniforms
  private readonly sky = new THREE.Color()
  private readonly horizon = new THREE.Color()
  private readonly fog = new THREE.Color()
  private palette: Palette
  private floorNow = 1
  private levelNow = 1

  constructor(palette: Palette) {
    this.palette = palette
    this.sky.copy(palette.sky)
    this.horizon.copy(palette.horizon)
    this.fog.copy(palette.fog)
    this.uniforms = {
      uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSky: { value: this.sky },
      uHorizon: { value: this.horizon },
      uFog: { value: this.fog },
      uTime: { value: 0 },
      uFloorY: { value: -1.25 },
      uFloor: { value: 1 },
      uLevel: { value: 1 },
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    this.room = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, depthTest: false, depthWrite: false }),
    )
    this.room.frustumCulled = false
    this.roomScene.add(this.room)
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: stretchFrag,
        uniforms: { uRoom: { value: this.target.texture } },
        depthTest: false,
        depthWrite: false,
      }),
    )
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1000
  }

  /** cross-fade to another act's colours */
  setPalette(palette: Palette) {
    this.palette = palette
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera) {
    const k = 1 - Math.exp(-dt * 0.9)
    this.sky.lerp(this.palette.sky, k)
    this.horizon.lerp(this.palette.horizon, k)
    this.fog.lerp(this.palette.fog, k)
    const kf = 1 - Math.exp(-dt * 1.6)
    this.floorNow += (this.floor - this.floorNow) * kf
    this.levelNow += (this.level - this.levelNow) * kf
    const u = this.uniforms
    u.uProjInv.value.copy(camera.projectionMatrixInverse)
    u.uCamWorld.value.copy(camera.matrixWorld)
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld)
    u.uTime.value = time
    u.uFloorY.value = this.floorY
    u.uFloor.value = this.floorNow
    u.uLevel.value = this.levelNow
  }

  /** draw the small room; call after `update` and before the scene is rendered */
  render(renderer: THREE.WebGLRenderer) {
    if (!this.mesh.visible) return
    renderer.getDrawingBufferSize(this.bufferSize)
    const w = Math.max(1, Math.ceil(this.bufferSize.x / SHRINK))
    const h = Math.max(1, Math.ceil(this.bufferSize.y / SHRINK))
    if (w !== this.target.width || h !== this.target.height) this.target.setSize(w, h)
    const before = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.render(this.roomScene, this.roomCamera)
    renderer.setRenderTarget(before)
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    ;(this.room.material as THREE.Material).dispose()
    this.target.dispose()
  }
}
