import{B as e,Bn as t,C as n,Ct as r,Sn as i,St as a,Vn as o,_ as s,ct as c,dt as l,h as u,i as d,q as f,t as p,ut as m,w as h,xn as g,yt as _,zn as ee}from"./sources-DTAw6j4n.js";import{t as v}from"./shared-CP6b_OY5.js";import{a as y,n as b,r as te,t as x}from"./index-D0XFMMob.js";import{n as ne}from"./hud--bTLmDhT.js";import{a as re,n as S}from"./math-Ble4RR5M.js";import{a as ie,i as C,n as w,r as ae,t as oe}from"./LogisticSource-B-ju9jc4.js";var T=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,E=`
uniform float uTime;
uniform float uMarkShare;
uniform vec4 uMark[48];      // x, y (world), age (s; < 0 empty), brightness 0..1
uniform vec4 uRipple[8];  // x, z, age (s; < 0 none), strength
uniform vec3 uImpact;              // where the drops land
uniform float uFloor;
uniform float uRise;               // seconds a mark takes to leap from the splash to its place
uniform float uSpread;             // radius of one mark
uniform float uRingLife;
uniform float uRingReach;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 water(vec2 cell, out float tone) {
  float a = hash12(cell + 1.7);
  float b = hash12(cell + 9.2);
  float c = hash12(cell + 4.4);
  float d = hash12(cell + 6.6);
  // a wide sheet, denser near the tap
  float r = 0.2 + 5.2 * pow(a, 0.85);
  float th = b * 6.2831853;
  vec3 p = vec3(uImpact.x - 0.6 + r * cos(th) * 1.25, uFloor + 0.006 + 0.05 * c * c * c, uImpact.z - 0.5 + r * sin(th) * 0.8);
  // a slow swell
  p.x += 0.03 * sin(uTime * 0.21 + d * 40.0);
  p.z += 0.03 * cos(uTime * 0.17 + c * 40.0);
  tone = 0.16 + 0.18 * d;
  // the rings light the water they pass through
  float lit = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 rp = uRipple[i];
    if (rp.z < 0.0 || rp.z > uRingLife) continue;
    float t = rp.z / uRingLife;
    float rad = 0.02 + uRingReach * (1.0 - pow(1.0 - t, 2.4));
    float dist = length(p.xz - rp.xy);
    float w = 0.012 + 0.04 * t;
    float e = (dist - rad) / w;
    lit += exp(-e * e) * (1.0 - t) * (1.0 - t) * rp.w;
    // a second, slower ring inside the first
    float rad2 = rad * 0.6;
    float e2 = (dist - rad2) / (w * 0.8);
    lit += 0.5 * exp(-e2 * e2) * (1.0 - t) * (1.0 - t) * (1.0 - t) * rp.w;
  }
  tone += 0.5 * min(lit, 1.2);
  p.y += 0.012 * min(lit, 1.0);
  return p;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float h = hash12(cell + 0.37);
  float tone;
  vec3 p = water(cell, tone);

  if (h < uMarkShare) {
    int slot = int(floor(h / uMarkShare * float(48)));
    vec4 m = vec4(0.0, 0.0, -1.0, 0.0);
    for (int i = 0; i < 48; i++) if (i == slot) m = uMark[i];
    if (m.z >= 0.0) {
      // a soft ball: most particles near the middle
      float a = hash12(cell + 2.1);
      float b = hash12(cell + 5.3);
      float c = hash12(cell + 8.9);
      vec3 dir = normalize(vec3(a - 0.5, b - 0.5, c - 0.5) + 1e-4);
      float rad = uSpread * pow(hash12(cell + 3.7), 1.6);
      vec3 home = vec3(m.x, m.y, 0.0) + dir * rad;
      // each particle leaves the splash a little after the last: a short comet
      float lag = hash12(cell + 12.4) * 0.1;
      float k = clamp((m.z - lag * uRise) / uRise, 0.0, 1.0);
      float e = 1.0 - pow(1.0 - k, 3.0);
      vec3 from = uImpact + dir * rad * 0.4;
      vec3 q = mix(from, home, e);
      // a spray in flight, gathering as it arrives
      q += dir * (0.012 + 0.6 * rad) * sin(3.14159265 * e);
      // up and over, not straight across
      q.y += sin(3.14159265 * e) * 0.18;
      p = k > 0.0 ? q : from;
      tone = m.w * (0.62 + 0.3 * hash12(cell + 14.2)) + (1.0 - k) * 0.4;
      if (k <= 0.0) tone = 0.0;
    }
  }
  gl_FragColor = vec4(p, tone);
}
`,se=class{matrix=new m;marks=Array.from({length:48},()=>new o(0,0,-1,0));ripples=Array.from({length:8},()=>new o(0,0,-1,0));impact=new t;renderer;read;write;prev;blit=new p;scene=new g;camera=new _(-1,1,1,-1,0,1);material;time=0;constructor(e,t,n){this.renderer=e,this.read=d(t),this.write=d(t),this.prev=d(t),this.material=new i({vertexShader:T,fragmentShader:E,uniforms:{uTime:{value:0},uMarkShare:{value:n.share},uMark:{value:this.marks},uRipple:{value:this.ripples},uImpact:{value:this.impact},uFloor:{value:n.floor},uRise:{value:n.rise},uSpread:{value:n.spread},uRingLife:{value:n.ringLife},uRingReach:{value:n.ringReach}},depthTest:!1,depthWrite:!1}),this.scene.add(new l(new a(2,2),this.material)),this.render(),this.blit.copy(e,this.read.texture,this.prev)}get texture(){return this.read.texture}get prevTexture(){return this.prev.texture}update(e){e<=0||(this.time+=e,this.blit.copy(this.renderer,this.read.texture,this.prev),this.render())}dispose(){this.read.dispose(),this.write.dispose(),this.prev.dispose(),this.blit.dispose(),this.material.dispose()}render(){let e=this.renderer;this.material.uniforms.uTime.value=this.time;let t=e.getRenderTarget(),n=e.autoClear;e.autoClear=!1,e.setRenderTarget(this.write),e.render(this.scene,this.camera),e.setRenderTarget(t),e.autoClear=n;let r=this.read;this.read=this.write,this.write=r}},D=`
attribute float aSize;
attribute float aStretch;
attribute float aGlow;
uniform float uViewportH;
varying float vStretch;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * aStretch * projectionMatrix[1][1] * 0.5 * uViewportH / max(gl_Position.w, 1e-6);
  gl_PointSize = aSize > 0.0 ? max(px, 3.0) : 0.0;
  vStretch = aStretch;
  vGlow = aGlow;
}
`,O=`
uniform vec3 uCore;
uniform vec3 uHalo;
uniform float uOpacity;
varying float vStretch;
varying float vGlow;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.x *= vStretch;
  float d2 = dot(p, p);
  if (d2 > 1.0 || vGlow <= 0.0) discard;
  float core = 1.0 - smoothstep(0.004, 0.022, d2);
  float halo = exp(-7.0 * d2) * (1.0 - d2) * 0.6 + exp(-40.0 * d2) * 0.5;
  gl_FragColor = vec4((uCore * core + uHalo * halo) * vGlow * uOpacity, 1.0);
}
`,k=`
varying vec2 vP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`,A=`
uniform vec4 uRipple[8];
uniform vec3 uInk;
uniform vec3 uGlow;
uniform float uLife;
uniform float uReach;
uniform float uOpacity;
varying vec2 vP;

float ring(float d, float r, float w) {
  float t = (d - r) / w;
  return exp(-t * t);
}

void main() {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 rp = uRipple[i];
    if (rp.z < 0.0 || rp.z > uLife) continue;
    float t = rp.z / uLife;
    float d = length(vP - rp.xy);
    float rad = 0.02 + uReach * (1.0 - pow(1.0 - t, 2.4));
    float w = 0.0035 + 0.012 * t;
    float fade = (1.0 - t) * (1.0 - t);
    float rings = ring(d, rad, w) + 0.55 * ring(d, rad * 0.6, w * 0.8) * (1.0 - t);
    // the splash: a flash at the centre in the first instant
    float flash = exp(-d * d / 0.0008) * max(0.0, 1.0 - rp.z / 0.16);
    col += (uGlow * rings * fade * 0.5 + uInk * flash) * rp.w;
  }
  gl_FragColor = vec4(col * uOpacity, 1.0);
}
`,j={transparent:!0,depthWrite:!1,blending:2},ce=class{object=new f;opacity=0;sprites;spriteMaterial;geometry=new h;pos;size;stretch;glow;plane;ringMaterial;n=18;constructor(t,o,c,u,d){this.pos=new n(new Float32Array(this.n*3),3).setUsage(e),this.size=new n(new Float32Array(this.n),1).setUsage(e),this.stretch=new n(new Float32Array(this.n).fill(1),1).setUsage(e),this.glow=new n(new Float32Array(this.n),1).setUsage(e),this.geometry.setAttribute(`position`,this.pos),this.geometry.setAttribute(`aSize`,this.size),this.geometry.setAttribute(`aStretch`,this.stretch),this.geometry.setAttribute(`aGlow`,this.glow),this.spriteMaterial=new i({vertexShader:D,fragmentShader:O,uniforms:{uViewportH:{value:800},uCore:{value:s(t,.97).multiplyScalar(2.4)},uHalo:{value:s(t,.6).multiplyScalar(1.1)},uOpacity:{value:0}},...j,depthTest:!0}),this.sprites=new r(this.geometry,this.spriteMaterial),this.sprites.frustumCulled=!1,this.sprites.renderOrder=12,this.object.add(this.sprites),this.ringMaterial=new i({vertexShader:k,fragmentShader:A,uniforms:{uRipple:{value:o},uInk:{value:s(t,.95).multiplyScalar(1.6)},uGlow:{value:s(t,.62).multiplyScalar(1.5)},uLife:{value:u},uReach:{value:d},uOpacity:{value:0}},...j,depthTest:!0}),this.plane=new l(new a(6,6).rotateX(-Math.PI/2),this.ringMaterial),this.plane.position.y=c+.002,this.plane.renderOrder=11,this.object.add(this.plane)}centre(e,t){this.plane.position.x=e,this.plane.position.z=t}sprite(e,t,n,r,i,a,o,s){let c=this.pos.array,l=this.size.array,u=this.stretch.array,d=this.glow.array,f=e+1+8;c[e*3]=t,c[e*3+1]=n,c[e*3+2]=r,l[e]=i,u[e]=a,d[e]=o;let p=Math.max(0,n-s);c[f*3]=t,c[f*3+1]=2*s-n,c[f*3+2]=r,l[f]=i*(1+.6*p),u[f]=a,d[f]=o*.42*Math.exp(-1.1*p)}commit(e){this.pos.needsUpdate=!0,this.size.needsUpdate=!0,this.stretch.needsUpdate=!0,this.glow.needsUpdate=!0,this.spriteMaterial.uniforms.uViewportH.value=e,this.spriteMaterial.uniforms.uOpacity.value=this.opacity,this.ringMaterial.uniforms.uOpacity.value=this.opacity,this.object.visible=this.opacity>.001}dispose(){this.geometry.dispose(),this.spriteMaterial.dispose(),this.plane.geometry.dispose(),this.ringMaterial.dispose()}},M=1.86,N=.05,P=.42,F=.66,I=2*(P-v)/(F*F),L=.13,R=w.centre[0]+w.width/2,le=w.width/47,z=2.2,B=.78,ue=.42,V=[[2.8,1.3],[2.9,1.22],[2.95,.84],[3.2,.66],[3.5,.56],[3.75,.5],[4,.48]];function H(e){if(e<=V[0][0])return V[0][1];for(let t=1;t<V.length;t++){let[n,r]=V[t],[i,a]=V[t-1];if(e<=n)return a+(r-a)*(e-i)/(n-i)}return V[V.length-1][1]}var de=.5*(S[0]+S[1]),U=[3.812,3.872,(3.872-3.812)/1.2],W=e=>{let{engine:n,dust:r,rig:i,palette:a,root:o}=e,s=new se(n.renderer,e.size,{floor:v,rise:.6,spread:.026,share:.36,ringLife:z,ringReach:B});s.impact.set(M,v+.01,N);let l=new ce(a,s.ripples,v,z,B);l.centre(M,N),o.add(l.object);let d=oe(n),f=()=>({...u(a),size:.0024,minPx:.6,gain:e.portrait?.06:.09,streak:.25,tone:`aux`,toneBias:0,toneScale:1,twinkle:.12}),p=2.9,m=.62,h=0,g=1,_=!0,T=0,E=Array.from({length:8},()=>({on:!1,age:0,x:0})),D=new Int32Array(48).fill(-1),O=new Float32Array(48),k=0,A=1,j=0,V=!1,W=0,G=null,K=null,q=new t,fe=new t,J=new ee,Y=e=>{p=Math.min(4,Math.max(2.8,e))},X=(t,n)=>{let r=p;e.tween(n,e=>Y(r+(t-r)*e),{ease:b,tag:`r`})},Z=e=>{m=Math.min(.97,Math.max(.03,m+e))},pe=(e,t)=>{let n=s.ripples[j];j=(j+1)%8,n.set(M,N,t,.65+.35*e);let r=H(p)*(.22+.9*e);l.opacity>.05&&y.sfx(`drip`,.42*l.opacity,c.clamp(1.5-.75*r,.7,1.4),.35);let i=k%48;D[i]=k,O[i]=e,s.marks[i].z=t,k++,A=0},me=()=>{m=re(p,m),m>0&&m<1||(m=.5);for(let e of E)if(!e.on){e.on=!0,e.age=0,e.x=m;break}g=H(p)*(.22+.9*m)},he=e=>{for(let t of E)t.on&&(t.age+=e,t.age>=F&&(t.on=!1,pe(t.x,t.age-F)));_&&(h+=e,h>=g&&(h-=g,me())),T+=(+!!_-T)*(1-Math.exp(-e*3));for(let t of s.ripples)t.z>=0&&(t.z+=e);A=Math.min(1,A+e/ue);let t=k-1,n=te(A);for(let r=0;r<48;r++){let i=s.marks[r],a=D[r];if(a<0)continue;let o=t-a,l=o===0?0:o-1+n;i.x=R-l*le,i.y=w.centre[1]-w.height/2+O[r]*w.height,i.z+=e,i.w=(1-.72*(l/47)**1.1)*c.smoothstep(47-l,0,2.5)}},ge=()=>{let e=c.smoothstep(h/Math.max(g,.001),.35,1)*T;l.sprite(0,M,P-.02*e,N,L*(1+.35*e),1+.12*e,(.6+.4*e)*T,v),E.forEach((e,t)=>{if(!e.on){l.sprite(t+1,0,0,0,0,1,0,v);return}let n=.39-.5*I*e.age*e.age;l.sprite(t+1,M,n,N,L*.55,1+Math.min(1.2,.16*I*e.age),.85,v)}),n.renderer.getDrawingBufferSize(J),l.commit(J.y)},Q=(t,n)=>{V||(V=!0,_=!1,e.cancel(`dial`),d.feather=0,ie(d,a),d.pool={y:(v+.012-(w.centre[1]-w.height/2))/w.height,depth:.2},W=0,d.reveal=0,d.orderGain=.14,r.morphTo(d,ae(a,d,e.portrait),{seconds:t,swirl:.25}),e.after(t*.8,()=>{y.sfx(`rise`,.7),e.tween(n,e=>{W=e,d.reveal=e},{tag:`reveal`,ease:e=>e,done:()=>{d.pool=null}})}),e.tween(4,e=>l.opacity=Math.min(l.opacity,1-e*.75),{tag:`water`}))},_e=()=>{V&&(V=!1,e.cancel(`reveal`),e.cancel(`dial`),d.pool=null,d.reveal=1,_=!0,r.morphTo(s,f(),{seconds:2,swirl:.3}),e.tween(1.5,e=>l.opacity=Math.max(l.opacity,e),{tag:`water`}))},ve=(t,n,r,i)=>{let a=d.spot,o={at:a.gain>.01?a.at:t,width:a.width,gain:a.gain};e.tween(i,e=>{a.at=o.at+(t-o.at)*e,a.width=Math.exp(Math.log(o.width)+(Math.log(n)-Math.log(o.width))*e),a.gain=o.gain+(r-o.gain)*e},{ease:b,tag:`spot`})},$=(e,t=.62)=>(C(e,t,q),[q.x,q.y,q.z]);return{enter(){r.floorY=v,n.backdrop.floor=1,r.morphTo(s,f(),{seconds:3.2,swirl:.7}),e.tween(2.5,e=>l.opacity=e,{tag:`water`}),g=1.6,h=.2,i.shot({target:[1.1800000000000002,-.36,0],distance:3,azimuth:-8,elevation:8,orbit:0,aperture:.004,portrait:{target:[1.4100000000000001,-.3,0],distance:2.3}},3.4)},cues:[x(0,()=>{G=ne(e)}),x(1,()=>X(2.95,1.8)),x(2,()=>{X(3.2,1.2),e.after(1,()=>Z(.08)),i.shot({target:[.76,-.38,0],distance:3.6,azimuth:-6,elevation:8,portrait:{target:[1.11,-.32,0],distance:2.9}},6)}),x(3,()=>{X(3.5,1),e.after(.6,()=>Z(.05))}),x(3,`Then eight`,()=>X(3.56,.6)),x(3,`Then sixteen`,()=>X(3.567,.5)),x(4,()=>{X(3.72,e.until(4,`no rhythm`)+.4),i.shot({target:[.24,-.4,0],distance:4.3,azimuth:-4,elevation:8,orbit:.3,portrait:{target:[.85,-.36,0],distance:3.6}},7)}),x(5,()=>{K=e.label(`next = r × x × (1 − x)`,{kind:`note`,at:[R-1.2,.42,0],align:`above`})}),x(6,()=>{K?.remove(),G?.remove(),G=null,Q(1.6,4.2),i.shot({target:$(3,.45),distance:3.1,azimuth:-14,elevation:6,orbit:0,aperture:.005,portrait:{distance:2.6}},2),e.after(1.6,()=>{i.shot({distance:4.3,azimuth:-10,elevation:5,portrait:{distance:3.7}},4.4),i.track(e=>{C(w.dial[0]+.6*W,.5,e)})})}),x(7,-.4,()=>i.shot({target:$(2.95,.62),distance:2.15,azimuth:-26,elevation:3,aperture:.014,portrait:{distance:1.6}},1.3)),x(7,`Two`,-.2,()=>i.shot({target:$(3.24,.62)},.9)),x(7,`Four`,-.2,()=>i.shot({target:$(3.5,.6)},.9)),x(7,`cloud`,-.25,()=>{i.shot({target:$(3.74,.56),distance:2.5},1.3),ve(3.78,.14,.7,1.2)}),x(8,-.2,()=>{ve(de,.2,0,1.5),i.shot({target:w.centre,distance:3.25,azimuth:-4,elevation:2,aperture:.003,orbit:0,portrait:{distance:3.5}},2.4);let[t,n]=d.dialRange;e.tween(3.6,e=>{let r=(1-U[2]**+e)/(1-U[2]);d.setDial(t+(U[0]-t)*r,n+(U[1]-n)*r),d.feather=.05*Math.min(1,e*2)},{ease:b,tag:`dial`})}),x(8,`windows`,.4,()=>{e.label(`the rhythm comes back`,{kind:`note`,at:()=>d.toWorld(S[0]+.0045,.74,fe),align:`center`})})],explore(){e.after(2.5,()=>{Y(3.2),Z(.01)})},update(e){e>0&&he(e),ge(),G?.set(`tap  r = ${p.toFixed(p>3.555&&p<3.6?3:2)}`)},exit(){let t=l.opacity;e.tween(2.2,e=>l.opacity=t*(1-e),{tag:`water`})},dispose(){r.source===s&&r.setSource(r.bake(),{...r.look}),l.dispose(),s.dispose()},lab:[{kind:`slider`,label:`How far the tap is open, r`,min:2.8,max:4,step:.001,get:()=>p,set:t=>{e.cancel(`r`),Y(t),Z(.01)},format:e=>e.toFixed(3)},{kind:`toggle`,label:`Every rhythm side by side`,get:()=>V,set:e=>{e?(Q(1.4,2.6),i.shot({target:w.centre,distance:4.4,azimuth:-6,elevation:4},2)):(_e(),i.shot({target:[.24,-.36,0],distance:4.6,azimuth:-4,elevation:8},2))}},{kind:`readout`,label:`Last gap`,get:()=>`${g.toFixed(2)} s`}],notes:[`Each drop leaves when the water hanging from the tap gets heavy enough, and how much is left behind sets up the next. Robert Shaw and his colleagues at Santa Cruz timed real dripping taps in the early 1980s and found exactly this: as the flow is turned up the drips go from even, to alternating long and short, to a doubling cascade, to no repeating pattern at all.`,`Here the rule is the logistic map: the next value is r × x × (1 − x), and the gap before the next drip grows with x. r stands for how far the tap is open. Below r = 3 every drip ends up the same; at 3 the rhythm splits into two; at 3.449 into four; then eight, sixteen, and by r ≈ 3.5699 the doublings have piled up into chaos.`,`The diagram plots, for every r, where the drips settle. A quarter of a million points each iterate the rule at their own r: where they pile onto a few lines the rhythm repeats, where they spread into a cloud it never does. The clear bands inside the cloud are windows of order; the widest, near r = 3.83, drips in threes.`]}};export{W as default};