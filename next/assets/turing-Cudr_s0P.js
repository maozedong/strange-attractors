import{Cn as e,Dn as t,G as n,Gn as r,Hn as i,L as a,Mt as o,O as s,hn as c,ln as l,pt as u,s as d,v as f,vt as p,wn as m,wt as h,xt as g}from"./sources-DZb2XxHs.js";import{i as _,r as v,s as y,t as b}from"./shared-CraSzh4m.js";import{a as x,n as S,t as C}from"./index-C7a4hDdp.js";import{n as w}from"./hud--bTLmDhT.js";function T(e,t,n){e.f=t,e.k=n,e.vf=0,e.vk=0}function E(e,t,n,r,i=250){if(!(i>0)){T(e,t,n);return}let a=1/Math.max(i,1.25*r);e.vf+=(a*a*(t-e.f)-2*a*e.vf)*r,e.vk+=(a*a*(n-e.k)-2*a*e.vk)*r,e.f+=e.vf*r,e.k+=e.vk*r}var D=[{id:`spots`,label:`Spots`,feed:.032,kill:.0625},{id:`stripes`,label:`Stripes`,feed:.039,kill:.063},{id:`labyrinth`,label:`Labyrinth`,feed:.037,kill:.06},{id:`mitosis`,label:`Mitosis`,feed:.036,kill:.064},{id:`holes`,label:`Holes`,feed:.039,kill:.058}],O=1024,k=.16,A=.08,j=.8;function M(e=O,t=512,{naive:n=!1,minSpacing:r=j}={}){if(!I(e)||t%2!=0||t<4)throw Error(`buildRows: need W a power of two and H even ≥ 4, got ${e} × ${t}`);let i=new Int32Array(t),a=new Float64Array(t),o=new Float64Array(t),s=new Float64Array(t),c=new Float64Array(t),l=Math.PI/t,u=Math.sin(l/2);for(let o=0;o<t;o++){a[o]=Math.max(Math.sin(l*(o+.5)),u);let t=1;for(;!n&&t<e&&t*a[o]<r;)t*=2;i[o]=t}for(let e=0;e<t/2;e++)a[t-1-e]=a[e],i[t-1-e]=i[e];if(i[0]=e,i[t-1]=e,!n){for(let e=2;e<t/2;e++)i[e]=Math.max(i[e],i[e-1]>>1);for(let e=t-3;e>=t/2;e--)i[e]=Math.max(i[e],i[e+1]>>1)}for(let n=0;n<t;n++){let r=n===0?0:Math.sin(l*n),u=n===t-1?0:Math.sin(l*(n+1));o[n]=r/a[n],s[n]=u/a[n],c[n]=i[n]>=e?0:1/(i[n]*a[n])**2}return{W:e,H:t,m:i,sin:a,cN:o,cS:s,cPhi:c,poleTaps:e/i[1]}}function N(e){let t=new Float32Array(e.H*4);for(let n=0;n<e.H;n++)t[n*4]=e.m[n],t[n*4+1]=e.cN[n],t[n*4+2]=e.cS[n],t[n*4+3]=e.cPhi[n];return t}function P(e,t,n,r={}){let{W:i,H:a}=n,o=F(r.seed??7999973),s=r.noise??.02,c=r.discs??40,l=(r.radius??4)*(Math.PI/a);for(let n=0;n<i*a;n++)e[n]=1-s*o(),t[n]=s*o();let u=Math.cos(l);for(let e=0;e<c;e++){let e=2*o()-1,n=2*Math.PI*o(),r=Math.sqrt(1-e*e),s=r*Math.cos(n),c=e,d=r*Math.sin(n),f=Math.acos(e),p=Math.max(0,Math.floor((f-l)/Math.PI*a)-1),m=Math.min(a-1,Math.ceil((f+l)/Math.PI*a)+1);for(let e=p;e<=m;e++){let n=Math.PI*(e+.5)/a,r=Math.cos(n),o=Math.sin(n);for(let n=0;n<i;n++){let a=2*Math.PI*(n+.5)/i,l=e*i+n;t[l]<.5&&o*Math.cos(a)*s+r*c+o*Math.sin(a)*d>=u&&(t[l]+=.5)}}}for(let r=0;r<a;r++){let a=n.m[r];if(a!==1)for(let n=0;n<i;n+=a){let o=0,s=0;for(let c=0;c<a;c++)o+=e[r*i+n+c],s+=t[r*i+n+c];for(let c=0;c<a;c++)e[r*i+n+c]=o/a,t[r*i+n+c]=s/a}}}function F(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function I(e){return Number.isInteger(e)&&e>0&&!(e&e-1)}var L=e=>Number.isInteger(e)?e.toFixed(1):String(e),R=`
const float W = ${L(O)};
const float H = ${L(512)};

uniform sampler2D uState;
uniform sampler2D uRows;   // 1 x H: (texels per cell, cN, cS, cPhi) per row

vec2 cell(float i, float j) {
  return texture2D(uState, vec2((mod(i, W) + 0.5) / W, (j + 0.5) / H)).xy;
}

vec4 rowInfo(float j) {
  return texture2D(uRows, vec2(0.5, (j + 0.5) / H));
}
`;function z(e){return`
uniform float uFeed;
uniform float uKill;
${R}
const float DU = ${L(k)};
const float DV = ${L(A)};
const float DT = ${L(1)};
// the ring next to each pole: how many cells it has, and their size in texels
const int POLE_TAPS = ${e.poleTaps};
const float POLE_M = ${L(e.m[1])};

// The neighbour row r seen from the cell of m texels starting at texel first, at the cell's phi:
//  - finer (half the cell size): the mean of its two cells over our span;
//  - as coarse: its cell;
//  - coarser (a polar cap, or twice the size): its cell, linearly reconstructed at our centre
//    from its phi neighbours, so a phi gradient does not leak into the theta difference. The two halves of
//    a coarse cell get opposite corrections, so the coarse cell still sees exactly its own value
//    and the flux through every face stays the same from both sides (grid.ts).
vec2 across(float first, float m, float r) {
  float mr = rowInfo(r).x;
  if (mr < m - 0.5) return 0.5 * (cell(first, r) + cell(first + floor(m * 0.5), r));
  float start = floor(first / mr) * mr;
  vec2 here = cell(start, r);
  if (mr < m + 0.5) return here;
  float offset = (first + 0.5 * m) - (start + 0.5 * mr); // +- mr / 4 texels
  return here + (cell(start + mr, r) - cell(start - mr, r)) * (offset / (2.0 * mr));
}

void main() {
  float i = floor(gl_FragCoord.x);
  float j = floor(gl_FragCoord.y);
  vec4 row = rowInfo(j);
  float m = row.x;
  float first = floor(i / m) * m; // this cell's first texel: every texel of a cell computes the same

  vec2 c = cell(first, j);
  vec2 east = cell(first + m, j);
  vec2 west = cell(first - m, j);
  vec2 north;
  vec2 south;
  if (m > W - 0.5) {
    // a polar cap: its one neighbour is the whole next ring, read as the mean of the ring's cells
    // (its coefficient on the pole side is 0, so north and south can both carry the ring)
    float ringRow = j < 0.5 ? 1.0 : H - 2.0;
    vec2 ring = vec2(0.0);
    for (int q = 0; q < POLE_TAPS; q++) ring += cell(float(q) * POLE_M, ringRow);
    ring /= float(POLE_TAPS);
    north = ring;
    south = ring;
  } else {
    north = across(first, m, max(j - 1.0, 0.0));
    south = across(first, m, min(j + 1.0, H - 1.0));
  }
  // h^2 times the Laplace-Beltrami operator on the unit sphere, conservative central differences (grid.ts)
  vec2 lap = row.w * (east + west - 2.0 * c) + row.y * (north - c) + row.z * (south - c);

  float u = c.x;
  float v = c.y;
  float uvv = u * v * v;
  vec2 rate = vec2(DU * lap.x - uvv + uFeed * (1.0 - u), DV * lap.y + uvv - (uFeed + uKill) * v);
  gl_FragColor = vec4(clamp(c + DT * rate, 0.0, 1.0), 0.0, 1.0);
}
`}var B=`
uniform sampler2D uSource;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(uSource, vUv).xy, 0.0, 1.0);
}
`,V=`
uniform float uMirror;   // 1: drawn as the reflection under the floor
uniform float uFloorY;
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;    // world distance below the floor (reflection only)

void main() {
  vDir = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDepth = max(0.0, uFloorY - world.y);
  vec4 mv = viewMatrix * world;
  vView = -mv.xyz;
  vNormal = normalize((viewMatrix * vec4(mat3(modelMatrix) * normal, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}
`,H=`
uniform vec3 uKey;      // unit vector toward the key light, view space
uniform vec3 uRamp[5];
uniform float uOpacity;
uniform float uMirror;
uniform float uGrow;    // 0..1: how much of the pattern is shown (bare skin at 0)
varying vec3 vDir;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;
${R}
${f}

const float PI = 3.14159265358979;

vec3 ramp(float t) {
  return ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], t);
}

// row j at texture x = s W (texels): linear between the centres of the two nearest cells
vec2 rowAt(float j, float x) {
  float m = rowInfo(j).x;
  float q = x / m - 0.5;
  float g = floor(q);
  return mix(cell(g * m, j), cell((g + 1.0) * m, j), q - g);
}

// (U, V) in a direction from the centre: bilinear over the reduced grid, seamless in phi and
// continuous over the caps (above the first row's centre both rows are the cap)
vec2 stateAt(vec3 d) {
  float ring = length(d.xz);
  float theta = atan(ring, d.y);
  float phi = ring > 1e-9 ? atan(d.z, d.x) : 0.0;
  float x = phi / (2.0 * PI) * W;
  float y = theta / PI * H - 0.5;
  float j0 = floor(y);
  float a = clamp(j0, 0.0, H - 1.0);
  float b = clamp(j0 + 1.0, 0.0, H - 1.0);
  return mix(rowAt(a, x), rowAt(b, x), y - j0);
}

void main() {
  vec3 d = normalize(vDir);
  vec2 s = stateAt(d);
  float u = s.x;
  float v = s.y * uGrow;

  float mark = smoothstep(0.1, 0.3, v);
  float core = smoothstep(0.24, 0.42, v);
  // where U is used up round a mark the skin darkens a little: a soft halo
  float hollow = smoothstep(0.35, 0.95, mix(1.0, u, uGrow));
  float tone = mix(0.1 + 0.08 * hollow, 0.6 + 0.3 * core, mark);
  vec3 albedo = ramp(tone);

  vec3 n = normalize(vNormal);
  vec3 e = normalize(vView);
  float ndl = dot(n, uKey);
  // wrapped Lambert: the terminator is soft, the night side never quite black
  float dif = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  float sheen = pow(max(dot(n, normalize(uKey + e)), 0.0), 22.0) * smoothstep(-0.1, 0.4, ndl);
  float fres = pow(1.0 - clamp(dot(n, e), 0.0, 1.0), 3.0);

  vec3 col = albedo * (0.05 + 1.1 * dif)
           + ramp(0.95) * (0.12 * sheen * (0.4 + 0.6 * mark))
           + ramp(0.84) * (0.55 * fres * (0.25 + 0.75 * mark))
           + ramp(0.62) * (0.16 * core);
  float a = uOpacity;
  if (uMirror > 0.5) {
    // the dark glossy floor: dim, and gone a short way under it
    col *= 0.22;
    a *= exp(-2.4 * vDepth);
  }
  gl_FragColor = vec4(col, a);
}
`,U=class{rows;rowTexture;renderer;read;write;scene=new e;camera=new g(-1,1,1,-1,0,1);quad;stepUniforms;copyUniforms={uSource:{value:null}};stepMaterial;copyMaterial;initials=new Map;channels;savedTarget=null;savedFace=0;savedMip=0;savedAutoClear=!0;savedXr=!1;savedShadowAuto=!0;disposed=!1;constructor(e){let t=e.getContext();if(typeof WebGL2RenderingContext>`u`||!(t instanceof WebGL2RenderingContext))throw Error(`The Turing pattern simulation needs WebGL 2, which this browser or GPU does not provide.`);if(!e.extensions.has(`EXT_color_buffer_float`))throw Error(`The Turing pattern simulation needs the WebGL 2 extension EXT_color_buffer_float (rendering to 32-bit float textures), which this GPU or browser does not support.`);this.renderer=e,this.rows=M(O,512);let r=N(this.rows);this.rowTexture=new a(r,1,512,o,n),this.rowTexture.minFilter=p,this.rowTexture.magFilter=p,this.rowTexture.generateMipmaps=!1,this.rowTexture.needsUpdate=!0,this.rowTexture.name=`TuringSim.rows`,this.stepUniforms={uState:{value:null},uRows:{value:this.rowTexture},uFeed:{value:.037},uKill:{value:.06}},this.stepMaterial=G(`TuringSim.step`,z(this.rows),this.stepUniforms),this.copyMaterial=G(`TuringSim.copy`,B,this.copyUniforms),this.quad=new u(new h(2,2),this.copyMaterial),this.quad.frustumCulled=!1,this.scene.add(this.quad);let i=l;this.read=W(i),this.write=W(i),this.complete(this.read)||(this.read.dispose(),this.write.dispose(),i=o,this.read=W(i),this.write=W(i)),this.channels=i===1030?2:4,this.read.texture.name=`TuringSim.stateA`,this.write.texture.name=`TuringSim.stateB`;try{this.validate()}catch(e){throw this.dispose(),e}}get texture(){return this.read.texture}step(e,t,n){if(e<=0||this.disposed)return;let r=this.stepUniforms;r.uFeed.value=t,r.uKill.value=n,this.begin();for(let t=0;t<e;t++)r.uState.value=this.read.texture,this.pass(this.stepMaterial,this.write),this.swap();this.end()}reset(e={}){if(this.disposed)return;let t=JSON.stringify(e),n=this.initials.get(t);n||(n=this.buildInitial(e),this.initials.set(t,n)),n.needsUpdate=!0,this.copyUniforms.uSource.value=n,this.begin(),this.pass(this.copyMaterial,this.read),this.pass(this.copyMaterial,this.write),this.end(),n.dispose()}dispose(){if(!this.disposed){this.disposed=!0,this.read.dispose(),this.write.dispose(),this.rowTexture.dispose();for(let e of this.initials.values())e.dispose();this.stepMaterial.dispose(),this.copyMaterial.dispose(),this.quad.geometry.dispose()}}buildInitial(e){let t=O*512,r=new Float32Array(t),i=new Float32Array(t);P(r,i,this.rows,e);let s=this.channels,c=new Float32Array(t*s);for(let e=0;e<t;e++)c[e*s]=r[e],c[e*s+1]=i[e];let u=new a(c,O,512,s===2?l:o,n);return u.minFilter=p,u.magFilter=p,u.generateMipmaps=!1,u.name=`TuringSim.initial`,u}complete(e){let t=this.renderer.getContext(),n=this.renderer.getRenderTarget();this.renderer.setRenderTarget(e);let r=t.checkFramebufferStatus(t.FRAMEBUFFER)===t.FRAMEBUFFER_COMPLETE;return this.renderer.setRenderTarget(n),r}swap(){let e=this.read;this.read=this.write,this.write=e}begin(){let e=this.renderer;this.savedTarget=e.getRenderTarget(),this.savedFace=e.getActiveCubeFace(),this.savedMip=e.getActiveMipmapLevel(),this.savedAutoClear=e.autoClear,this.savedXr=e.xr.enabled,this.savedShadowAuto=e.shadowMap.autoUpdate,e.autoClear=!1,e.xr.enabled=!1,e.shadowMap.autoUpdate=!1}end(){let e=this.renderer;e.setRenderTarget(this.savedTarget,this.savedFace,this.savedMip),e.autoClear=this.savedAutoClear,e.xr.enabled=this.savedXr,e.shadowMap.autoUpdate=this.savedShadowAuto,this.savedTarget=null}pass(e,t){this.quad.material=e,this.renderer.setRenderTarget(t),this.renderer.render(this.scene,this.camera)}validate(){let e=this.renderer,t=e.getContext(),r=e.debug,i=r.checkShaderErrors,s=r.onShaderError,c=null;r.checkShaderErrors=!0,r.onShaderError=(e,n,r,i)=>{c=K(t,n,r,i)},this.begin();try{e.setRenderTarget(this.read);let r=t.checkFramebufferStatus(t.FRAMEBUFFER);if(r!==t.FRAMEBUFFER_COMPLETE)throw Error(`This GPU cannot render to 32-bit float textures (framebuffer status 0x${r.toString(16)}), which the Turing pattern simulation needs.`);let i=new a(new Float32Array(4),1,1,o,n);i.needsUpdate=!0,this.copyUniforms.uSource.value=i;for(let[e,t]of[[this.copyMaterial,this.read],[this.stepMaterial,this.write]])if(this.stepUniforms.uState.value=this.read.texture,this.pass(e,t),c!==null)throw Error(`${e.name} shader failed to compile.\n${c}`);i.dispose(),this.copyUniforms.uSource.value=null}finally{this.end(),r.checkShaderErrors=i,r.onShaderError=s}}};function W(e){return new r(O,512,{type:n,format:e,minFilter:p,magFilter:p,wrapS:c,wrapT:s,generateMipmaps:!1,depthBuffer:!1,stencilBuffer:!1})}function G(e,t,n){return new m({name:e,vertexShader:d,fragmentShader:t,uniforms:n,depthTest:!1,depthWrite:!1,blending:0})}function K(e,t,n,r){let i=[],a=e.getProgramInfoLog(t)?.trim();a&&i.push(`program: ${a}`);for(let[t,a]of[[`vertex`,n],[`fragment`,r]]){if(e.getShaderParameter(a,e.COMPILE_STATUS))continue;let n=e.getShaderInfoLog(a)?.trim()??``;i.push(`${t}: ${n}`);let r=/ERROR:\s*\d+:(\d+)/.exec(n),o=e.getShaderSource(a);if(r&&o){let e=Number(r[1]),t=o.split(`
`);for(let n=Math.max(0,e-5);n<Math.min(t.length,e+2);n++)i.push(`${n+1===e?`>`:` `} ${n+1}: ${t[n]}`)}}return i.join(`
`).replace(/\0/g,``)}var q=1,J=new i(-.5,.62,.6).normalize(),Y={discs:1400,radius:2,noise:.02,seed:24301},X={discs:0,noise:0},Z=54,Q=420,$=1500,ee=e=>D.find(t=>t.id===e)??D[2],te=e=>{let n=0,{engine:r,dust:a,rig:o,palette:s,root:c}=e,l=(e,t)=>o.shot(e.distance!==void 0&&!e.portrait?{...e,portrait:{distance:e.distance*.8}}:e,t),d=null;try{d=new U(r.renderer),d.reset(X)}catch(e){console.error(`[turing] GPU simulation unavailable:`,e instanceof Error?e.message:e)}let f={uState:{value:d?.texture??null},uRows:{value:d?.rowTexture??null},uKey:{value:J.clone()},uRamp:{value:s.ramp.map(e=>new i(e.r,e.g,e.b))},uOpacity:{value:0},uMirror:{value:0},uFloorY:{value:b},uGrow:{value:0}},p=new m({name:`turing.coat`,vertexShader:V,fragmentShader:H,uniforms:f,transparent:!0,toneMapped:!1}),h={...f,uMirror:{value:1},uOpacity:{value:0}},g=new m({name:`turing.reflection`,vertexShader:V,fragmentShader:H,uniforms:h,transparent:!0,depthWrite:!1,toneMapped:!1}),O=new t(q,128,80),k=new u(O,p),A=new u(O,g);k.position.y=b+q+.02,A.position.y=2*b-k.position.y,A.scale.y=-1,A.renderOrder=-1,c.add(k,A);let j=y(r),M={f:.037,k:.06,vf:0,vk:0},N={f:.037,k:.06},P=`labyrinth`,F=0,I=0,L=!1,R=0,z=null,B=e=>{let t=ee(e);P=t.id,N={f:t.feed,k:t.kill}},W=(t=$)=>{d&&(d.reset(Y),T(M,N.f,N.k),I=0,n=0,F=t,f.uGrow.value=0,e.tween(1.6,e=>f.uGrow.value=e,{tag:`grow`}),x.sfx(`shimmer`,.35))},G=e=>{f.uOpacity.value=e,h.uOpacity.value=e,p.depthWrite=e>.98};return G(0),{enter(){a.floorY=b,r.backdrop.floor=1;let t={..._(s),gain:.07};if(a.source!==j)a.morphTo(j,t,{seconds:3,swirl:.8});else{let n=a.look.gain;e.tween(2,e=>a.look.gain=n+(t.gain-n)*e)}e.tween(2.6,e=>R=e,{tag:`fade`}),l({target:[0,-.06,0],distance:4.6,azimuth:20,elevation:9,fov:38,orbit:0,aperture:.003},3)},cues:[C(1,()=>l({distance:4.1,elevation:12},9)),C(3,`faintest`,()=>{B(`labyrinth`),W(40),z=w(e),l({distance:3.9,elevation:14,azimuth:35},6)}),C(4,()=>{F=Math.min(3e3,1500/Math.max(1.5,e.until(5)-.4))}),C(5,`Turn a dial`,()=>{B(`stripes`),F=3200}),C(6,()=>{B(`mitosis`),F=3e3,l({distance:3.75,azimuth:60,elevation:17},6)}),C(6,`settle`,()=>{B(`spots`),F=2400}),C(7,()=>{F=900,l({distance:3.35,elevation:13,azimuth:80},10)}),C(8,()=>l({distance:3.15,elevation:11},8))],explore(){e.after(.4,()=>{B(`labyrinth`),W(1200),z=w(e)}),l({distance:3.6,elevation:14,azimuth:35,orbit:1.5},3)},update(e){if(v(j,r.time),d&&!L&&F>0&&e>0){I+=Math.min(e,.1)*F;let t=Math.min(Z,Math.floor(I));I=Math.min(I-t,.999),t>0&&(E(M,N.f,N.k,t,Q),d.step(t,M.f,M.k),n+=t)}d&&(f.uState.value=d.texture),k.rotation.y=(k.rotation.y+.07*e)%(Math.PI*2),A.rotation.y=k.rotation.y,G(R),k.visible=A.visible=R>.001,z?.set(`feed ${M.f.toFixed(3)}   kill ${M.k.toFixed(3)}`)},exit(){let t=R;e.tween(2.4,e=>R=t*(1-e),{ease:S,tag:`fade`})},dispose(){c.remove(k,A),O.dispose(),p.dispose(),g.dispose(),d?.dispose()},lab:[{kind:`choice`,label:`Coat`,options:D.map(e=>({value:e.id,label:e.label})),get:()=>P,set:e=>{B(e),F===0&&W(1200),F=Math.max(F,1200)}},{kind:`slider`,label:`Feed`,min:.01,max:.08,step:5e-4,get:()=>N.f,set:e=>{N={...N,f:e},P=``},format:e=>e.toFixed(4)},{kind:`slider`,label:`Kill`,min:.045,max:.07,step:5e-4,get:()=>N.k,set:e=>{N={...N,k:e},P=``},format:e=>e.toFixed(4)},{kind:`action`,label:`Start from bare skin`,run:()=>W(1200)},{kind:`readout`,label:`Steps since the noise`,get:()=>n.toLocaleString(`en-US`)},{kind:`toggle`,label:`Freeze`,get:()=>L,set:e=>L=e}],notes:[`In 1952 Alan Turing proposed that two substances could make a pattern from nothing, if one (the activator) makes more of itself and the other (the inhibitor) spreads faster and shuts it down. A small bump of activator grows, but the inhibitor it makes races ahead and stops its neighbours. The distance the inhibitor can travel sets the size of the spots.`,`This is the Gray–Scott model, a simple chemistry with that character: U is fed in at rate f, V is removed at rate f + k, and U + 2V turns into 3V. U diffuses twice as fast as V. Spots, stripes, mazes, dividing cells and holes all come from the same two equations; only f and k change. The pattern also remembers its past: a field of spots does not turn back into stripes when you return the dials.`,`The chemistry runs on a sphere of half a million cells, on your graphics card, about fifteen hundred steps a second. In 1990 Patrick De Kepper's group in Bordeaux finally saw Turing spots form in a gel reactor, almost forty years after the paper.`]}};export{te as default};