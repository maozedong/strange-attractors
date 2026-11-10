import{Cn as e,Ct as t,G as n,Gn as r,Hn as i,L as a,Mt as o,Vn as s,Y as c,at as l,it as u,pn as d,pt as f,v as p,vt as m,wn as h,wt as g,xt as _}from"./sources-DZb2XxHs.js";var v=2048,y=v*2,b=4e3;function x(e){let t=Math.max(0,Math.log10(1/e)),n=Math.round(200+60*t*t);return Math.min(Math.max(n,200),b,4095)}function S(e,t,n,r){let i=Math.min(n,4095),a=0,o=0;r[0]=0,r[1]=0;let s=0;for(;s<i;){let n=a*a-o*o+e;if(o=2*a*o+t,a=n,s++,r[2*s]=a,r[2*s+1]=o,a*a+o*o>4)break}return s}var C=600,w=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,T=`
uniform float uEscape2;  // escape radius squared (256 for smooth shading; 4 shows the classic level sets)
uniform vec2 uSpan;      // complex size of the whole plane
uniform float uUnit;     // complex units per world unit
uniform vec2 uUvScale;   // the pass draws into this fraction of its target
uniform float uBandFreq; // bands per doubling of the escape count
varying vec2 vUv;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

float encodeEscape(float n, float r2, vec2 der) {
  float lz = 0.5 * log(r2);
  float mu = max(n + 1.0 - log2(lz), 1.0);
  float dl = length(der);
  float de = dl < 1e30 ? sqrt(r2) * lz / dl : 0.0;
  float L = de > 0.0 ? log2(de / uUnit) : -40.0;
  float q = floor(clamp((L + 12.0) / 15.0, 0.0, 1.0) * 63.0 + 0.5);
  float m = floor(fract(log2(mu) * uBandFreq) * 255.0);
  return 1.0 + q * 256.0 + m;
}

float iterate(vec2 p);

void main() {
  vec2 uv = vUv / uUvScale;
  if (uv.x > 1.0 || uv.y > 1.0) discard;
  gl_FragColor = vec4(iterate((uv - 0.5) * uSpan), 0.0, 0.0, 1.0);
}
`,E=`
#define MAX_ITER ${b}
#define ORBIT_TEXELS ${v.toFixed(1)}
${T}
uniform sampler2D uOrbit;  // Z_0..Z_M, two entries per texel
uniform float uRefLen;
uniform float uMaxIter;
uniform vec2 uRef;         // the reference point (float; only for the shallow-view shortcut)
uniform float uShallow;    // 1: the main cardioid and the period-2 disc are known to be inside

vec2 orbitAt(float m) {
  float k = floor(m * 0.5);
  vec4 t = texture2DLodEXT(uOrbit, vec2((k + 0.5) / ORBIT_TEXELS, 0.5), 0.0);
  return m - 2.0 * k < 0.5 ? t.xy : t.zw;
}

float iterate(vec2 dc) {
  if (uShallow > 0.5 && uEscape2 > 5.0) {
    vec2 c = uRef + dc;
    float x = c.x - 0.25;
    float q = x * x + c.y * c.y;
    if (q * (q + x) < 0.25 * c.y * c.y) return -1.0;
    if ((c.x + 1.0) * (c.x + 1.0) + c.y * c.y < 0.0625) return -1.0;
  }
  vec2 Z = vec2(0.0);
  vec2 d = vec2(0.0);
  vec2 z = vec2(0.0);
  vec2 der = vec2(0.0);
  float m = 0.0;
  for (int n = 1; n <= MAX_ITER; n++) {
    if (float(n) > uMaxIter) break;
    der = 2.0 * cmul(z, der) + vec2(1.0, 0.0);
    d = cmul(2.0 * Z + d, d) + dc;
    m += 1.0;
    Z = orbitAt(m);
    z = Z + d;
    float r2 = dot(z, z);
    if (r2 > uEscape2) return encodeEscape(float(n), r2, der);
    if (r2 < dot(d, d) || m >= uRefLen) {
      d = z;
      m = 0.0;
      Z = vec2(0.0);
    }
  }
  return -1.0;
}
`,D=`
#define JULIA_ITER ${C}
${T}
uniform vec2 uC;
uniform vec2 uCentre;

float iterate(vec2 z) {
  z += uCentre;
  vec2 der = vec2(1.0, 0.0);
  for (int n = 1; n <= JULIA_ITER; n++) {
    der = 2.0 * cmul(z, der);
    z = cmul(z, z) + uC;
    float r2 = dot(z, z);
    if (r2 > uEscape2) return encodeEscape(float(n), r2, der);
  }
  return -1.0;
}
`,O=`
${p}
uniform sampler2D uData;
uniform vec2 uDataScale;  // the part of the data target that holds the picture
uniform vec2 uDataSize;   // the data target's size in texels
uniform vec3 uRamp[5];
uniform float uGlow;      // the escape-time light outside the set
uniform float uRim;       // the hairline on the boundary
uniform float uBase;      // a pool of dim light outside the set (the floor the set is cut out of)
uniform float uInterior;  // opacity of the black interior
uniform float uReach;     // how far the glow reaches: its decay length, world units
uniform float uFine;      // narrows the bright core (log2 units): deep views are thick with filaments
uniform float uBand;      // depth of the escape-time banding
uniform vec2 uAspect;
uniform vec2 uViewC;      // complex centre (shallow views only: for the lit bulbs)
uniform vec2 uViewSpan;
uniform vec3 uLit;        // light inside the main cardioid, the period-2 disc, the period-4 bud
uniform float uLitOn;
varying vec2 vUv;

vec3 ramp(float t) {
  return ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], t);
}

vec2 csqrt(vec2 z) {
  float r = length(z);
  float x = sqrt(max(0.0, 0.5 * (r + z.x)));
  float y = sqrt(max(0.0, 0.5 * (r - z.x)));
  return vec2(x, z.y < 0.0 ? -y : y);
}

// premultiplied colour and coverage of one encoded sample
vec4 shade(float v, float pool) {
  if (v < 0.0) return vec4(0.0, 0.0, 0.0, uInterior);
  if (abs(v) < 0.5) return vec4(0.0);
  float w = v - 1.0;
  float q = floor(w / 256.0);
  float m = w - q * 256.0;
  float L = q / 63.0 * 15.0 - 12.0;      // log2 of the distance to the set, world units
  // a bone-white hairline on the boundary, a teal glow falling away to nothing
  float d = exp2(L);
  float core = 1.0 - smoothstep(-10.5 - uFine, -8.4 - uFine, L);
  float halo = exp(-d / uReach);
  float band = 1.0 - uBand + uBand * (0.5 + 0.5 * cos(6.2831853 * m / 255.0));
  vec3 c = ramp(0.12 + 0.7 * halo) * (uGlow * halo * band * 0.62);
  c += ramp(0.96) * (uGlow * core * 0.75);
  float rim = 1.0 - smoothstep(-10.5, -8.2, L);
  c += ramp(0.97) * (uRim * rim * 0.5);
  c += ramp(0.36) * (pool * 0.4);
  float a = clamp(uGlow * (halo * 0.85 + core) + uRim * rim + pool * 0.9, 0.0, 1.0);
  return vec4(c, a);
}

vec4 tap(vec2 ij, float pool) {
  return shade(texture2D(uData, (ij + 0.5) / uDataSize).x, pool);
}

void main() {
  float r0 = length((vUv - 0.5) * 2.0 * uAspect);
  float pool = uBase * exp(-r0 * r0 * 2.2);
  // bilinear over the shaded neighbours (one tap when the data is full resolution)
  vec2 p = vUv * uDataScale * uDataSize - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec4 c = vec4(0.0);
  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;
  if (w00 > 0.001) c += w00 * tap(i, pool);
  if (w10 > 0.001) c += w10 * tap(i + vec2(1.0, 0.0), pool);
  if (w01 > 0.001) c += w01 * tap(i + vec2(0.0, 1.0), pool);
  if (w11 > 0.001) c += w11 * tap(i + vec2(1.0, 1.0), pool);
  c /= max(0.001, (w00 > 0.001 ? w00 : 0.0) + (w10 > 0.001 ? w10 : 0.0) + (w01 > 0.001 ? w01 : 0.0) + (w11 > 0.001 ? w11 : 0.0));

  if (uLitOn > 0.5) {
    vec2 cc = uViewC + (vUv - 0.5) * uViewSpan;
    // how strongly each named bulb's rhythm holds here: |multiplier| of its cycle (1 on its rim)
    float m1 = length(vec2(1.0, 0.0) - csqrt(vec2(1.0, 0.0) - 4.0 * cc));
    float m2 = 4.0 * length(cc + vec2(1.0, 0.0));
    float m4 = length(cc - vec2(-1.3107, 0.0)) / 0.0568;
    vec3 m = vec3(m1, m2, m4);
    vec3 inside = vec3(1.0) - smoothstep(vec3(0.985), vec3(1.0), m);
    vec3 lift = inside * uLit * (0.1 + 0.9 * pow(clamp(m, 0.0, 1.0), vec3(6.0)));
    float l = lift.x + lift.y + lift.z;
    c.rgb += ramp(0.3 + 0.5 * l) * (l * 0.3) * c.a;
  }
  gl_FragColor = c;
}
`,k=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,A=`
uniform sampler2D uColor;
uniform float uOpacity;
uniform vec2 uEdge;
uniform vec2 uAspect;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uColor, vUv);
  float r = length((vUv - 0.5) * 2.0 * uAspect);
  float edge = 1.0 - smoothstep(uEdge.x, uEdge.y, r);
  gl_FragColor = c * (edge * uOpacity);
}
`,j=1/45,M=1/57,N=.12;function P(e,t){return new r(e,t,{type:n,format:d,minFilter:m,magFilter:m,generateMipmaps:!1,depthBuffer:!1,stencilBuffer:!1})}var F=class{mesh;kind;view;c=new s(-.123,.745);maxIter=null;width;height;uniforms;renderer;hi;lo;color;iterMaterial;shadeMaterial;displayMaterial;geometry;quad;quadScene=new e;quadCamera=new _(-1,1,1,-1,0,1);orbit=null;orbitData=null;span=new s;last={cx:NaN,cy:NaN,scale:NaN,iter:-1,jx:NaN,jy:NaN,esc:NaN};lookKey=``;still=0;loScale=1;row=0;rows=48;hiDone=!1;showing=`none`;constructor(e,t,d,p,_,b,x={}){this.renderer=e,this.kind=d,this.width=p,this.height=_,this.view={...b};let S=x.density??400,C=Math.min(4096,e.capabilities.maxTextureSize),T=Math.min(C,Math.round(p*S)),j=Math.min(C,Math.round(_*S));if(this.hi=P(T,j),this.lo=P(Math.ceil(T/2),Math.ceil(j/2)),this.color=new r(T,j,{type:c,format:o,minFilter:l,magFilter:u,generateMipmaps:!0,depthBuffer:!1,stencilBuffer:!1,anisotropy:Math.min(8,e.capabilities.getMaxAnisotropy())}),d===`mandel`){this.orbitData=new Float32Array(y*2);let e=new a(this.orbitData,v,1,o,n);e.minFilter=m,e.magFilter=m,e.generateMipmaps=!1,e.needsUpdate=!0,this.orbit=e}let M={value:256},N={uEscape2:M,uSpan:{value:this.span},uUnit:{value:b.scale},uUvScale:{value:new s(1,1)},uBandFreq:{value:d===`mandel`?.85:2.6}};this.iterMaterial=new h({name:`${d}.iterate`,vertexShader:w,fragmentShader:d===`mandel`?E:D,uniforms:d===`mandel`?{...N,uOrbit:{value:this.orbit},uRefLen:{value:1},uMaxIter:{value:200},uRef:{value:new s},uShallow:{value:1}}:{...N,uC:{value:this.c},uCentre:{value:new s}},depthTest:!1,depthWrite:!1});let F=Math.min(p,_),I=new s(p/F,_/F);this.uniforms={uOpacity:{value:1},uGlow:{value:1},uRim:{value:1},uBase:{value:0},uInterior:{value:1},uReach:{value:.075},uFine:{value:0},uBand:{value:.4},uEdge:{value:new s(.62,.98)},uEscape2:M,uLit:{value:new i}},this.shadeMaterial=new h({name:`${d}.shade`,vertexShader:w,fragmentShader:O,uniforms:{uData:{value:null},uDataScale:{value:new s(1,1)},uDataSize:{value:new s(1,1)},uRamp:{value:t.ramp.map(e=>e.clone())},uGlow:this.uniforms.uGlow,uRim:this.uniforms.uRim,uBase:this.uniforms.uBase,uInterior:this.uniforms.uInterior,uReach:this.uniforms.uReach,uFine:this.uniforms.uFine,uBand:this.uniforms.uBand,uAspect:{value:I},uViewC:{value:new s},uViewSpan:{value:new s},uLit:this.uniforms.uLit,uLitOn:{value:0}},depthTest:!1,depthWrite:!1}),this.displayMaterial=new h({name:`${d}.display`,vertexShader:k,fragmentShader:A,uniforms:{uColor:{value:this.color.texture},uOpacity:this.uniforms.uOpacity,uEdge:this.uniforms.uEdge,uAspect:{value:I}},transparent:!0,premultipliedAlpha:!0,depthWrite:!1,side:2}),this.quad=new f(new g(2,2),this.iterMaterial),this.quad.frustumCulled=!1,this.quadScene.add(this.quad),this.geometry=new g(p,_),this.mesh=new f(this.geometry,this.displayMaterial),this.mesh.renderOrder=4,this.mesh.frustumCulled=!1,this.mesh.visible=!1}setPalette(e){let t=this.shadeMaterial.uniforms.uRamp.value;e.ramp.forEach((e,n)=>t[n].copy(e)),this.lookKey=``}get iterations(){return this.kind===`julia`?C:this.last.iter}get settled(){return this.hiDone}update(e,t){this.prepare()?(this.still=0,this.hiDone=!1,this.row=0,t>j?this.loScale=Math.max(.4,this.loScale*.92):t<M&&(this.loScale=Math.min(1,this.loScale*1.04)),this.iterate(this.lo,this.loScale,0,this.lo.height),this.showing=`lo`,this.shade()):(this.still+=t,!this.hiDone&&this.still>=N?this.refine(t):this.lookChanged()&&this.shade()),this.mesh.visible=this.uniforms.uOpacity.value>.001&&this.showing!==`none`}prepare(){let e=this.view,t=this.iterMaterial.uniforms,n=!1;if(this.kind===`mandel`&&this.orbitData&&this.orbit){let r=Math.max(1,Math.round(this.maxIter??x(e.scale*1.2)));(e.cx!==this.last.cx||e.cy!==this.last.cy||r!==this.last.iter)&&(t.uRefLen.value=S(e.cx,e.cy,r,this.orbitData),t.uMaxIter.value=r,t.uRef.value.set(e.cx,e.cy),this.orbit.needsUpdate=!0,this.last.cx=e.cx,this.last.cy=e.cy,this.last.iter=r,n=!0),t.uShallow.value=+(e.scale>.05)}else(this.c.x!==this.last.jx||this.c.y!==this.last.jy||e.cx!==this.last.cx||e.cy!==this.last.cy)&&(this.last.jx=this.c.x,this.last.jy=this.c.y,this.last.cx=e.cx,this.last.cy=e.cy,t.uCentre.value.set(e.cx,e.cy),n=!0);this.uniforms.uEscape2.value!==this.last.esc&&(this.last.esc=this.uniforms.uEscape2.value,n=!0),e.scale!==this.last.scale&&(this.last.scale=e.scale,t.uUnit.value=e.scale,n=!0),this.span.set(e.scale*this.width,e.scale*this.height);let r=this.shadeMaterial.uniforms;return r.uViewC.value.set(e.cx,e.cy),r.uViewSpan.value.copy(this.span),r.uLitOn.value=+(this.kind===`mandel`&&e.scale>.05&&this.uniforms.uLit.value.lengthSq()>0),n}lookChanged(){let e=this.uniforms,t=`${e.uGlow.value}|${e.uRim.value}|${e.uBase.value}|${e.uInterior.value}|${e.uReach.value}|${e.uFine.value}|${e.uBand.value}|${e.uLit.value.x}|${e.uLit.value.y}|${e.uLit.value.z}`;return t!==this.lookKey&&(this.lookKey=t,!0)}iterate(e,t,n,r){let i=Math.max(1,Math.round(e.width*t)),a=Math.max(1,Math.round(e.height*t));this.iterMaterial.uniforms.uUvScale.value.set(i/e.width,a/e.height),e.viewport.set(0,0,e.width,e.height);let o=Math.floor(n*t);e.scissor.set(0,o,i,Math.max(1,Math.min(a,Math.ceil(r*t))-o)),e.scissorTest=!0,this.quad.material=this.iterMaterial,this.pass(e),e.scissorTest=!1}refine(e){this.row>0&&(e>1/50?this.rows=Math.max(8,Math.floor(this.rows*.7)):e<1/58&&(this.rows=Math.min(this.hi.height,Math.ceil(this.rows*1.25))));let t=Math.min(this.hi.height,this.row+this.rows);this.iterate(this.hi,1,this.row,t),this.row=t,this.row>=this.hi.height?(this.hiDone=!0,this.showing=`hi`,this.shade()):this.lookChanged()&&this.shade()}shade(){let e=this.shadeMaterial.uniforms,t=this.showing===`hi`,n=t?this.hi:this.lo,r=t?1:this.loScale;e.uData.value=n.texture;let i=Math.max(1,Math.round(n.width*r)),a=Math.max(1,Math.round(n.height*r));e.uDataScale.value.set(i/n.width,a/n.height),e.uDataSize.value.set(n.width,n.height),this.quad.material=this.shadeMaterial,this.pass(this.color),this.lookChanged()}pass(e){let t=this.renderer,n=t.getRenderTarget(),r=t.autoClear,i=t.xr.enabled;t.autoClear=!1,t.xr.enabled=!1,t.setRenderTarget(e),t.render(this.quadScene,this.quadCamera),t.setRenderTarget(n),t.autoClear=r,t.xr.enabled=i}toWorld(e,t,n=new i){let r=this.view;return this.mesh.updateWorldMatrix(!0,!1),n.set((e-r.cx)/r.scale,(t-r.cy)/r.scale,0).applyMatrix4(this.mesh.matrixWorld)}toComplex(e,t=new s){let n=this.view;this.mesh.updateWorldMatrix(!0,!1);let r=e.clone().applyMatrix4(this.mesh.matrixWorld.clone().invert());return t.set(n.cx+r.x*n.scale,n.cy+r.y*n.scale)}hit(e,n=new i){this.mesh.updateWorldMatrix(!0,!1);let r=new i(0,0,1).transformDirection(this.mesh.matrixWorld),a=new i().setFromMatrixPosition(this.mesh.matrixWorld);return e.intersectPlane(new t().setFromNormalAndCoplanarPoint(r,a),n)}dispose(){this.hi.dispose(),this.lo.dispose(),this.color.dispose(),this.iterMaterial.dispose(),this.shadeMaterial.dispose(),this.displayMaterial.dispose(),this.geometry.dispose(),this.quad.geometry.dispose(),this.orbit?.dispose()}};export{F as t};