/**
 * The lens and the film stock. Everything is rendered into a half-float buffer, so light adds up
 * past white; three glows spread it (a tight light "mist" over everything, a thresholded bloom for
 * sparkle, a very wide faint halo for halation), a filmic curve brings it back into range, and the
 * same pass adds vignette, a trace of colour fringing at the edges of the frame, and the dither
 * that keeps dark gradients smooth.
 *
 * The glows are the mipmap blur of the `postprocessing` library (a 13-tap downsample chain, then a
 * 9-tap upsample chain that mixes each level back into the one above), written out here so the
 * frame needs only two full-resolution passes after the scene: one that reads the scene once and
 * writes the first, half-resolution level of all three glows (each thresholded as the library's
 * luminance pass would, texel by texel, before the filter), and the last one, which composites,
 * tone maps and finishes straight to the canvas. The library instead spends a full-resolution
 * copy per glow, a full-resolution read per glow, and a full-resolution buffer between the glows
 * and the tone curve.
 */
import * as THREE from 'three'

const fullscreenVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

// The first level of the three glows. Each of the 13 taps of the downsample filter is a bilinear
// sample of the scene; the threshold has to apply to the texels under it, not to their blend, or
// a bright grain next to a dark one would be cut by the average instead of passing whole. So the
// bilinear filter is done by hand: four fetches, each masked, then weighted.
//
// When the scene is exactly twice the size of the level (the usual case), every tap falls on a
// corner between four texels, and the 13 taps together weigh a 6×6 block of texels: the outer
// ring at 0.05556 / 4, the inner 4×4 at (0.05556 + 0.125) / 4. Away from the border, that block
// is read once, 36 fetches instead of 52.
const prefilterFrag = /* glsl */ `
#include <common>
uniform highp sampler2D tScene;
uniform vec2 texelSize;
uniform vec2 sceneSize;
uniform vec2 sparkle;   // threshold, threshold + smoothing
uniform vec2 halo;
in vec2 vUv;
// the halo goes to the first output, the sparkle to the second, the mist to the third
layout(location = 1) out highp vec4 outSparkle;
layout(location = 2) out highp vec4 outMist;

vec4 acc0, acc1, acc2;

void texel(ivec2 p, float w) {
  vec4 t = texelFetch(tScene, p, 0);
  float l = luminance(t.rgb);
  acc0 += w * t;
  acc1 += (w * smoothstep(sparkle.x, sparkle.y, l)) * t;
  acc2 += (w * smoothstep(halo.x, halo.y, l)) * t;
}

void tap(vec2 offset, float weight) {
  vec2 uv = vUv + texelSize * offset;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;
  vec2 p = uv * sceneSize - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 hi = ivec2(sceneSize) - 1;
  ivec2 a = clamp(ivec2(i), ivec2(0), hi);
  ivec2 b = clamp(ivec2(i) + 1, ivec2(0), hi);
  texel(a, weight * (1.0 - f.x) * (1.0 - f.y));
  texel(ivec2(b.x, a.y), weight * f.x * (1.0 - f.y));
  texel(ivec2(a.x, b.y), weight * (1.0 - f.x) * f.y);
  texel(b, weight * f.x * f.y);
}

void main() {
  acc0 = vec4(0.0); acc1 = vec4(0.0); acc2 = vec4(0.0);
#ifdef ALIGNED
  ivec2 k = ivec2(gl_FragCoord.xy);
  ivec2 last = ivec2(sceneSize) / 2 - 2;
  if (k.x >= 1 && k.y >= 1 && k.x <= last.x && k.y <= last.y) {
    ivec2 base = 2 * k - 2;
    for (int y = 0; y < 6; y++) {
      for (int x = 0; x < 6; x++) {
        bool ring = x == 0 || y == 0 || x == 5 || y == 5;
        texel(base + ivec2(x, y), ring ? 0.01389 : 0.04514);
      }
    }
    gl_FragColor = acc2;
    outSparkle = acc1;
    outMist = acc0;
    return;
  }
#endif
  const float inner = 0.125;
  const float outer = 0.05556;
  tap(vec2(-1.0, 1.0), inner);
  tap(vec2(1.0, 1.0), inner);
  tap(vec2(-1.0, -1.0), inner);
  tap(vec2(1.0, -1.0), inner);
  tap(vec2(-2.0, 2.0), outer);
  tap(vec2(0.0, 2.0), outer);
  tap(vec2(2.0, 2.0), outer);
  tap(vec2(-2.0, 0.0), outer);
  tap(vec2(2.0, 0.0), outer);
  tap(vec2(-2.0, -2.0), outer);
  tap(vec2(0.0, -2.0), outer);
  tap(vec2(2.0, -2.0), outer);
  tap(vec2(0.0, 0.0), outer);
  gl_FragColor = acc2;
  outSparkle = acc1;
  outMist = acc0;
}
`

// The glows share their levels: one draw per level computes the same level of every glow that goes
// that deep (COUNT of them), each into its own output.
const outputs = /* glsl */ `
#if COUNT > 1
layout(location = 1) out highp vec4 out1;
#endif
#if COUNT > 2
layout(location = 2) out highp vec4 out2;
#endif
`

const downFrag = /* glsl */ `
uniform highp sampler2D in0;
uniform highp sampler2D in1;
uniform highp sampler2D in2;
uniform vec2 texelSize;
in vec2 vUv;
${outputs}

float inside(vec2 uv) {
  return float(uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0);
}
vec4 tap(highp sampler2D s, vec2 offset) {
  vec2 uv = vUv + texelSize * offset;
  return inside(uv) * texture(s, uv);
}
vec4 down(highp sampler2D s) {
  vec4 c = 0.125 * (tap(s, vec2(-1.0, 1.0)) + tap(s, vec2(1.0, 1.0)) + tap(s, vec2(-1.0, -1.0)) + tap(s, vec2(1.0, -1.0)));
  c += 0.05556 * (tap(s, vec2(-2.0, 2.0)) + tap(s, vec2(0.0, 2.0)) + tap(s, vec2(2.0, 2.0)) + tap(s, vec2(-2.0, 0.0)));
  c += 0.05556 * (tap(s, vec2(2.0, 0.0)) + tap(s, vec2(-2.0, -2.0)) + tap(s, vec2(0.0, -2.0)) + tap(s, vec2(2.0, -2.0)));
  c += 0.05556 * texture(s, vUv);
  return c;
}

void main() {
  gl_FragColor = down(in0);
#if COUNT > 1
  out1 = down(in1);
#endif
#if COUNT > 2
  out2 = down(in2);
#endif
}
`

const upFrag = /* glsl */ `
uniform highp sampler2D in0;
uniform highp sampler2D in1;
uniform highp sampler2D in2;
uniform highp sampler2D support0;
uniform highp sampler2D support1;
uniform highp sampler2D support2;
uniform vec2 texelSize;
uniform vec3 radius;
in vec2 vUv;
${outputs}

vec4 tap(highp sampler2D s, float x, float y) {
  return texture(s, vUv + texelSize * vec2(x, y));
}
vec4 up(highp sampler2D s, highp sampler2D support, float r) {
  vec4 c = 0.0625 * (tap(s, -1.0, 1.0) + tap(s, 1.0, 1.0) + tap(s, -1.0, -1.0) + tap(s, 1.0, -1.0));
  c += 0.125 * (tap(s, 0.0, 1.0) + tap(s, -1.0, 0.0) + tap(s, 1.0, 0.0) + tap(s, 0.0, -1.0));
  c += 0.25 * texture(s, vUv);
  return mix(texture(support, vUv), c, r);
}

void main() {
  gl_FragColor = up(in0, support0, radius.x);
#if COUNT > 1
  out1 = up(in1, support1, radius.y);
#endif
#if COUNT > 2
  out2 = up(in2, support2, radius.z);
#endif
}
`

const finishFrag = /* glsl */ `
#include <common>
#include <tonemapping_pars_fragment>
uniform highp sampler2D tScene;
uniform highp sampler2D tMist;
uniform highp sampler2D tBloom;
uniform highp sampler2D tHalo;
uniform vec3 intensity;   // mist, bloom, halo
uniform vec2 resolution;
uniform float time;
uniform float uVignette;
uniform float uGrain;
uniform float uFringe;
uniform float uFade;
in vec2 vUv;

// each glow is laid over the picture with a screen blend
vec3 screen(vec3 dst, vec3 src) {
  return dst + src - min(dst * src, 1.0);
}

vec3 lit(vec2 uv) {
  vec3 c = texture(tScene, uv).rgb;
  c = screen(c, texture(tMist, uv).rgb * intensity.x);
  c = screen(c, texture(tBloom, uv).rgb * intensity.y);
  c = screen(c, texture(tHalo, uv).rgb * intensity.z);
  return c;
}

float rnd(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec3 col = ACESFilmicToneMapping(lit(uv));

  // A trace of lateral colour toward the corners. The red and blue it takes are the light before
  // the tone curve, as they always have been in this film's look.
  if (uFringe > 0.0) {
    vec2 off = c * r2 * uFringe;
    col.r = lit(uv + off).r;
    col.b = lit(uv - off).b;
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

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVert,
    // GLSL 3 shaders declare their own outputs; the first one keeps three's name
    fragmentShader: 'layout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n' + fragmentShader,
    uniforms,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

const glowTarget = (count: number) =>
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, count })

/** one glow: how strong, how wide (the upsample mix), how many levels down it goes */
export class Glow {
  intensity: number
  readonly radius: number
  readonly levels: number

  constructor(intensity: number, radius: number, levels: number) {
    this.intensity = intensity
    this.radius = radius
    this.levels = levels
  }
}

/** the uniforms the video renderer reaches for (`film.uniforms.get('uGrain')`) */
class Film {
  readonly uniforms = new Map<string, THREE.Uniform>([
    ['uVignette', new THREE.Uniform(0.62)],
    ['uGrain', new THREE.Uniform(1)],
    ['uFringe', new THREE.Uniform(0.012)],
    ['uFade', new THREE.Uniform(1)],
  ])
}

export class Post {
  readonly bloom = new Glow(0.85, 0.72, 8)
  readonly halo = new Glow(0.22, 0.98, 9)
  readonly mist = new Glow(0.7, 0.35, 4)
  readonly film = new Film()

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.Camera
  private readonly sceneTarget: THREE.WebGLRenderTarget
  /** the glows, deepest first: the order of the outputs of every level */
  private readonly glows: Glow[]
  /** down[0] is the first level, written from the scene; down[i] is half the size of down[i - 1] */
  private readonly down: THREE.WebGLRenderTarget[] = []
  /** up[i] has the size of down[i]; up[0] holds the finished glows */
  private readonly up: THREE.WebGLRenderTarget[] = []
  /** the texel size of each level */
  private readonly texel: THREE.Vector2[] = []
  private readonly quad: THREE.Mesh
  private readonly quadScene = new THREE.Scene()
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly prefilter: THREE.ShaderMaterial
  /** for one, two and three glows at a level */
  private readonly downMaterials: THREE.ShaderMaterial[] = []
  private readonly upMaterials: THREE.ShaderMaterial[] = []
  private readonly finish: THREE.ShaderMaterial
  private readonly sceneTexel = new THREE.Vector2()
  private readonly sceneSize = new THREE.Vector2()
  private readonly resolution = new THREE.Vector2()
  private readonly intensity = new THREE.Vector3()
  private readonly downTexel = new THREE.Vector2()
  private readonly upTexel = new THREE.Vector2()
  private time = 0

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false })
    this.glows = [this.halo, this.bloom, this.mist]
    const depth = this.halo.levels
    for (let i = 0; i < depth; i++) {
      this.down.push(glowTarget(this.glows.filter((g) => g.levels > i).length))
      this.texel.push(new THREE.Vector2())
      if (i < depth - 1) this.up.push(glowTarget(this.glows.filter((g) => g.levels - 2 >= i).length))
    }

    this.prefilter = material(prefilterFrag, {
      tScene: { value: this.sceneTarget.texture },
      texelSize: { value: this.sceneTexel },
      sceneSize: { value: this.sceneSize },
      // the luminance threshold and its smoothing, for the sparkle and for the halo
      sparkle: { value: new THREE.Vector2(0.62, 0.62 + 0.35) },
      halo: { value: new THREE.Vector2(0.1, 0.1 + 0.5) },
    })
    for (let count = 1; count <= 3; count++) {
      const down = material(downFrag, { in0: { value: null }, in1: { value: null }, in2: { value: null }, texelSize: { value: this.downTexel } })
      const up = material(upFrag, {
        in0: { value: null },
        in1: { value: null },
        in2: { value: null },
        support0: { value: null },
        support1: { value: null },
        support2: { value: null },
        texelSize: { value: this.upTexel },
        radius: { value: new THREE.Vector3(...this.glows.map((g) => g.radius)) },
      })
      down.defines.COUNT = count
      up.defines.COUNT = count
      this.downMaterials.push(down)
      this.upMaterials.push(up)
    }
    const film = this.film.uniforms
    this.finish = material(finishFrag, {
      tScene: { value: this.sceneTarget.texture },
      tMist: { value: this.up[0].textures[2] },
      tBloom: { value: this.up[0].textures[1] },
      tHalo: { value: this.up[0].textures[0] },
      intensity: { value: this.intensity },
      resolution: { value: this.resolution },
      time: { value: 0 },
      uVignette: film.get('uVignette')!,
      uGrain: film.get('uGrain')!,
      uFringe: film.get('uFringe')!,
      uFade: film.get('uFade')!,
    })

    // one triangle that covers the screen
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    this.quad = new THREE.Mesh(geometry, this.finish)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)

    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.resizeTargets(size.x, size.y)
  }

  /** 0 = black, 1 = full picture: used for fades to and from black */
  set fade(v: number) {
    this.film.uniforms.get('uFade')!.value = v
  }

  setSize(_width: number, _height: number) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.resizeTargets(size.x, size.y)
  }

  private resizeTargets(w: number, h: number) {
    this.sceneTarget.setSize(w, h)
    const hw = Math.round(w * 0.5)
    const hh = Math.round(h * 0.5)
    let lw = hw
    let lh = hh
    for (let i = 0; i < this.down.length; i++) {
      if (i > 0) {
        lw = Math.round(lw * 0.5)
        lh = Math.round(lh * 0.5)
      }
      this.down[i].setSize(lw, lh)
      if (i < this.up.length) this.up[i].setSize(lw, lh)
      this.texel[i].set(1 / lw, 1 / lh)
    }
    const aligned = w === hw * 2 && h === hh * 2
    if (aligned !== 'ALIGNED' in this.prefilter.defines) {
      if (aligned) this.prefilter.defines.ALIGNED = ''
      else delete this.prefilter.defines.ALIGNED
      this.prefilter.needsUpdate = true
    }
    this.sceneTexel.set(1 / w, 1 / h)
    this.sceneSize.set(w, h)
    this.resolution.set(w, h)
  }

  private draw(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  /** the down levels, then the up levels, each one draw for every glow that reaches it */
  private blur() {
    const glows = this.glows
    for (let i = 1; i < this.down.length; i++) {
      const count = this.down[i].textures.length
      const u = this.downMaterials[count - 1].uniforms
      for (let j = 0; j < count; j++) u[`in${j}`].value = this.down[i - 1].textures[j]
      this.downTexel.copy(this.texel[i - 1])
      this.draw(this.downMaterials[count - 1], this.down[i])
    }
    for (let i = this.up.length - 1; i >= 0; i--) {
      const count = this.up[i].textures.length
      const u = this.upMaterials[count - 1].uniforms
      for (let j = 0; j < count; j++) {
        // a glow's deepest up level starts from its deepest down level
        u[`in${j}`].value = i === glows[j].levels - 2 ? this.down[i + 1].textures[j] : this.up[i + 1].textures[j]
        u[`support${j}`].value = this.down[i].textures[j]
      }
      this.upTexel.copy(this.texel[i + 1])
      this.draw(this.upMaterials[count - 1], this.up[i])
    }
  }

  render(dt: number) {
    const r = this.renderer
    r.setRenderTarget(this.sceneTarget)
    r.render(this.scene, this.camera)

    this.draw(this.prefilter, this.down[0])
    this.blur()

    this.time += dt
    const u = this.finish.uniforms
    u.time.value = this.time
    this.intensity.set(this.mist.intensity, this.bloom.intensity, this.halo.intensity)
    this.draw(this.finish, null)
  }

  dispose() {
    this.sceneTarget.dispose()
    for (const t of [...this.down, ...this.up]) t.dispose()
    for (const m of [this.prefilter, ...this.downMaterials, ...this.upMaterials, this.finish]) m.dispose()
    this.quad.geometry.dispose()
  }
}
