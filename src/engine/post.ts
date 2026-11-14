/**
 * The lens and the film stock. Everything is rendered into a half-float buffer, so light adds up
 * past white; two blooms (a tight one for sparkle, a very wide faint one for halation) spread it,
 * a filmic curve brings it back into range, and a last pass adds vignette, a trace of colour
 * fringing at the edges of the frame, and the dither that keeps dark gradients smooth.
 */
import * as THREE from 'three'
import { BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, BlendFunction } from 'postprocessing'

const filmFrag = /* glsl */ `
uniform float uVignette;
uniform float uGrain;
uniform float uFringe;
uniform float uFade;

float rnd(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainUv(inout vec2 uv) {}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec3 col = inputColor.rgb;

  // a trace of lateral colour toward the corners
  if (uFringe > 0.0) {
    vec2 off = c * r2 * uFringe;
    col.r = texture2D(inputBuffer, uv + off).r;
    col.b = texture2D(inputBuffer, uv - off).b;
  }

  col *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2 * (1.0 + 0.35 * abs(c.x)));

  col *= uFade;

  // The last thing before eight bits: a dither one display step wide, so the dark gradients of
  // the room do not band. It is added to the encoded value, not to the light: noise added in
  // linear light is magnified a dozen times in the shadows, and this film is mostly shadow.
  vec2 px = uv * resolution + fract(time) * 917.0;
  float n = rnd(px) + rnd(px + 71.7) - 1.0;
  vec3 enc = pow(max(col, 0.0), vec3(1.0 / 2.2)) + n * uGrain / 255.0;
  col = pow(max(enc, 0.0), vec3(2.2));

  outputColor = vec4(col, inputColor.a);
}
`

class FilmEffect extends Effect {
  constructor() {
    super('FilmEffect', filmFrag, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['uVignette', new THREE.Uniform(0.62)],
        ['uGrain', new THREE.Uniform(1)],
        ['uFringe', new THREE.Uniform(0.012)],
        ['uFade', new THREE.Uniform(1)],
      ]),
    })
  }
}

export class Post {
  readonly composer: EffectComposer
  readonly bloom: BloomEffect
  readonly halo: BloomEffect
  readonly mist: BloomEffect
  readonly tone: ToneMappingEffect
  readonly film: FilmEffect

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 })
    this.composer.addPass(new RenderPass(scene, camera))
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.62, luminanceSmoothing: 0.35, intensity: 0.85, radius: 0.72 })
    this.halo = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.1, luminanceSmoothing: 0.5, intensity: 0.22, radius: 0.98, levels: 9 })
    this.mist = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0, luminanceSmoothing: 0, intensity: 0.7, radius: 0.35, levels: 4 })
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
    this.film = new FilmEffect()
    this.composer.addPass(new EffectPass(camera, this.mist, this.bloom, this.halo))
    this.composer.addPass(new EffectPass(camera, this.tone, this.film))
  }

  /** 0 = black, 1 = full picture: used for fades to and from black */
  set fade(v: number) {
    this.film.uniforms.get('uFade')!.value = v
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height)
  }

  render(dt: number) {
    this.composer.render(dt)
  }

  dispose() {
    this.composer.dispose()
  }
}
