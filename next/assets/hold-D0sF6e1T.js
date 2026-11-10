import{Cn as e,G as t,Gn as n,Hn as r,L as i,Mt as a,O as o,P as s,Un as c,Vn as l,_ as u,c as d,f,h as p,k as m,o as h,pt as g,s as ee,vt as _,w as v,wn as te,wt as y,xt as ne}from"./sources-DZb2XxHs.js";import{c as re,i as ie,l as ae,o as oe,t as se,u as ce}from"./shared-CraSzh4m.js";import{a as le,n as ue,r as de,t as b}from"./index-p9n9GozK.js";import{n as x}from"./hud--bTLmDhT.js";import{n as fe,t as S}from"./FragmentSource-CGJ7F8jM.js";import{n as C,r as w}from"./IfsSim-C7XqOblH.js";var T={baseBottom:-.47,baseTop:-.19,baseHalfBottom:.15,baseHalfTop:.085,glassLowY:-.08,glassLowR:.125,glassHighY:.27,glassHighR:.058,glassWall:.01,capBottom:.31,capTop:.41,capHalfBottom:.062,capHalfTop:.04,poolDepth:.034},E=T.glassLowY-T.glassLowR;T.glassHighY+T.glassHighR;var D=[{hex:`#ff3b26`,weight:3},{hex:`#e5231b`,weight:2},{hex:`#ff6a14`,weight:3},{hex:`#ff9a1f`,weight:2},{hex:`#ff4d86`,weight:2},{hex:`#ff73b4`,weight:1.5},{hex:`#a65cff`,weight:1},{hex:`#7d4dff`,weight:.6}],O=444209741;function pe(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function k(){let e=pe(O),t=D.reduce((e,t)=>e+t.weight,0),n=[];for(let r=0;r<96;r++){let r=e()*t,i=0;for(;i<D.length-1&&r>=D[i].weight;)r-=D[i].weight,i++;let a={wax:i,bulb:.85+.15*e(),riseHz:new Float64Array(3),risePhase:new Float64Array(3),wobbleHz:new Float64Array(3),wobblePhase:new Float64Array(3),swayHz:new Float64Array(3),swayPhase:new Float64Array(3),sway:new Float64Array(3),radius:new Float64Array(3)};for(let t=0;t<3;t++)a.riseHz[t]=1/(28+36*e()),a.risePhase[t]=e(),a.wobbleHz[t]=1/(7+8*e()),a.wobblePhase[t]=e(),a.swayHz[t]=1/(11+16*e()),a.swayPhase[t]=e(),a.sway[t]=.25+.5*e(),a.radius[t]=t===0?.045+.01*e():.03+.012*e();n.push(a)}return n}var A=k();function j(e){let t=T;if(e<=t.glassLowY)return Math.sqrt(Math.max(t.glassLowR**2-(e-t.glassLowY)**2,0));if(e>=t.glassHighY)return Math.sqrt(Math.max(t.glassHighR**2-(e-t.glassHighY)**2,0));let n=t.glassHighY-t.glassLowY,r=(t.glassLowR-t.glassHighR)/n,i=Math.sqrt(Math.max(1-r*r,0));return(t.glassLowR-r*(e-t.glassLowY))/i}E+T.poolDepth*.6;var M=16,N=new Uint32Array(M),P=new Uint32Array(M),me=[56614,36284,43717,20534,11672,50052,50405,30412,51377,21352,18358,48051,4131,46280,51950,1333],F=`0123456789abcdef`;function he(){for(let e=0;e<M;e++)N[e]=me[15-e]}function I(e){let t=N;t[0]^=e&255;let n=0;for(let e=0;e<M;e++){let r=t[e]*355+n;if(e>=10){let n=e>=11?t[e-11]>>>8:0;r+=t[e-10]<<8&65535|n}P[e]=r&65535,n=Math.floor(r/65536)}t.set(P)}function L(){let e=``;for(let t=15;t>=0;t--){let n=N[t];e+=F[n>>>12&15]+F[n>>>8&15]+F[n>>>4&15]+F[n&15]}return e}var R=24,z=3,B=4,ge=[.5,.44,.64,.8,.56,.72,.4,.86],V=T,_e=V.glassLowY-V.glassLowR,H=V.glassHighY+V.glassHighR,U=Math.PI*2,ve=e=>e-Math.floor(e);function ye(e,t,n){let r=ve(e.riseHz[t]*n+e.risePhase[t]),i=.5-.5*Math.cos(U*r),a=i*i*(3-2*i),o=.5+.5*Math.sin(U*ve(e.wobbleHz[t]*n+e.wobblePhase[t]));return Math.min(Math.max(.9*a+.1*o,0),1)}var be=_e+V.poolDepth*.6,xe=e=>H-V.glassWall-1.6*e;function Se(e,t){let n=.05;for(let r=0;r<R;r++){let i=A[r];for(let a=0;a<z;a++){let o=i.radius[a],s=be,c=xe(o),l=s+(c-s)*ye(i,a,e),u=(ye(i,a,e+n)-ye(i,a,e-n))*(c-s)/(2*n),d=1+.45*Math.min(Math.abs(u)/.03,1),f=o/Math.sqrt(d),p=o*Math.sqrt(d),m=1/0;for(let e=0;e<16;e++){let t=e/16*U,n=j(l+p*Math.sin(t))-V.glassWall-Math.abs(f*Math.cos(t));n<m&&(m=n)}m=Math.max(m,0);let h=m*i.sway[a]*Math.sin(U*ve(i.swayHz[a]*e+i.swayPhase[a])),g=(r*B+a)*4;t[g]=h,t[g+1]=l,t[g+2]=o,t[g+3]=d}}}var W=new Float64Array(384),Ce=(e,t,n)=>Math.min(255,Math.max(0,Math.floor((e-t)/(n-t)*256)));function we(e){Se(e,W),he();for(let e=0;e<R;e++)for(let t=0;t<z;t++){let n=(e*B+t)*4;I(Ce(W[n],-.13,.13)),I(Ce(W[n+1],_e,H))}return L()}var G=e=>e.toFixed(6),Te=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,Ee=`
uniform sampler2D uLamps;
uniform vec2 uSize;
uniform float uOpacity;
uniform float uGain;
uniform vec3 uWall;
uniform vec3 uMetal;
uniform vec3 uBulb;
uniform vec3 uWhite;
varying vec2 vUv;

const float COLS = ${G(6)};
const float ROWS = ${G(4)};
const float LAMPS = ${G(R)};
const float TEXELS = ${G(B)};
const float BASE_BOT = ${G(V.baseBottom)};
const float BASE_TOP = ${G(V.baseTop)};
const float BASE_HB = ${G(V.baseHalfBottom)};
const float BASE_HT = ${G(V.baseHalfTop)};
const float GLASS_LOW_Y = ${G(V.glassLowY)};
const float GLASS_LOW_R = ${G(V.glassLowR)};
const float GLASS_HIGH_Y = ${G(V.glassHighY)};
const float GLASS_HIGH_R = ${G(V.glassHighR)};
const float GLASS_WALL = ${G(V.glassWall)};
const float CAP_BOT = ${G(V.capBottom)};
const float CAP_TOP = ${G(V.capTop)};
const float CAP_HB = ${G(V.capHalfBottom)};
const float CAP_HT = ${G(V.capHalfTop)};
const float POOL = ${G(V.poolDepth)};

vec4 lampTexel(float lamp, float j) {
  return texture2D(uLamps, vec2((j + 0.5) / TEXELS, (lamp + 0.5) / LAMPS));
}
float dot2(vec2 v) { return dot(v, v); }
float sq(float x) { return x * x; }

// signed distances (Inigo Quilez, MIT)
float sdTrapezoid(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he);
  vec2 k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, p.y < 0.0 ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0.0, 1.0);
  float sgn = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return sgn * sqrt(min(dot2(ca), dot2(cb)));
}
float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}
float fill(float sd, float aa) { return 1.0 - smoothstep(-aa, aa, sd); }

void main() {
  vec2 grid = vec2(COLS, ROWS);
  vec2 cellF = vUv * grid;
  vec2 cell = min(floor(cellF), grid - 1.0);
  vec2 cellSize = uSize / grid;
  float unit = min(cellSize.x, cellSize.y);
  vec2 q = (cellF - cell - 0.5) * cellSize / unit;
  float lamp = (ROWS - 1.0 - cell.y) * COLS + cell.x;
  vec2 lampPerUv = uSize / unit;
  float aa = max(max(fwidth(vUv.x) * lampPerUv.x, fwidth(vUv.y) * lampPerUv.y), 1e-5);

  vec4 look = lampTexel(lamp, ${G(z)});
  vec3 wax = look.rgb;
  float bulb = look.a;
  vec3 glow = mix(wax, uBulb, 0.45) * bulb;

  float glassBottom = GLASS_LOW_Y - GLASS_LOW_R;
  float glassTop = GLASS_HIGH_Y + GLASS_HIGH_R;
  float sdGlass = sdUnevenCapsule(q - vec2(0.0, GLASS_LOW_Y), GLASS_LOW_R, GLASS_HIGH_R, GLASS_HIGH_Y - GLASS_LOW_Y);
  float sdBase = sdTrapezoid(q - vec2(0.0, 0.5 * (BASE_BOT + BASE_TOP)), BASE_HB, BASE_HT, 0.5 * (BASE_TOP - BASE_BOT));
  float sdCap = sdTrapezoid(q - vec2(0.0, 0.5 * (CAP_BOT + CAP_TOP)), CAP_HB, CAP_HT, 0.5 * (CAP_TOP - CAP_BOT));

  // the wall, with this lamp's light spilling onto it
  float out_ = max(sdGlass, 0.0);
  vec3 col = uWall + glow * 0.05 * exp(-out_ * out_ / 0.006);

  // the shelf under the row
  float shelfTop = BASE_BOT;
  float onShelf = 1.0 - smoothstep(shelfTop - aa, shelfTop + aa, q.y);
  vec3 shelf = uWall * 1.6 + uWhite * 0.02 * exp(-sq((q.y - shelfTop) / max(0.004, aa)));
  shelf += glow * 0.04 * exp(-q.x * q.x / 0.012) * smoothstep(shelfTop - 0.03, shelfTop, q.y);
  col = mix(col, shelf, onShelf);

  // glass: liquid lit from the bulb, metaball wax, then the glass itself
  float y01 = clamp((q.y - glassBottom) / (glassTop - glassBottom), 0.0, 1.0);
  vec3 liquid = glow * (0.035 + 0.13 * exp(-3.2 * y01));
  float field = POOL * POOL / max((q.y - glassBottom) * (q.y - glassBottom), 1e-6);
  for (int j = 0; j < ${z}; j++) {
    vec4 b = lampTexel(lamp, float(j));
    vec2 d = (q - b.xy) * vec2(sqrt(b.w), 1.0 / sqrt(b.w));
    field += b.z * b.z / max(dot(d, d), 1e-6);
  }
  float fw = clamp(fwidth(field), 1e-3, 0.5);
  float waxMask = smoothstep(1.0 - fw, 1.0 + fw, field);
  float heat = exp(-1.6 * y01);
  float core = smoothstep(1.0, 3.0, field);
  // wax is lit from inside: brighter low down and in its thick middle, a little rim darkening
  vec3 waxLit = wax * bulb * (0.42 + 0.38 * heat) * (0.72 + 0.28 * core);
  float inner = fill(sdGlass + GLASS_WALL, aa);
  vec3 content = mix(liquid, waxLit, waxMask * inner);
  float rim = exp(-sq((sdGlass + 0.5 * GLASS_WALL) / max(0.5 * GLASS_WALL, aa)));
  float hw = mix(GLASS_LOW_R, GLASS_HIGH_R, clamp((q.y - GLASS_LOW_Y) / (GLASS_HIGH_Y - GLASS_LOW_Y), 0.0, 1.0));
  // a soft window highlight down the left of the glass, and a fainter one on the right
  float spec = exp(-sq((q.x / hw + 0.58) / 0.1)) + 0.35 * exp(-sq((q.x / hw - 0.66) / 0.06));
  spec *= smoothstep(glassBottom + 0.02, glassBottom + 0.12, q.y) * (1.0 - smoothstep(glassTop - 0.1, glassTop - 0.01, q.y));
  content += mix(glow, uWhite, 0.5) * (0.08 * rim) + uWhite * (0.075 * spec);
  col = mix(col, content, fill(sdGlass, aa));

  // metal base and cap: dark, a soft sheen, the bulb's light escaping round the collar
  float baseH = (q.y - BASE_BOT) / (BASE_TOP - BASE_BOT);
  float bw = mix(BASE_HB, BASE_HT, clamp(baseH, 0.0, 1.0));
  vec3 base = uMetal * (0.7 + 0.6 * baseH) + uWhite * 0.03 * exp(-sq((q.x / bw + 0.45) / 0.2));
  base += glow * 0.18 * exp(-sq((q.y - BASE_TOP) / 0.012)) + glow * 0.03 * smoothstep(0.4, 1.0, baseH);
  col = mix(col, base, fill(sdBase, aa));
  float cw = mix(CAP_HB, CAP_HT, clamp((q.y - CAP_BOT) / (CAP_TOP - CAP_BOT), 0.0, 1.0));
  vec3 cap = uMetal + uWhite * 0.025 * exp(-sq((q.x / cw + 0.45) / 0.22)) + glow * 0.06 * exp(-sq((q.y - CAP_BOT) / 0.015));
  col = mix(col, cap, fill(sdCap, aa));

  vec2 e = (vUv - 0.5) * 2.0;
  col *= 1.0 - 0.45 * smoothstep(0.35, 1.5, length(e * vec2(1.0, 0.92)));
  gl_FragColor = vec4(col * uGain, uOpacity);
}
`;function De(e,n,r){let o=new Float32Array(384),s=new i(o,B,R,a,t);s.minFilter=_,s.magFilter=_;let c=new m;for(let t=0;t<R;t++){let n=A[t];u(e,ge[n.wax]??.7,c);let r=(t*B+z)*4;o[r]=c.r,o[r+1]=c.g,o[r+2]=c.b,o[r+3]=n.bulb}let d=new te({vertexShader:Te,fragmentShader:Ee,uniforms:{uLamps:{value:s},uSize:{value:new l(n,r)},uOpacity:{value:0},uGain:{value:1.6},uWall:{value:e.sky.clone().multiplyScalar(1.4)},uMetal:{value:u(e,.1).multiplyScalar(.6)},uBulb:{value:u(e,.95)},uWhite:{value:u(e,1)}},toneMapped:!1}),f=new y(n,r),p=new g(f,d);return p.renderOrder=1,p.visible=!1,{mesh:p,material:d,update(e){Se(e,o),s.needsUpdate=!0},set opacity(e){d.uniforms.uOpacity.value=e,d.transparent=e<.995,d.depthWrite=e>.4,p.visible=e>.002},dispose(){s.dispose(),d.dispose(),f.dispose()}}}var K=[-13.7636106821,-19.5787519425,27],Oe=1.5586522107,q=1024,ke=256;function Ae(e=q){let t=f(`lorenz`),n=t.params.map(e=>e.default),r=Oe/(e*64),i=new Float64Array(K),a=new Float32Array(e*4);for(let o=0;o<e;o++){a[o*4]=i[0],a[o*4+1]=i[1],a[o*4+2]=i[2],a[o*4+3]=1;for(let e=0;e<64;e++)d(t,i,n,r)}return{points:a,closure:Math.hypot(i[0]-K[0],i[1]-K[1],i[2]-K[2])}}var je=`
uniform sampler2D uLoop;
const float LOOP_N = ${q.toFixed(1)};
vec3 loopAt(float ph) {
  float x = fract(ph) * LOOP_N;
  float i0 = floor(x);
  float t = x - i0;
  vec3 a = texture2D(uLoop, vec2((i0 + 0.5) / LOOP_N, 0.5)).xyz;
  vec3 b = texture2D(uLoop, vec2((mod(i0 + 1.0, LOOP_N) + 0.5) / LOOP_N, 0.5)).xyz;
  return mix(a, b, t);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`,Me=`
uniform sampler2D uState;
uniform float uSteps;   // RK4 steps this frame
uniform float uH;       // step size, system time
uniform float uHold;    // 0 = free flow; otherwise how hard each step pulls toward the loop
uniform float uTube;    // radius of the bundle round the loop, system units
varying vec2 vUv;
${je}
const float PERIOD = ${Oe.toFixed(10)};

vec3 f(vec3 v) {
  return vec3(10.0 * (v.y - v.x), v.x * (28.0 - v.z) - v.y, v.x * v.y - (8.0 / 3.0) * v.z);
}

void main() {
  vec4 s = texture2D(uState, vUv);
  vec3 p = s.xyz;
  float ph = s.w;
  // each particle keeps its own small offset from the loop, so the held swarm is a tube, not a wire
  vec3 o = vec3(hash12(vUv * 913.1), hash12(vUv * 517.3 + 3.1), hash12(vUv * 271.9 + 7.7)) - 0.5;
  float r = pow(hash12(vUv * 77.7 + 1.3), 1.6);
  vec3 tube = normalize(o + 1e-4) * r * uTube;
  float pull = 1.0 - exp(-uHold * uH);
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uSteps) break;
    vec3 k1 = f(p);
    vec3 k2 = f(p + 0.5 * uH * k1);
    vec3 k3 = f(p + 0.5 * uH * k2);
    vec3 k4 = f(p + uH * k3);
    p += uH / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    ph += uH / PERIOD;
    if (uHold > 0.0) p = mix(p, loopAt(ph) + tube, pull);
  }
  // anything thrown far off (it cannot happen on the attractor) comes back near it
  if (!(length(p - vec3(0.0, 0.0, 25.0)) < 120.0)) p = vec3(1.0, 1.0, 20.0);
  gl_FragColor = vec4(p, fract(ph));
}
`,Ne=`
uniform sampler2D uState;
varying vec2 vUv;
${je}
const float COARSE = ${ke.toFixed(1)};
void main() {
  vec4 s = texture2D(uState, vUv);
  vec3 p = s.xyz;
  float best = 1e9;
  float at = 0.0;
  for (int i = 0; i < ${ke}; i++) {
    float ph = float(i) / COARSE;
    vec3 d = loopAt(ph) - p;
    float e = dot(d, d);
    if (e < best) { best = e; at = ph; }
  }
  float c = at;
  for (int i = -8; i <= 8; i++) {
    float ph = c + float(i) / (COARSE * 8.0);
    vec3 d = loopAt(ph) - p;
    float e = dot(d, d);
    if (e < best) { best = e; at = ph; }
  }
  gl_FragColor = vec4(p, fract(at));
}
`,Pe=class{source;rate=2;hold=0;closure;loopTex;assign;h=f(`lorenz`).dt;owed=0;constructor(e,n){let{points:r,closure:o}=Ae();this.closure=o,this.loopTex=new i(r,q,1,a,t),this.loopTex.minFilter=_,this.loopTex.magFilter=_,this.loopTex.needsUpdate=!0,this.source=new S(e,n,Me,{uLoop:{value:this.loopTex},uSteps:{value:0},uH:{value:this.h},uHold:{value:0},uTube:{value:.32}}),this.assign=this.source.program(Ne,{uState:{value:null},uLoop:{value:this.loopTex}}),this.source.beforeRun=e=>{let t=this.source.uniforms;this.owed+=e*this.rate;let n=Math.min(24,Math.floor(this.owed/this.h));this.owed=Math.min(this.owed-n*this.h,this.h*4),t.uSteps.value=n,t.uHold.value=this.hold}}set tube(e){this.source.uniforms.uTube.value=e}seed(e){this.source.load(e)}findPlaces(){this.source.apply(this.assign)}loopPoint(e,t){let n=this.loopTex.image.data,r=Math.floor((e%1+1)%1*q)*4;return t.set(n[r],n[r+1],n[r+2])}dispose(){this.source.dispose(),this.loopTex.dispose(),this.assign.dispose()}},J=.07,Fe=.5,Y=.8,Ie=1.4,Le=.18,Re=.15,ze=`alternating`;Math.log((3+Math.sqrt(5))/2)/2;var Be=Math.sqrt(3)/2,X=[-.5*Be,0,Fe*Be],Z=[-.5/2,Fe,-.5/2];function Ve(e){return e*e*(3-2*e)}function He(e){return 6*e*(1-e)}function Ue(e,t,n=ze){let r=e-Math.floor(e),i=r>=.5,a=i?2*r-1:2*r,o=+!!i,s=i?2:1,c=i?0:2,l=i===(n===`alternating`&&(Math.floor(e)&1)==1)?-1:1,u=l*Math.PI*Ve(a),d=l*Math.PI*He(a)*2,f=.5*(X[o]+X[s]),p=.5*(Z[o]+Z[s]),m=Math.cos(u),h=Math.sin(u);for(let e=0;e<2;e++){let n=e===0?o:s,r=X[n]-f,i=Z[n]-p,a=m*r-h*i,c=h*r+m*i,l=e*6;t[l]=f+a,t[l+1]=p+c,t[l+2]=-d*c,t[l+3]=d*a,t[l+4]=d}t[12]=X[c],t[13]=Z[c],t[14]=0,t[15]=0,t[16]=0}var We=0;function Ge(e,t,n,r,i){let a=J,o=e*e+t*t,s=Math.sqrt(o),c=s>a,l=n*t-r*e,u=c?(s-a)/Le:0,d=Math.exp(-u*u),f=c?-2*u/Le*(d/s):0,p=f*t*l+d*n,m=-f*e*l+d*r,h=d*l,g=c?a*a*a/(o*s):1;p-=i*g*t,m+=i*g*e,h+=c?i*(a*a*a/s-1.5*a*a):-.5*i*o,We=h}function Ke(e,t,n,r){let i=t*6;return Ge(n-e[i],r-e[i+1],e[i+2],e[i+3],e[i+4]),We}function qe(e,t,n=ze){Ue(e,t,n);for(let e=0;e<3;e++){let n=e*6,r=0;for(let i=0;i<3;i++)i!==e&&(r+=Ke(t,i,t[n],t[n+1]));t[n+5]=r}return t}function Je(e,t,n=0){let r=J+n;for(let n=0;n<3;n++){let i=e-X[n],a=t-Z[n];if(i*i+a*a<=r*r)return!0}return!1}var Ye=128971237,Xe=Math.atan(.6180339887498949);function Ze(e,t){let n=Qe(Ye),r=Math.PI*Y*Y-3*Math.PI*J*J,i=Math.cos(Xe),a=Math.sin(Xe),o=Math.sqrt(r/e)*.997;for(;;){let r=Math.ceil(2*Y/o),s=new Float64Array(r*r),c=new Float64Array(r*r),l=0;for(let e=0;e<r;e++)for(let t=0;t<r;t++){let r=-.8+(t+n())*o,u=-.8+(e+n())*o,d=i*r-a*u,f=a*r+i*u;d*d+f*f>.8*.8||Je(d,f)||(s[l]=d,c[l]=f,l++)}if(l<e){o*=.995;continue}for(let r=0;r<e;r++){let e=r+Math.floor(n()*(l-r)),i=s[r];s[r]=s[e],s[e]=i;let a=c[r];c[r]=c[e],c[e]=a;let o=r*4;t[o]=s[r],t[o+1]=c[r],t[o+2]=s[r]<0?0:1,t[o+3]=0}return}}function Qe(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}var Q=e=>e.toFixed(6),$e=.5,et=`
uniform sampler2D uState;
uniform vec4 uRodA[6];
uniform vec2 uRodB[6];
uniform vec2 uRodEnd[3];
uniform float uDt;
uniform float uSeed;
varying vec2 vUv;

${`
const float ROD_A = ${Q(J)};
const float DRAG_W = ${Q(Le)};
const float GUARD_W = ${Q(Re)};

// one rod's drag and swirl at offset r from its centre: stream function in .x, velocity in .yz
vec3 rodField(vec2 r, vec2 v, float w) {
  float d2 = dot(r, r);
  float d = sqrt(d2);
  // drag: psi = g s, s = v x r
  float s = v.x * r.y - v.y * r.x;
  float e = max(d - ROD_A, 0.0) / DRAG_W;
  float g = exp(-e * e);
  float gpd = d > ROD_A ? (-2.0 * e / DRAG_W) * (g / d) : 0.0;
  vec2 u = vec2(gpd * r.y * s + g * v.x, -gpd * r.x * s + g * v.y);
  float psi = g * s;
  // swirl: solid-body inside, w a^3 / d^2 outside
  float a3 = ROD_A * ROD_A * ROD_A;
  float hod = d > ROD_A ? a3 / (d2 * d) : 1.0;
  u += w * hod * vec2(-r.y, r.x);
  psi += d > ROD_A ? w * (a3 / d - 1.5 * ROD_A * ROD_A) : -0.5 * w * d2;
  return vec3(psi, u);
}

// guard zone of one rod: velocity of psi = (m - 1)(others - C)
vec2 guardTerm(vec2 r, vec2 uOther, float psiRel) {
  float d = length(r);
  float t = clamp((d - ROD_A) / GUARD_W, 0.0, 1.0);
  float m = t * t * (3.0 - 2.0 * t);
  float mpd = d > 0.0 ? 6.0 * t * (1.0 - t) / (GUARD_W * d) : 0.0;
  return (m - 1.0) * uOther + psiRel * mpd * vec2(r.y, -r.x);
}

// rods: a = (x, y, vx, vy), b = (spin, C)
vec2 velocity(vec2 x, vec4 a0, vec4 a1, vec4 a2, vec2 b0, vec2 b1, vec2 b2) {
  vec2 r0 = x - a0.xy;
  vec2 r1 = x - a1.xy;
  vec2 r2 = x - a2.xy;
  vec3 f0 = rodField(r0, a0.zw, b0.x);
  vec3 f1 = rodField(r1, a1.zw, b1.x);
  vec3 f2 = rodField(r2, a2.zw, b2.x);
  vec2 u = f0.yz + f1.yz + f2.yz;
  u += guardTerm(r0, f1.yz + f2.yz, f1.x + f2.x - b0.y);
  u += guardTerm(r1, f0.yz + f2.yz, f0.x + f2.x - b1.y);
  u += guardTerm(r2, f0.yz + f1.yz, f0.x + f1.x - b2.y);
  return u;
}
`}

#define MIDPOINT_ITERATIONS 4
const float BOUND = ${Q(Ie)};
const float BLOB_R = ${Q(Y)};
const float PI = 3.14159265358979;

// "Hash without Sine" (Dave Hoskins, MIT), two rounds as IfsSim does
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

vec2 keepOut(vec2 p, vec2 c) {
  vec2 r = p - c;
  float d = length(r);
  if (d < ROD_A) p = c + (d > 1e-9 ? r * (ROD_A / d) : vec2(ROD_A, 0.0));
  return p;
}

void main() {
  vec4 s = texture2D(uState, vUv);
  vec2 x = s.xy;
  vec2 k1 = velocity(x, uRodA[0], uRodA[1], uRodA[2], uRodB[0], uRodB[1], uRodB[2]);
  vec2 xm = x + 0.5 * uDt * k1;
  for (int i = 0; i < MIDPOINT_ITERATIONS; i++) {
    vec2 k2 = velocity(xm, uRodA[3], uRodA[4], uRodA[5], uRodB[3], uRodB[4], uRodB[5]);
    xm = x + 0.5 * uDt * k2;
  }
  vec2 np = 2.0 * xm - x;

  // !(a <= b) is also true for NaN, so one test covers escaped and broken points
  if (!(abs(np.x) <= BOUND && abs(np.y) <= BOUND)) {
    vec3 hp = vec3(gl_FragCoord.xy, uSeed);
    vec3 h = hash33(hash33(hp) * 977.0 + hp.yzx);
    float rr = BLOB_R * sqrt(h.x);
    // colour 0 (warm) respawns in the left half, colour 1 in the right
    float th = PI * (h.y + (s.z < 0.5 ? 0.5 : -0.5));
    np = rr * vec2(cos(th), sin(th));
  }
  np = keepOut(np, uRodEnd[0]);
  np = keepOut(np, uRodEnd[1]);
  np = keepOut(np, uRodEnd[2]);

  gl_FragColor = vec4(np, s.z, 0.0);
}
`;`${w}${Q($e*$e)}${170 .toFixed(1)}${Q(1/16)}${Q(16)}`,`${Q(J)}`;var tt=4096,nt=.7548776662,rt=class{size;count;refAttribute;positionAttribute;renderer;read;write;scene=new e;camera=new ne(-1,1,1,-1,0,1);quad;stepUniforms={uState:{value:null},uRodA:{value:Array.from({length:6},()=>new c)},uRodB:{value:Array.from({length:6},()=>new l)},uRodEnd:{value:Array.from({length:3},()=>new l(9,9))},uDt:{value:0},uSeed:{value:0}};initUniforms={uSource:{value:null}};stepMaterial;initMaterial;uploadData;upload;freshBuilt=!1;serial=0;savedTarget=null;savedFace=0;savedMip=0;savedAutoClear=!0;savedXr=!1;savedShadowAuto=!0;disposed=!1;constructor(e,r=512){let s=e.getContext();if(typeof WebGL2RenderingContext>`u`||!(s instanceof WebGL2RenderingContext))throw Error(`The taffy puller needs WebGL 2, which this browser or GPU does not provide.`);if(!e.extensions.has(`EXT_color_buffer_float`))throw Error(`The taffy puller needs the WebGL 2 extension EXT_color_buffer_float (rendering to 32-bit float textures), which this GPU or browser does not support.`);let c=e.capabilities.maxTextureSize;if(!Number.isInteger(r)||r<1||r>c)throw Error(`TaffySim size must be an integer between 1 and ${c}, got ${r}.`);this.renderer=e,this.size=r,this.count=r*r;let l={type:t,format:a,minFilter:_,magFilter:_,wrapS:o,wrapT:o,generateMipmaps:!1,depthBuffer:!1,stencilBuffer:!1};this.read=new n(r,r,l),this.write=new n(r,r,l),this.read.texture.name=`TaffySim.stateA`,this.write.texture.name=`TaffySim.stateB`,this.uploadData=new Float32Array(this.count*4),this.upload=new i(this.uploadData,r,r,a,t),this.upload.minFilter=_,this.upload.magFilter=_,this.upload.generateMipmaps=!1,this.stepMaterial=it(`TaffySim.step`,et,this.stepUniforms),this.initMaterial=it(`TaffySim.init`,h,this.initUniforms),this.quad=new g(new y(2,2),this.initMaterial),this.quad.frustumCulled=!1,this.scene.add(this.quad);let u=new Float32Array(this.count*2);for(let e=0;e<this.count;e++)u[e*2]=(e%r+.5)/r,u[e*2+1]=(Math.floor(e/r)+.5)/r;this.refAttribute=new v(u,2),this.positionAttribute=new v(new Float32Array(this.count*3),3);try{this.validate()}catch(e){throw this.dispose(),e}}get texture(){return this.read.texture}get previousTexture(){return this.write.texture}reset(){this.disposed||(this.freshBuilt||=(Ze(this.count,this.uploadData),!0),this.upload.needsUpdate=!0,this.initUniforms.uSource.value=this.upload,this.begin(),this.pass(this.initMaterial,this.read),this.pass(this.initMaterial,this.write),this.end(),this.upload.dispose())}step(e,t,n,r){if(this.disposed)return;let i=this.stepUniforms;for(let r=0;r<3;r++){let a=r*6;i.uRodA.value[r].set(e[a],e[a+1],e[a+2],e[a+3]),i.uRodB.value[r].set(e[a+4],e[a+5]),i.uRodA.value[r+3].set(t[a],t[a+1],t[a+2],t[a+3]),i.uRodB.value[r+3].set(t[a+4],t[a+5]),i.uRodEnd.value[r].set(n[a],n[a+1])}i.uDt.value=r,i.uSeed.value=this.serial%tt*nt,this.serial++,i.uState.value=this.read.texture,this.begin(),this.pass(this.stepMaterial,this.write),this.swap(),this.end()}dispose(){this.disposed||(this.disposed=!0,this.read.dispose(),this.write.dispose(),this.upload.dispose(),this.stepMaterial.dispose(),this.initMaterial.dispose(),this.quad.geometry.dispose())}swap(){let e=this.read;this.read=this.write,this.write=e}begin(){let e=this.renderer;this.savedTarget=e.getRenderTarget(),this.savedFace=e.getActiveCubeFace(),this.savedMip=e.getActiveMipmapLevel(),this.savedAutoClear=e.autoClear,this.savedXr=e.xr.enabled,this.savedShadowAuto=e.shadowMap.autoUpdate,e.autoClear=!1,e.xr.enabled=!1,e.shadowMap.autoUpdate=!1}end(){let e=this.renderer;e.setRenderTarget(this.savedTarget,this.savedFace,this.savedMip),e.autoClear=this.savedAutoClear,e.xr.enabled=this.savedXr,e.shadowMap.autoUpdate=this.savedShadowAuto,this.savedTarget=null}pass(e,t){this.quad.material=e,this.renderer.setRenderTarget(t),this.renderer.render(this.scene,this.camera)}validate(){let e=this.renderer,t=e.getContext(),n=e.debug,r=n.checkShaderErrors,i=n.onShaderError,a=null;n.checkShaderErrors=!0,n.onShaderError=(e,n,r,i)=>{a=C(t,n,r,i)};let o=(e,t)=>{if(this.pass(e,t),a!==null)throw Error(`${e.name} shader failed to compile.\n${a}`)};this.begin();try{e.setRenderTarget(this.read);let n=t.checkFramebufferStatus(t.FRAMEBUFFER);if(n!==t.FRAMEBUFFER_COMPLETE)throw Error(`This GPU cannot render to 32-bit float textures (framebuffer status 0x${n.toString(16)}), which the taffy puller needs.`);this.upload.needsUpdate=!0,this.initUniforms.uSource.value=this.upload,o(this.initMaterial,this.read),this.stepUniforms.uState.value=this.read.texture,o(this.stepMaterial,this.write),o(this.initMaterial,this.write)}finally{this.end(),n.checkShaderErrors=r,n.onShaderError=i,this.upload.dispose()}}};function it(e,t,n){return new te({name:e,vertexShader:ee,fragmentShader:t,uniforms:n,depthTest:!1,depthWrite:!1,blending:0})}var at=10,ot=`
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uPhase;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uCur, vUv);
  vec4 p = texture2D(uPrev, vUv);
  vec2 d = c.xy - p.xy;
  vec2 xy = dot(d, d) < 0.25 ? mix(p.xy, c.xy, uPhase) : c.xy;
  // the two colours sit a hair apart in depth, so neither always paints over the other
  gl_FragColor = vec4(xy, (c.z - 0.5) * 0.004, c.z);
}
`,st=class{sim;speed=0;pulls=0;rods=new Float64Array(6);paint;out;substeps=0;carry=0;f0=new Float64Array(18);fm=new Float64Array(18);f1=new Float64Array(18);shown=new Float64Array(18);ids;constructor(e,n){this.sim=new rt(e,n),this.out=new S(e,n,ot,{uCur:{value:this.sim.texture},uPrev:{value:this.sim.previousTexture},uPhase:{value:1}}),this.ids=new Float32Array(n*n*4),Ze(n*n,this.ids),this.paint=new i(new Float32Array(n*n*4),n,n,a,t),this.paint.minFilter=_,this.paint.magFilter=_,this.reset()}get matrix(){return this.out.matrix}get texture(){return this.out.texture}get prevTexture(){return this.out.prevTexture}inks(e){let t=u(e,.3).multiplyScalar(2.2),n=u(e,.8),r=this.paint.image.data;for(let e=0;e<r.length;e+=4){let i=this.ids[e+2]<.5?n:t;r[e]=i.r,r[e+1]=i.g,r[e+2]=i.b,r[e+3]=1}this.paint.needsUpdate=!0}reset(){this.sim.reset(),this.substeps=0,this.carry=0,this.pulls=0,this.publish(1),this.out.run(),this.out.run()}update(e){if(e<=0){this.out.update(0);return}let t=this.speed*96;if(t>0){this.carry+=t*Math.min(e,.1);let n=Math.floor(this.carry);if(n>0){let e=Math.min(n,at);for(let t=0;t<e;t++){let e=this.substeps;qe(e/96,this.f0),qe((e+.5)/96,this.fm),qe((e+1)/96,this.f1),this.sim.step(this.f0,this.fm,this.f1,1/96),this.substeps=e+1}this.carry-=n}}let n=this.substeps>0?Math.min(Math.max(this.carry,0),1):1;this.publish(n),this.out.update(e)}dispose(){this.sim.dispose(),this.out.dispose(),this.paint.dispose()}publish(e){let t=this.out.uniforms;t.uCur.value=this.sim.texture,t.uPrev.value=this.sim.previousTexture,t.uPhase.value=e,this.pulls=this.substeps>0?(this.substeps-1+e)/96:0,Ue(this.pulls,this.shown);for(let e=0;e<3;e++)this.rods[e*2]=this.shown[e*6],this.rods[e*2+1]=this.shown[e*6+1]}},$=.8,ct=.02,lt=-.7,ut=3,dt=2,ft=45,pt=`
varying vec3 vN;
varying vec3 vObj;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vObj = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`,mt=`
uniform vec3 uBody;
uniform vec3 uCap;
uniform vec3 uLight;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vObj;
void main() {
  vec3 n = normalize(vN);
  float lit = 0.18 + 0.82 * max(dot(n, uLight), 0.0);
  // the end facing us glows; the shaft behind it is polished metal catching the key light
  float cap = smoothstep(0.7, 0.95, n.z);
  vec3 col = mix(uBody * lit, uCap, cap);
  gl_FragColor = vec4(col, uOpacity);
}
`,ht=e=>{let{engine:t,dust:n,rig:i,palette:a,root:o}=e,c=new st(t.renderer,e.size);c.inks(a),c.matrix.makeScale($,$,$).setPosition(0,ct,0);let l={...p(a),size:.0024,minPx:.6,gain:.3,streak:.25,tone:`seed`,toneBias:.7,toneScale:0,paint:c.paint,paintMix:1,twinkle:0},d=new s(J*$,J*$,.5,40,1).rotateX(Math.PI/2).translate(0,0,-.2),f=new te({vertexShader:pt,fragmentShader:mt,uniforms:{uBody:{value:u(a,.62).multiplyScalar(.55)},uCap:{value:u(a,.95).multiplyScalar(1.05)},uLight:{value:new r(-.55,.6,.58).normalize()},uOpacity:{value:0}},transparent:!0,toneMapped:!1}),m=[0,1,2].map(()=>{let e=new g(d,f);return e.renderOrder=2,o.add(e),e}),h=0,ee=e=>{h=e,f.uniforms.uOpacity.value=e,f.depthWrite=e>.5;for(let t of m)t.visible=e>.002};ee(0);let _=(t,n)=>{let r=h;e.tween(n,e=>ee(r+(t-r)*e),{tag:`pins`})},v=De(a,ut,dt);v.mesh.position.set(0,se+dt/2+.02,lt),o.add(v.mesh);let y=0,ne=e=>{y=e,v.opacity=e};ne(0);let S=(t,n)=>{let r=y;e.tween(n,e=>ne(r+(t-r)*e),{tag:`wall`})},C=1300,w=oe(t),T=new Pe(t.renderer,e.size),E=()=>w.speedNorm*new r().setFromMatrixColumn(w.matrix,0).length(),D=()=>({...ae(a,E()*T.rate),tone:`motion`,gain:.55}),O=D(),pe=ce(t),k=`taffy`,A=!1,j=null,M=null,N=null,P=0,me=e=>i.shot({target:[0,-.02,0],distance:2.85,azimuth:14,elevation:7,fov:38,orbit:0,aperture:.003,portrait:{distance:2.1}},e),F=e=>i.shot({target:[0,se+dt/2,lt],distance:2.8,azimuth:-5,elevation:2,fov:38,orbit:.45,aperture:.002,portrait:{distance:1.25,orbit:.2}},e),he=e=>i.shot({target:[0,-.24,0],distance:3.7,azimuth:22,elevation:12,fov:38,orbit:1.4,aperture:.003},e),I=(t=2.8)=>{k!==`taffy`&&(c.reset(),S(0,1.5)),k=`taffy`,A=!1,T.hold=0,n.morphTo(c,l,{seconds:t,swirl:.7}),e.after(t*.3,()=>k===`taffy`&&_(1,t*.6)),me(t)},L=(e=3)=>{k=`lamps`,n.morphTo(pe,{...ie(a),gain:.12},{seconds:e,swirl:.9}),_(0,1.2),S(1,e*.9),F(e+.4),j?.remove(),j=null},R=(e=2.6)=>{k=`loop`,A=!1,T.hold=0,T.rate=2,re(w),T.seed(w.texture),T.source.matrix.copy(w.matrix),O=D(),n.morphTo(T.source,O,{seconds:e,swirl:.8}),S(0,1.6),_(0,.8),he(e+.4),M?.remove(),M=null},z=t=>{k!==`loop`&&R(1.6),A=!0,e.cancel(`rate`),T.rate=2,T.findPlaces();let n=O.gain;e.tween(t,e=>{T.hold=ft*e*e,O.gain=n+(.16-n)*e},{ease:ue,tag:`hold`})},B=()=>{A=!1,e.cancel(`hold`),T.hold=0,e.tween(1.5,e=>T.rate=2-.9*e,{tag:`rate`}),N?.remove(),N=null;let t=O.gain;e.tween(3.5,e=>O.gain=t+(.55-t)*e,{ease:de,tag:`gain`})},ge=()=>{if(k!==`taffy`){I(2);return}n.setSource(n.bake(),{...n.look}),c.reset(),n.morphTo(c,l,{seconds:1.2,swirl:.3})},V=(t,n)=>{let r=c.speed;e.tween(n,e=>c.speed=r+(t-r)*e,{ease:ue,tag:`pull`})},_e=(e,t)=>t.set(c.rods[e*2]*$,c.rods[e*2+1]*$+ct,0),H=new r,U=()=>{let t=new r,n=-1/0;for(let r=0;r<128;r++){T.loopPoint(r/128,t).applyMatrix4(w.matrix);let a=t.clone().project(i.camera);(e.portrait||a.x<0)&&a.y>n&&(n=a.y,H.copy(t))}};return{enter(){n.floorY=null,t.backdrop.floor=.25,c.reset(),c.speed=0,I(3)},cues:[b(1,`Stretch`,-1.6,()=>{V(.6,.5),j=x(e)}),b(2,()=>{V(1.15,3),i.shot({distance:2.25,azimuth:8,elevation:5,portrait:{distance:1.8}},5.5)}),b(3,()=>L(3.2)),b(4,`random`,()=>{M=x(e),P=0}),b(5,()=>R(2.4)),b(6,`smallest`,()=>{z(Math.max(1.6,e.until(6,`single`)-.2)),le.sfx(`turn`,.35)}),b(6,`single loop`,()=>{U(),N=e.label(`one loop of the infinitely many inside it`,{kind:`note`,at:H.clone(),align:`above`,dy:-34,leader:!0})}),b(7,()=>i.shot({distance:3.25,elevation:16,orbit:.8},6)),b(8,`easy`,()=>{B(),le.sfx(`release`,.5),i.shot({distance:3.8,elevation:12,orbit:1.6},5)})],explore(){e.after(2.4,()=>{V(.8,1),j=x(e)})},update(e){k===`loop`&&(O.speedNorm=E()*T.rate);let t=new r;for(let e=0;e<3;e++)m[e].position.copy(_e(e,t));j?.set(`pulls ${c.pulls.toFixed(1)}`),y>0&&(C+=e,v.update(C)),M&&(P-=e,P<=0&&(P=.12,M.set(we(C).slice(0,32))))},exit(){_(0,1.2),S(0,2)},dispose(){d.dispose(),f.dispose(),v.dispose(),fe(n,c,()=>c.dispose()),fe(n,T.source,()=>T.dispose())},lab:[{kind:`choice`,label:`Machine`,options:[{value:`taffy`,label:`Taffy puller`},{value:`lamps`,label:`Lava lamps`},{value:`loop`,label:`Butterfly`}],get:()=>k,set:t=>{t!==k&&(t===`taffy`?(I(2.4),V(.8,1),j||=x(e)):t===`lamps`?(L(2.4),M||=x(e)):R(2.2))}},{kind:`slider`,label:`Pulls per second`,min:0,max:3,step:.05,get:()=>c.speed,set:t=>{e.cancel(`pull`),c.speed=t},format:e=>e.toFixed(2)},{kind:`action`,label:`Fresh taffy`,run:ge},{kind:`toggle`,label:`Hold the loop`,get:()=>A,set:e=>e?z(1.8):B()},{kind:`readout`,label:`Pulls`,get:()=>c.pulls.toFixed(1)}],notes:[`A taffy puller is three rods moving in a braid. Each pull stretches the taffy and folds it back over itself, so the number of layers grows exponentially. The braid alone guarantees a factor of at least the golden ratio, about 1.6, every pull here; after twenty pulls a stripe is at least fifteen thousand times thinner, and the real flow does better than the guarantee. The same stretch-and-fold kneads dough and mixes the fluids in microchip mixers.`,`Cloudflare’s lobby in San Francisco has a wall of about a hundred lava lamps. A camera photographs it continuously, and the noise in each picture, wax and light and passers-by, is fed into the random-number generators that make encryption keys. The key shown here is a hash of the wax you see; the real system mixes the camera’s raw pixels into a cryptographic generator.`,`Inside every strange attractor are infinitely many unstable periodic orbits. Because the motion is so sensitive, tiny corrections, applied when the path passes close to the chosen orbit, are enough to keep it there (Ott, Grebogi and Yorke, 1990). Lasers, chemical reactions, heart tissue and spacecraft trajectories have been controlled this way; the ISEE-3 probe was steered to a comet on almost no fuel.`]}};export{ht as default};