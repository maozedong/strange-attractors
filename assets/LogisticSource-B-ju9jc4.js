import{Bn as e,O as t,Sn as n,St as r,dt as i,h as a,i as o,ut as s,v as c,xn as l,yt as u,zn as d}from"./sources-DTAw6j4n.js";var f={width:2.8,height:1.38,centre:[0,-.33,0],dial:[2.8,4]};function p(e,t){e.setForm(`logistic`),e.setDial(f.dial[0],f.dial[1]),e.setValue(0,1),e.place(f.width,f.height,f.centre),e.depth=.008,e.setPalette(t)}function m(t,n,r=new e){let[i,a,o]=f.centre;return r.set(i-f.width/2+(t-f.dial[0])/(f.dial[1]-f.dial[0])*f.width,a-f.height/2+n*f.height,o)}function h(e,t,n=!1){return{...a(e),size:.0022,minPx:.55,gain:n?.24:.5,streak:0,tone:`seed`,toneBias:.6,toneScale:.3,paint:t.paint,paintMix:1,twinkle:.18}}var g=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,_=`
uniform sampler2D uState;
uniform float uSize;
uniform vec2 uDial;    // dial range shown
uniform vec2 uValue;   // value range shown
uniform float uReveal; // 0..1 across the dial range
uniform float uForm;   // 0 logistic, 1 quadratic
uniform float uDepth;
uniform float uSeed;
uniform vec3 uPool;    // on (0/1), sheet height, sheet depth (source units)
uniform float uBand;   // width of the rising front, fraction of the dial range
uniform float uSeek;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  // one dial position per particle: its column, spread by a fixed jitter so no columns show
  float u = (cell.x + hash12(cell + 0.37)) / uSize;
  float dial = mix(uDial.x, uDial.y, u);
  float x = texture2D(uState, vUv).w;
  // 12 to 43 steps, at random: a fixed count that is a multiple of a cycle's period would pin
  // every particle to one phase of it, and some branches of the diagram would stay empty (the
  // spread must cover the longest cycle shown, 32 at the deepest fork)
  int steps = 12 + int(floor(hash12(cell + uSeed * 1.37) * 32.0));

  if (uForm < 0.5) {
    if (!(x > 0.0 && x < 1.0)) x = 0.05 + 0.9 * hash12(cell + uSeed);
    for (int i = 0; i < 44; i++) {
      if (i >= steps) break;
      x = dial * x * (1.0 - x);
    }
  } else {
    if (!(abs(x) < 2.0)) x = (hash12(cell + uSeed) - 0.5) * 0.5;
    for (int i = 0; i < 44; i++) {
      if (i >= steps) break;
      x = x * x + dial;
    }
  }

  // in a zoomed view most of an orbit lies outside the window: keep stepping along it until it
  // comes inside, so the particles of a column gather where its orbit crosses the view
  if (uSeek > 0.5) {
    for (int i = 0; i < 96; i++) {
      float w = (x - uValue.x) / (uValue.y - uValue.x);
      if (w >= 0.0 && w <= 1.0) break;
      if (uForm < 0.5) x = dial * x * (1.0 - x);
      else x = x * x + dial;
    }
  }

  // past r = 4 (or c < −2) every orbit escapes: nothing to draw there
  bool lost = !(abs(x) < 1.0e3);
  if (lost) x = uForm < 0.5 ? 0.5 : 0.0;

  float v = (x - uValue.x) / (uValue.y - uValue.x);
  // particles the reveal has not reached wait on its edge; particles outside the value range
  // are sent out of sight
  float shown = min(u, uReveal);
  float z = (hash12(cell + 7.1) - 0.5) * uDepth;
  bool hidden = lost || v < 0.0 || v > 1.0;
  if (hidden) z = 1.0e5;
  vec3 p = vec3(shown, v, z);
  if (uPool.x > 0.5) {
    // waiting in a sheet under its own column; the reveal's front lifts it into place
    float k = clamp((uReveal * (1.0 + uBand) - u) / uBand, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    // soft-edged: a little spill sideways, thickest in the middle
    float spill = (hash12(cell + 8.1) + hash12(cell + 2.6) - 1.0) * 0.08;
    vec3 rest = vec3(u + spill, uPool.y, (hash12(cell + 3.3) + hash12(cell + 5.9) - 1.0) * uPool.z);
    p = hidden ? rest : mix(rest, vec3(u, v, z), k);
  }
  gl_FragColor = vec4(p, x);
}
`,v=`
${c}
uniform sampler2D uState;
uniform float uSize;
uniform vec2 uDial;
uniform float uReveal;
uniform float uForm;
uniform vec3 uPool;
uniform float uBand;
uniform vec3 uRamp[5];
uniform float uOrderGain;
uniform vec3 uSpot;    // dial position, width, strength 0..1
uniform vec2 uValue;
uniform float uFeather;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float u = (cell.x + hash12(cell + 0.37)) / uSize;
  float dial = mix(uDial.x, uDial.y, u);
  float x = texture2D(uState, vUv).w;
  // soften the frame's edges when it is a window onto a larger picture
  float v = (x - uValue.x) / (uValue.y - uValue.x);
  float edge = uFeather > 0.0
    ? smoothstep(0.0, uFeather, u) * smoothstep(0.0, uFeather, 1.0 - u) * smoothstep(0.0, uFeather, v) * smoothstep(0.0, uFeather, 1.0 - v)
    : 1.0;
  // the local Lyapunov exponent: the average stretch of a small error per step
  float lam = 0.0;
  for (int i = 0; i < 16; i++) {
    if (uForm < 0.5) {
      lam += log(max(abs(dial * (1.0 - 2.0 * x)), 1.0e-5));
      x = dial * x * (1.0 - x);
    } else {
      lam += log(max(abs(2.0 * x), 1.0e-5));
      x = x * x + dial;
    }
  }
  lam /= 16.0;
  if (!(abs(lam) < 100.0)) lam = 0.0;
  float chaos = smoothstep(-0.35, 0.3, lam);
  float s = hash12(cell + 11.7);
  vec3 col = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], mix(0.5 + 0.12 * s, 0.7 + 0.22 * s, chaos));
  col *= mix(uOrderGain, 1.0, chaos * chaos);
  float sd = (dial - uSpot.x) / max(uSpot.y, 1.0e-6);
  // attention: light the band, let the rest fall back
  col *= mix(1.0 - 0.55 * uSpot.z, 1.0 + 5.0 * uSpot.z, exp(-sd * sd));
  col *= edge;
  if (uPool.x > 0.5) {
    float k = clamp((uReveal * (1.0 + uBand) - u) / uBand, 0.0, 1.0);
    vec3 still = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], 0.3 + 0.3 * s) * 0.05;
    // the front itself flares as the particles leave the water
    float flare = 1.0 + 3.0 * k * (1.0 - k);
    col = mix(still, col * flare, k * k);
  }
  gl_FragColor = vec4(col, 1.0);
}
`,y=class{prevTexture=null;matrix=new s;reveal=1;depth=.01;pool=null;seek=!0;band=.07;orderGain=.06;spot={at:3,width:.05,gain:0};feather=0;renderer;read;write;scene=new l;camera=new u(-1,1,1,-1,0,1);material;paintMaterial;paintScene=new l;paintTarget;ramp=[0,1,2,3,4].map(()=>new t(1,1,1));form=`logistic`;dial=new d(2.8,4);value=new d(0,1);frame=0;constructor(t,a){this.renderer=t,this.read=o(a),this.write=o(a),this.material=new n({vertexShader:g,fragmentShader:_,uniforms:{uState:{value:null},uSize:{value:a},uDial:{value:this.dial},uValue:{value:this.value},uReveal:{value:1},uForm:{value:0},uDepth:{value:.01},uSeed:{value:0},uPool:{value:new e},uBand:{value:.07},uSeek:{value:1}},depthTest:!1,depthWrite:!1}),this.scene.add(new i(new r(2,2),this.material)),this.paintTarget=o(a);let s=this.material.uniforms;this.paintMaterial=new n({vertexShader:g,fragmentShader:v,uniforms:{uState:{value:null},uSize:s.uSize,uDial:s.uDial,uReveal:s.uReveal,uForm:s.uForm,uPool:s.uPool,uBand:s.uBand,uRamp:{value:this.ramp},uOrderGain:{value:.06},uSpot:{value:new e},uValue:s.uValue,uFeather:{value:0}},depthTest:!1,depthWrite:!1}),this.paintScene.add(new i(new r(2,2),this.paintMaterial));for(let e=0;e<40;e++)this.step()}get texture(){return this.read.texture}get paint(){return this.paintTarget.texture}setPalette(e){for(let t=0;t<5;t++)this.ramp[t].copy(e.ramp[t])}setForm(e){if(e!==this.form){this.form=e,e===`logistic`?(this.dial.set(2.8,4),this.value.set(0,1)):(this.dial.set(-2,.25),this.value.set(-2,2));for(let e=0;e<40;e++)this.step()}}setDial(e,t){this.dial.set(e,t)}setValue(e,t){this.value.set(e,t)}get dialRange(){return[this.dial.x,this.dial.y]}get valueRange(){return[this.value.x,this.value.y]}toWorld(t,n,r=new e){return r.set((t-this.dial.x)/(this.dial.y-this.dial.x),(n-this.value.x)/(this.value.y-this.value.x),0).applyMatrix4(this.matrix)}place(e,t,n=[0,0,0]){this.matrix.makeTranslation(n[0]-e/2,n[1]-t/2,n[2]).multiply(new s().makeScale(e,t,e))}update(e){e<=0||this.step()}dispose(){this.read.dispose(),this.write.dispose(),this.material.dispose(),this.paintTarget.dispose(),this.paintMaterial.dispose()}step(){let e=this.renderer,t=this.material.uniforms;t.uState.value=this.read.texture,t.uReveal.value=this.reveal,t.uForm.value=this.form===`logistic`?0:1,t.uDepth.value=this.depth,t.uSeed.value=this.frame++%977+.5,t.uPool.value.set(+!!this.pool,this.pool?.y??0,this.pool?.depth??0),t.uBand.value=Math.max(.001,this.band),t.uSeek.value=+!!this.seek;let n=e.getRenderTarget(),r=e.autoClear;e.autoClear=!1,e.setRenderTarget(this.write),e.render(this.scene,this.camera);let i=this.read;this.read=this.write,this.write=i,this.paintMaterial.uniforms.uState.value=this.read.texture,this.paintMaterial.uniforms.uOrderGain.value=this.orderGain,this.paintMaterial.uniforms.uFeather.value=this.feather,this.paintMaterial.uniforms.uSpot.value.set(this.spot.at,this.spot.width,this.spot.gain),e.setRenderTarget(this.paintTarget),e.render(this.paintScene,this.camera),e.setRenderTarget(n),e.autoClear=r}},b=new WeakMap;function x(e){let t=b.get(e);return t||(t=new y(e.renderer,e.size),b.set(e,t)),t}export{p as a,m as i,f as n,h as r,x as t};