import{At as e,Bn as t,E as n,J as r,O as i,Sn as a,Tn as o,Un as s,dt as c,gt as l,ut as u,v as d,wn as f,xn as p,zn as m}from"./sources-DTAw6j4n.js";import{i as h,r as g,s as _}from"./shared-CP6b_OY5.js";import{a as v,n as ee,t as y}from"./index-D0XFMMob.js";import{n as te,t as ne}from"./hud--bTLmDhT.js";var b=`
#define MAX_ITER 12
#define BAILOUT ${4 .toFixed(1)}
uniform float uPower;

// x: distance estimate (<= 0 or ~0 inside), y: orbit trap, the smallest |z| on the orbit
vec2 bulbDE(vec3 c) {
  vec3 z = c;
  float dr = 1.0;
  float r = 0.0;
  float trap = 1e10;
  for (int i = 0; i < MAX_ITER; i++) {
    r = length(z);
    trap = min(trap, r);
    if (r > BAILOUT) break;
    float theta = atan(length(z.xy), z.z);
    float phi = atan(z.y, z.x);
    float rp = pow(r, uPower - 1.0);
    dr = rp * uPower * dr + 1.0;
    float zr = rp * r;
    float st = sin(theta * uPower);
    z = vec3(zr * st * cos(phi * uPower), zr * st * sin(phi * uPower), zr * cos(theta * uPower)) + c;
  }
  // r = 0 only at c = 0, whose orbit never leaves 0: deep inside
  return vec2(r > 0.0 ? 0.5 * log(r) * r / dr : -1.0, trap);
}
`;function x(e,t,n,r,i,a=S){let o=a,s=e,c=t,l=n,u=1,d=0,f=1e10,p=0;for(;p<12&&(d=o(Math.sqrt(o(o(o(s*s)+o(c*c))+o(l*l)))),f=Math.min(f,d),!(d>4));p++){let i=o(Math.atan2(o(Math.sqrt(o(o(s*s)+o(c*c)))),l)),a=o(Math.atan2(c,s)),f=o(d**+o(r-1));u=o(o(o(f*r)*u)+1);let p=o(f*d),m=o(Math.sin(o(i*r)));s=o(o(o(p*m)*o(Math.cos(o(a*r))))+e),c=o(o(o(p*m)*o(Math.sin(o(a*r))))+t),l=o(o(p*o(Math.cos(o(i*r))))+n)}let m=d>0?o(o(o(.5*o(Math.log(d)))*d)/u):-1;return i&&(i.de=m,i.trap=f,i.iterations=p),m}function S(e){return e}var C=1.25;function re(e,t,n,r){return r[0]=e,r[1]=-n,r[2]=t,r}var ie=[0,0,0];function ae(e,t,n,r=8,i=C){let a=i/C,o=re(e/a,t/a,n/a,ie),s=Math.hypot(o[0],o[1],o[2]);return s>4?(s-D(r))*a:x(o[0],o[1],o[2],r)*a}var w=[[2,2],[2.1,1.872],[2.2,1.7735],[2.25,1.702],[2.3,1.6777],[2.4,1.6074],[2.5,1.5348],[2.6,1.4506],[2.7,1.4554],[2.75,1.4088],[2.8,1.3865],[2.9,1.3904],[3,1.3705],[3.1,1.351],[3.2,1.3442],[3.3,1.3262],[3.4,1.3253],[3.5,1.3143],[3.6,1.3026],[3.7,1.2906],[3.8,1.2632],[3.9,1.2604],[4,1.2526],[4.5,1.2125],[5,1.1817],[6,1.1479],[7,1.1195],[8,1.1038],[9,1.0891],[10,1.08],[12,1.065],[16,1.0472]],T=1.04,E=.01;function D(e){return O(w,e)*T+E}var oe=w[0][1]*T+E,se=[[2,.314],[2.5,.379],[3,.448],[3.5,.496],[4,.557],[5,.621],[6,.666],[7,.705],[8,.729],[10,.773],[12,.809],[16,.857]],ce=[[2,1.024],[2.5,1.045],[3,1.136],[3.5,1.181],[4,1.158],[5,1.119],[6,1.12],[7,1.095],[8,1.089],[10,1.071],[12,1.06],[16,1.046]];function le(e,t){return t[0]=O(se,e),t[1]=O(ce,e),t}function O(e,t){if(!(t>e[0][0]))return e[0][1];for(let n=1;n<e.length;n++){let[r,i]=e[n];if(t<=r){let[a,o]=e[n-1];return o+(i-o)*(t-a)/(r-a)}}return e[e.length-1][1]}var ue=.35,k=1e3/60,de=19.5,fe=17.8,A=5,pe=4,me=1.06,he=.85,j=.04,M=.0025,N=2e4,P=1.5,F=250,I=1.3,L=2e4,R=5,z=0,ge=class{minScale=ue;maxScale=1;budget;limit=1/0;ring=new Float64Array(A);sorted=new Float64Array(A);count=0;head=0;hold=0;cutting=!1;relax=j;sinceCut=1/0;viewArea=0;constructor(e=6e5){this.budget=z>0?z:e}scaleFor(e){return this.clampScale(Math.sqrt(this.budget/Math.max(1,e)))}restScaleFor(e){return this.clampScale(Math.sqrt(this.budget*R/Math.max(1,e)))}sample(e,t,n){if(!(e>0)||e>F){this.count=0;return}if(n>this.viewArea/P&&n<this.viewArea*P||(this.viewArea=n,this.relax=j),this.sinceCut+=e,this.limit!==1/0&&(this.limit*=1+this.relax*e/1e3),this.ring[this.head]=e,this.head=(this.head+1)%A,this.count<A&&this.count++,this.hold>0){this.hold--;return}if(this.count<A)return;let r=this.median();if(r>de){this.cutting||=(this.sinceCut<N&&(this.relax=Math.max(M,this.relax/2)),this.limit=Math.min(this.limit,t),this.sinceCut=0,!0);let e=Math.min(.85,Math.max(.36,k*.9/r));this.budget=Math.max(L,Math.min(this.budget,t)*e),this.hold=pe,this.count=0}else if(r<fe){this.cutting=!1;let e=Math.min(this.limit*he,n*this.maxScale*this.maxScale*I);this.budget<e&&(this.budget=Math.min(e,this.budget*me))}z=this.budget}reset(){this.count=0,this.hold=0}clampScale(e){let t=Math.min(this.minScale,this.maxScale);return Math.min(this.maxScale,Math.max(t,e))}median(){let e=this.sorted;e.set(this.ring);for(let t=1;t<A;t++){let n=e[t],r=t-1;for(;r>=0&&e[r]>n;)e[r+1]=e[r],r--;e[r+1]=n}return e[2]}},_e=.8,ve=1e-5,ye=3e-5,B=e=>Number.isInteger(e)?e.toFixed(1):String(e),V=`
uniform float uMeshRadius;
varying vec3 vLocal;
void main() {
  vLocal = position * uMeshRadius;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vLocal, 1.0);
}
`,be=`
#define MAX_STEPS 128
#define STEP_SCALE ${B(_e)}
#define HIT_PX 0.5
#define EPS_FLOOR ${ve.toExponential()}
#define NORMAL_FLOOR ${ye.toExponential()}
#define AO_TAPS 5
#define AO_VIEW 0.035
#define AO_MIN 2e-4
#define AO_MAX 0.1
#define SHADOW_STEPS 24
#define SHADOW_K 6.0

uniform float uBound;       // radius that contains the set for this power
uniform vec3 uCamLocal;     // camera position
uniform float uPixelAngle;  // radians per march texel
uniform vec3 uKeyDir;       // toward the key light (upper left of the view)
uniform vec3 uRimDir;       // toward the rim light (lower right, behind)
uniform vec3 uUpDir;        // up on screen: the sky of the ambient term
uniform vec2 uTrapRange;    // orbit trap 5th / 98th percentile for this power
uniform vec3 uRamp[5];      // the act's colour ramp, linear
uniform float uKey;         // key light strength
uniform float uRim;
uniform float uGlow;        // emission in the creases
uniform float uCamDE;       // distance from the camera to the surface: the scale of the view
uniform vec3 uFog;          // what far surfaces fade toward
varying vec3 vLocal;

${d}
${b}

uniform float uSoft;        // offset of the drawn surface outward from the set: rounds it into a lump

vec2 sdf(vec3 p) {
  vec2 h = bulbDE(p);
  h.x -= uSoft;
  return h;
}

// distance along the ray from o in direction d (unit) to where it leaves the bound
float exitBound(vec3 o, vec3 d) {
  float b = dot(o, d);
  float c = dot(o, o) - uBound * uBound;
  return -b + sqrt(max(b * b - c, 0.0));
}

// gradient of the estimate by a tetrahedron of 4 taps (central differences in 4 not 6 calls),
// in a loop so the estimator is inlined once
vec3 bulbNormal(vec3 p, float h) {
  vec3 n = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 e = i == 0 ? vec3(1.0, -1.0, -1.0) : i == 1 ? vec3(-1.0, -1.0, 1.0) : i == 2 ? vec3(-1.0, 1.0, -1.0) : vec3(1.0);
    n += e * sdf(p + e * h).x;
  }
  return normalize(n);
}

// how open the surface is out to radius r along the normal: 1 = open, 0 = buried
float bulbAO(vec3 p, vec3 n, float r) {
  float occ = 0.0;
  float w = 1.0;
  float wsum = 0.0;
  for (int i = 1; i <= AO_TAPS; i++) {
    float h = r * float(i) / float(AO_TAPS);
    float d = sdf(p + n * h).x;
    occ += w * clamp((h - d) / h, 0.0, 1.0);
    wsum += w;
    w *= 0.7;
  }
  return 1.0 - occ / wsum;
}

// penumbra toward the key light: the narrowest cone the shadow ray squeezes through
float bulbShadow(vec3 o, vec3 d, float tmin, float tmax) {
  float res = 1.0;
  float t = tmin;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    float h = sdf(o + d * t).x;
    res = min(res, SHADOW_K * h / t);
    if (res < 0.004 || t > tmax) break;
    t += clamp(h * STEP_SCALE, tmin * 0.5, tmax * 0.15);
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

void main() {
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocal - ro);

  // enter the bound (or start at the camera if it is inside)
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uBound * uBound;
  float disc = b * b - c;
  if (disc <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  disc = sqrt(disc);
  float tExit = -b + disc;
  if (tExit <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float t = max(-b - disc, 0.0);

  // sphere trace; a hit is the estimate falling under half a texel's footprint at that distance
  float eps = EPS_FLOOR;
  float steps = 0.0;
  float trap = 1.0;
  bool hit = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec2 h = sdf(ro + rd * t);
    float d = h.x;
    trap = h.y;
    eps = max(t * uPixelAngle * HIT_PX, EPS_FLOOR);
    if (d < eps) {
      hit = true;
      break;
    }
    t += d * STEP_SCALE;
    if (t > tExit) break;
    steps += 1.0;
  }
  // out of steps while still inside the bound: the ray is creeping along a surface
  if (!hit && t < tExit) hit = true;
  if (!hit) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = bulbNormal(p, max(eps, NORMAL_FLOOR));
  vec3 v = -rd;
  // grazing hits can return a normal facing away from the eye; bend it back to the silhouette
  float nv = dot(n, v);
  if (nv < 0.0) n = normalize(n - v * nv * 1.01);

  // occlusion radii follow the view distance, so a dive looks like the overview, one level down
  float aoR = clamp(t * AO_VIEW, AO_MIN, AO_MAX);
  float ao = bulbAO(p, n, aoR);
  // a ray that crept along the surface for many steps is in a crease
  float occ = ao * (1.0 - 0.5 * steps / float(MAX_STEPS));

  // colour along the act's ramp: the orbit trap says how far out a point's orbit stayed, so
  // the outer skin of every bud is chalk and the folds between them are moss
  float tn = clamp((trap - uTrapRange.x) / (uTrapRange.y - uTrapRange.x), 0.0, 1.0);
  // the inflated lump sits further out than any orbit trap reaches: hold it down in the moss
  float tone = 0.16 + 0.6 * tn * tn * (1.6 - 0.6 * tn) + 0.12 * occ - 3.4 * uSoft;
  vec3 albedo = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], tone);
  // chalk, not neon: take some of the saturation out of the body colour
  albedo = mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, 0.55);

  // key: one light, upper left, with a soft shadow
  float dif = max(dot(n, uKeyDir), 0.0);
  float sha = 0.0;
  if (dif > 0.0) {
    float tmin = max(aoR * 0.12, 6.0 * eps);
    sha = bulbShadow(p + n * 2.0 * eps, uKeyDir, tmin, exitBound(p, uKeyDir));
  }
  vec3 hv = normalize(uKeyDir + v);
  float spe = pow(max(dot(n, hv), 0.0), 48.0) * dif * sha;
  // rim: from behind, opposite the key, in the hot end; fresnel-weighted so it rides the silhouette
  float rim = max(dot(n, uRimDir), 0.0);
  float fre = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float sky = 0.5 + 0.5 * dot(n, uUpDir);

  vec3 KEY = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], 0.96);
  vec3 RIM = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], 0.82);
  vec3 SKY = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], 0.3) * 0.24;
  vec3 GROUND = uRamp[0] * 0.25;
  // the deep creases glow instead of going black: light caught in the folds
  vec3 GLOW = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], 0.5);

  // the dull lump is lit flatter and dimmer than the bulb it becomes
  vec3 light = KEY * (uKey * (1.0 - 2.5 * uSoft) * dif * sha * (0.5 + 0.5 * occ))
             + mix(GROUND, SKY, sky) * (1.3 * occ)
             + RIM * (0.5 * rim * occ);
  float crease = pow(1.0 - occ, 3.5);
  vec3 col = albedo * light
           + KEY * (0.4 * spe)
           + RIM * (uRim * fre * (0.35 + 0.65 * rim) * (0.5 + 0.5 * occ))
           + GLOW * (uGlow * crease);

  // depth: surfaces beyond the nearest one sink into the dark, at the scale of the view, so a
  // close-up separates the bud in front from the thicket behind it
  float far = max(0.0, t - uCamDE) / (uCamDE * 2.2 + 1e-5);
  col = mix(uFog, col, exp(-1.1 * far));
  gl_FragColor = vec4(col, t);
}
`,xe=`
uniform sampler2D uMarch;
uniform vec2 uAlloc;      // march target size, texels
uniform vec2 uMarchSize;  // texels the last march covered (the whole view at its scale)
uniform vec2 uFrame;      // framebuffer size, pixels
uniform vec3 uCamLocal;
uniform float uOpacity;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying vec3 vLocal;

vec4 fetch(vec2 ij) {
  return texture2D(uMarch, (clamp(ij, vec2(0.0), uMarchSize - 1.0) + 0.5) / uAlloc);
}

void main() {
  // bilinear over the four nearest march texels, ignoring misses: at full scale this is one
  // texel exactly; below it the silhouette gets a fractional coverage
  vec2 q = gl_FragCoord.xy / uFrame * uMarchSize - 0.5;
  vec2 i = floor(q);
  vec2 f = q - i;
  vec4 s00 = fetch(i);
  vec4 s10 = fetch(i + vec2(1.0, 0.0));
  vec4 s01 = fetch(i + vec2(0.0, 1.0));
  vec4 s11 = fetch(i + vec2(1.0, 1.0));
  float w00 = (1.0 - f.x) * (1.0 - f.y) * step(1e-7, s00.a);
  float w10 = f.x * (1.0 - f.y) * step(1e-7, s10.a);
  float w01 = (1.0 - f.x) * f.y * step(1e-7, s01.a);
  float w11 = f.x * f.y * step(1e-7, s11.a);
  float cover = w00 + w10 + w01 + w11;
  if (cover < 0.004) discard;
  vec4 s = (s00 * w00 + s10 * w10 + s01 * w01 + s11 * w11) / cover;

  // the hit along this pixel's own ray, at the filtered distance
  vec3 hit = uCamLocal + normalize(vLocal - uCamLocal) * s.a;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(hit, 1.0);
  gl_FragDepth = clamp(0.5 * clip.z / max(clip.w, 1e-9) + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(s.rgb, cover * uOpacity);
}
`,H=1.02,Se=.33,Ce=.25,we=new t(-.55,.6,.62).normalize(),Te=new t(.8,-.2,-.35).normalize(),Ee=new t(0,1,0),U=64,W=1.1,De=.45,G={marches:0,scale:0,texels:0,budget:0},K=new m,q=new u,J=new t,Y=new i,X=[0,0],Z=new t,Oe=class{geometry;material;governor=new ge;marchMaterial;scene=new p;proxyCamera=new n;proxy;target=null;allocW=0;allocH=0;shared={uPower:{value:8},uSoft:{value:0},uBound:{value:D(8)},uMeshRadius:{value:D(8)*H},uCamLocal:{value:new t}};marchUniforms={...this.shared,uPixelAngle:{value:.001},uKeyDir:{value:new t},uRimDir:{value:new t},uUpDir:{value:new t},uTrapRange:{value:new m(.729,1.089)},uRamp:{value:[new t,new t,new t,new t,new t]},uKey:{value:2.6},uRim:{value:1.5},uGlow:{value:.45},uCamDE:{value:1},uFog:{value:new t}};displayUniforms={...this.shared,uMarch:{value:null},uAlloc:{value:new m(1,1)},uMarchSize:{value:new m(1,1)},uFrame:{value:new m(1,1)},uOpacity:{value:0}};frameId=0;drawnFrame=-1;delta=0;valid=!1;drawnScale=0;drawnW=0;drawnH=0;drawnPower=NaN;drawnSoft=NaN;drawnCam=new t;drawnBasis=new Float64Array(9);drawnProjection=new Float64Array(16);drawnModel=new u;stillTime=0;pendingPixels=0;pendingArea=0;constructor(){this.geometry=new o(1,48,24),this.geometry.boundingSphere=new f(new t,oe*H),this.marchMaterial=new a({name:`Mandelbulb.march`,vertexShader:V,fragmentShader:be,uniforms:this.marchUniforms,side:1,depthTest:!1,depthWrite:!1,blending:0,toneMapped:!1}),this.material=new a({name:`Mandelbulb.display`,vertexShader:V,fragmentShader:xe,uniforms:this.displayUniforms,side:1,transparent:!0,depthWrite:!0,depthTest:!0,toneMapped:!1}),this.proxy=new c(this.geometry,this.marchMaterial),this.proxy.frustumCulled=!1,this.proxy.matrixAutoUpdate=!1,this.proxy.matrixWorldAutoUpdate=!1,this.proxyCamera.matrixAutoUpdate=!1,this.proxyCamera.matrixWorldAutoUpdate=!1,this.scene.matrixWorldAutoUpdate=!1,this.scene.add(this.proxy)}setRamp(e){e.forEach((e,t)=>this.marchUniforms.uRamp.value[t].set(e.r,e.g,e.b)),this.valid=!1}setFog(e){this.marchUniforms.uFog.value.set(e.r,e.g,e.b)}setLights(e,t,n){let r=this.marchUniforms;(r.uKey.value!==e||r.uRim.value!==t||r.uGlow.value!==n)&&(r.uKey.value=e,r.uRim.value=t,r.uGlow.value=n,this.valid=!1)}get opacity(){return this.displayUniforms.uOpacity.value}set opacity(e){this.displayUniforms.uOpacity.value=e,this.material.depthWrite=e>.98}static unsupported(e){let t=e.extensions;return!t.has(`EXT_color_buffer_float`)&&!t.has(`EXT_color_buffer_half_float`)?`The Mandelbulb needs to render into half-float textures (EXT_color_buffer_float).`:null}compile(e,t){let n=new p,i=new c(this.geometry,this.material);n.add(this.proxy.clone(),i);let a=new s(1,1,{type:r,depthBuffer:!1}),o=e.getRenderTarget();e.setRenderTarget(a);let l=e.compileAsync(n,t);return e.setRenderTarget(o),l.finally(()=>a.dispose())}invalidate(){this.valid=!1}prepare(e,t,n,r,i=0){this.frameId++,this.delta=t;let a=this.governor;a.maxScale=r,this.pendingPixels>0?(a.sample(n,this.pendingPixels,this.pendingArea),this.pendingPixels=0):a.reset();let o=D(e)+i*2.5;this.shared.uPower.value=e,this.shared.uSoft.value=i,this.shared.uBound.value=o,this.shared.uMeshRadius.value=o*H,le(e,X),this.marchUniforms.uTrapRange.value.set(X[0],X[1])}render(e,t,n){if(this.drawnFrame===this.frameId)return;this.drawnFrame=this.frameId;let r=e.getRenderTarget();r?K.set(r.width,r.height):e.getDrawingBufferSize(K);let i=K.x,a=K.y;if(i<1||a<1)return;this.displayUniforms.uFrame.value.set(i,a),q.copy(n.matrixWorld).invert(),J.setFromMatrixPosition(t.matrixWorld);let o=this.shared.uCamLocal.value.copy(J).applyMatrix4(q),s=this.marchUniforms;s.uCamDE.value=Math.max(1e-4,x(o.x,o.y,o.z,this.shared.uPower.value)-this.shared.uSoft.value),s.uKeyDir.value.copy(we).transformDirection(t.matrixWorld).transformDirection(q),s.uRimDir.value.copy(Te).transformDirection(t.matrixWorld).transformDirection(q),s.uUpDir.value.copy(Ee).transformDirection(t.matrixWorld).transformDirection(q);let c=t.projectionMatrix.elements[5]*a/2,l=Z.setFromMatrixColumn(n.matrixWorld,0).length(),u=this.shared.uBound.value*l,d=J.distanceTo(Z.setFromMatrixPosition(n.matrixWorld)),f=i*a;if(d>u*1.0001){let e=u/Math.sqrt(d*d-u*u)*c;f=Math.min(f,Math.PI*e*e)}let p=this.moved(t,n,o,c,i,a);p?this.stillTime=0:this.stillTime+=this.delta;let m=this.governor,h=0;if(p||!this.valid)h=m.scaleFor(f);else if(this.stillTime>=Ce){let e=m.restScaleFor(f);this.drawnScale<e*.97&&(h=e)}h>0&&(this.ensureTarget(Math.ceil(i*h),Math.ceil(a*h),i,a),this.march(e,t,n,i,a,h,c),p&&(this.pendingPixels=h*h*f,this.pendingArea=f),G.marches++,G.scale=h,G.budget=m.budget)}dispose(){this.target?.dispose(),this.target=null,this.marchMaterial.dispose(),this.material.dispose(),this.geometry.dispose()}moved(e,t,n,r,i,a){if(!this.valid||i!==this.drawnW||a!==this.drawnH||this.shared.uPower.value!==this.drawnPower||this.shared.uSoft.value!==this.drawnSoft||!t.matrixWorld.equals(this.drawnModel))return!0;let o=e.matrixWorld.elements,s=this.drawnBasis,c=0;for(let e=0;e<3;e++)Z.set(o[4*e],o[4*e+1],o[4*e+2]).normalize(),c=Math.max(c,Math.abs(Z.x-s[3*e]),Math.abs(Z.y-s[3*e+1]),Math.abs(Z.z-s[3*e+2]));let l=Math.max(1e-5,x(n.x,n.y,n.z,this.shared.uPower.value)),u=n.distanceTo(this.drawnCam)/l,d=e.projectionMatrix.elements,f=this.drawnProjection,p=Math.abs(d[8]-f[8])*i/2+Math.abs(d[9]-f[9])*a/2+Math.abs(d[0]/f[0]-1)*i/2+Math.abs(d[5]/f[5]-1)*a/2;return(c+u)*r+p>Se||d[11]!==f[11]||d[15]!==f[15]}ensureTarget(t,n,i,a){if(this.target&&t<=this.allocW&&n<=this.allocH&&t*n>=De*this.allocW*this.allocH)return;let o=Math.max(t,Math.min(i,Math.ceil(t*W/U)*U)),c=Math.max(n,Math.min(a,Math.ceil(n*W/U)*U));this.target?.dispose(),this.target=new s(o,c,{type:r,format:e,minFilter:l,magFilter:l,generateMipmaps:!1,depthBuffer:!1,stencilBuffer:!1}),this.allocW=o,this.allocH=c,this.displayUniforms.uMarch.value=this.target.texture,this.displayUniforms.uAlloc.value.set(o,c),this.valid=!1}march(e,t,n,r,i,a,o){let s=this.target;if(!s)return;let c=Math.max(1,Math.min(this.allocW,Math.round(r*a))),l=Math.max(1,Math.min(this.allocH,Math.round(i*a)));this.marchUniforms.uPixelAngle.value=i/(o*l);let u=this.proxyCamera;u.projectionMatrix.copy(t.projectionMatrix),u.projectionMatrixInverse.copy(t.projectionMatrixInverse),u.matrixWorld.copy(t.matrixWorld),u.matrixWorldInverse.copy(t.matrixWorldInverse),this.proxy.matrixWorld.copy(n.matrixWorld);let d=e.getRenderTarget(),f=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),m=e.autoClear,h=e.xr.enabled,g=e.shadowMap.autoUpdate,_=e.getClearAlpha();e.getClearColor(Y),e.autoClear=!1,e.xr.enabled=!1,e.shadowMap.autoUpdate=!1,s.viewport.set(0,0,c,l),s.scissorTest=!1,e.setRenderTarget(s),e.setClearColor(0,0),e.clear(!0,!1,!1),e.render(this.scene,u),e.setClearColor(Y,_),e.setRenderTarget(d,f,p),e.autoClear=m,e.xr.enabled=h,e.shadowMap.autoUpdate=g,this.displayUniforms.uMarchSize.value.set(c,l),G.texels=c*l,this.valid=!0,this.drawnScale=a,this.drawnW=r,this.drawnH=i,this.drawnPower=this.shared.uPower.value,this.drawnSoft=this.shared.uSoft.value,this.drawnCam.copy(this.shared.uCamLocal.value);let v=t.matrixWorld.elements;for(let e=0;e<3;e++)Z.set(v[4*e],v[4*e+1],v[4*e+2]).normalize(),this.drawnBasis[3*e]=Z.x,this.drawnBasis[3*e+1]=Z.y,this.drawnBasis[3*e+2]=Z.z;this.drawnProjection.set(t.projectionMatrix.elements),this.drawnModel.copy(n.matrixWorld)}},Q=1,ke=Q/1.25,Ae=2,$=8,je=.12,Me=[.526,.189,.627],Ne=[.548,.197,.653],Pe=e=>{let{engine:t,dust:n,rig:r,palette:i,root:a}=e,o=(e,t)=>r.shot(e.distance!==void 0&&!e.portrait?{...e,portrait:{distance:e.distance*.8}}:e,t),s=new Oe;s.setRamp(i.ramp),s.setFog(i.sky),s.opacity=0;let l=new c(s.geometry,s.material);l.rotation.x=-Math.PI/2,l.scale.setScalar(ke),l.frustumCulled=!1,l.visible=!1,l.onBeforeRender=(e,t,n)=>s.render(e,n,l),a.add(l);let u=!1,d=!0;s.compile(t.renderer,r.camera).then(()=>d&&(u=!0),e=>{console.error(`[bulb] shader compile`,e),d&&(u=!0)});let f=_(t),p=Ae,m=je,b=0,x=0,S=null,C=(t,n)=>{let r=p,i=m;e.tween(n,e=>{p=r+(t-r)*e,m=i*(1-Math.min(1,e*1.6))**2},{ease:ee,tag:`power`})};return{enter(){n.floorY=null,t.backdrop.floor=0;let r={...h(i),gain:.06,size:.0045};if(n.source!==f)n.morphTo(f,r,{seconds:3,swirl:.8});else{let t=n.look.gain;e.tween(2,e=>n.look.gain=t+(r.gain-t)*e)}e.after(1.3,()=>e.tween(2.2,e=>b=e,{tag:`fade`})),o({target:[0,.24,0],distance:5.6,azimuth:30,elevation:14,fov:38,orbit:2.5,aperture:.004},3)},cues:[y(3,()=>{C($,Math.max(3,e.until(4,`Mandelbulb`)+1.4)),v.sfx(`rise`,.5),S=te(e),o({target:[0,-.1,0],distance:3.7,elevation:18,orbit:4},5.5)}),y(4,`Mandelbulb`,()=>{ne(e,`Mandelbulb`,`White and Nylander, 2009`)}),y(5,()=>{S?.remove(),S=null,o({distance:3.15,elevation:22,orbit:2.4,aperture:.004},9)}),y(7,-.5,()=>{o({target:Me,distance:.55,azimuth:80,elevation:18,orbit:-.8,aperture:.006,portrait:{distance:.62}},3)}),y(8,()=>{o({target:Ne,distance:.2,azimuth:66,elevation:24,orbit:-.5,portrait:{distance:.23}},4)})],explore(){C($,2.2),o({target:[0,-.1,0],distance:3.5,elevation:20,orbit:3},3)},update(e){g(f,t.time);let n=performance.now(),r=t.manual||x===0?1e3/60:n-x;x=n,s.prepare(p,e,r,1,m),S?.set(`power  ${p.toFixed(1)}`),l.visible=u&&b>.001,s.opacity=b},exit(){let t=b;e.tween(2.4,e=>b=t*(1-e),{tag:`fade`})},dispose(){d=!1,a.remove(l),s.dispose()},lab:[{kind:`slider`,label:`Power`,min:2,max:12,step:.1,get:()=>p,set:t=>{e.cancel(`power`),p=t,m=0},format:e=>e.toFixed(1)},{kind:`action`,label:`Back to 8`,run:()=>C($,2.5)},{kind:`readout`,label:`Camera to surface`,get:()=>{let e=r.camera.position;return ae(e.x,e.y,e.z,p,Q).toFixed(3)}}],notes:[`The Mandelbrot set lives in the plane of complex numbers, where squaring a number doubles its angle. Three-dimensional space has no such multiplication, so for decades every attempt at a 3D Mandelbrot came out as a smooth, featureless blob. In 2009 Daniel White and Paul Nylander, on the Fractal Forums, replaced multiplication with a rotation in spherical coordinates: raise the length to the n-th power and multiply both angles by n. At n = 2 it is still a lump; at n = 8 it breaks into buds, and buds on buds.`,`Nothing here is a mesh. For each pixel the graphics card marches a ray forward, asking a distance estimate at every step how far the nearest point of the set could be, and steps that far. Shadows, the occlusion in the folds and the colour (how far each point's orbit strayed before it escaped) all come from the same formula.`,`Drag to turn it, scroll to go closer. Unlike the Mandelbrot set, the bulb is not known to be a true fractal all the way down: its surface may be smooth in places. But in practice the detail does not run out at any zoom a screen can show.`]}};export{Pe as default};