import{At as e,Bn as t,C as n,I as r,O as i,Sn as a,Tn as o,W as s,_ as c,dt as l,gt as u,h as d,lt as f,q as p,w as m,wt as h}from"./sources-DTAw6j4n.js";import{a as g,n as _,t as v}from"./index-1Sq2UGtZ.js";import{n as y,t as b}from"./hud--bTLmDhT.js";import{n as ee,t as x}from"./lineMaterial-BOmqcPCM.js";import{n as S,t as te}from"./Line2-Bo-0aCxX.js";import{n as ne,t as C}from"./FragmentSource-CE49HGaK.js";var re=21.28,ie=.1,w=[.26,.19,.15],ae=.002,T=.1*Math.PI/180,E=2*Math.PI/180,D=2*Math.PI;function oe(e,t,n){return{A:(t*t+n*n)/5,B:(e*e+n*n)/5,C:(e*e+t*t)/5}}var se=oe(...w);function O(e,t){let n=e-D*Math.round(e/D),r=n+t*Math.sin(n);for(let e=0;e<16;e++){let e=(r-t*Math.sin(r)-n)/(1-t*Math.cos(r));if(r-=e,Math.abs(e)<1e-15)break}return r}function k(e,t,n){let r=O(e,t),i=Math.cos(r),a=Math.sin(r),o=1-t*i;return n[0]=(i-t)/o,n[1]=Math.sqrt(1-t*t)*a/o,n[2]=o,n[3]=3/(o*o*o),n}function ce(e,t){return[e[0]*t[0]-e[1]*t[1]-e[2]*t[2]-e[3]*t[3],e[0]*t[1]+e[1]*t[0]+e[2]*t[3]-e[3]*t[2],e[0]*t[2]-e[1]*t[3]+e[2]*t[0]+e[3]*t[1],e[0]*t[3]+e[1]*t[2]-e[2]*t[1]+e[3]*t[0]]}function A(e,t){let n=Math.hypot(e[0],e[1],e[2]),r=Math.sin(t/2)/n;return[Math.cos(t/2),e[0]*r,e[1]*r,e[2]*r]}function le(e={}){let t=e.tilt??E,n=ce(A([0,0,1],Math.PI),A([1,0,0],t));return{q:e.offset?ce(A(e.offsetAxis??[0,0,1],e.offset),n):n,w:[0,0,e.spin??1]}}var j=7,ue=class{bodies;e;A;B;C;dt;torque;steps=0;y;impulse=null;k1;k2;k3;k4;tmp;o0=new Float64Array(4);oh=new Float64Array(4);o1=new Float64Array(4);cachedStep=-1;constructor(e){let t=e.moments??se;this.bodies=e.bodies,this.e=e.e??.1,this.A=t.A,this.B=t.B,this.C=t.C,this.dt=e.dt??.002,this.torque=e.torque??!0;let n=e.bodies*j;this.y=new Float64Array(n),this.k1=new Float64Array(n),this.k2=new Float64Array(n),this.k3=new Float64Array(n),this.k4=new Float64Array(n),this.tmp=new Float64Array(n)}get t(){return this.steps*this.dt}setBody(e,t){let n=e*j,r=Math.hypot(t.q[0],t.q[1],t.q[2],t.q[3]);for(let e=0;e<4;e++)this.y[n+e]=t.q[e]/r;for(let e=0;e<3;e++)this.y[n+4+e]=t.w[e]}rewind(){this.steps=0,this.cachedStep=-1}advance(e){for(let t=0;t<e;t++)this.step()}step(){let e=this.dt,t=this.y,n=this.tmp,r=t.length,i=this.steps;this.cachedStep===i?this.o0.set(this.o1):k(i*e,this.e,this.o0),k((2*i+1)*(e/2),this.e,this.oh),k((i+1)*e,this.e,this.o1),this.cachedStep=i+1,this.deriv(this.o0,t,this.k1,e/6);for(let i=0;i<r;i++)n[i]=t[i]+e/2*this.k1[i];this.deriv(this.oh,n,this.k2,e/3);for(let i=0;i<r;i++)n[i]=t[i]+e/2*this.k2[i];this.deriv(this.oh,n,this.k3,e/3);for(let i=0;i<r;i++)n[i]=t[i]+e*this.k3[i];this.deriv(this.o1,n,this.k4,e/6);for(let n=0;n<r;n++)t[n]+=e/6*(this.k1[n]+2*this.k2[n]+2*this.k3[n]+this.k4[n]);for(let e=0;e<this.bodies;e++){let n=e*j,r=1/Math.hypot(t[n],t[n+1],t[n+2],t[n+3]);t[n]*=r,t[n+1]*=r,t[n+2]*=r,t[n+3]*=r}this.steps=i+1}deriv(e,t,n,r){let{A:i,B:a,C:o}=this,s=e[0],c=e[1],l=this.torque?e[3]:0,u=this.impulse;for(let e=0;e<this.bodies;e++){let d=e*j,f=t[d],p=t[d+1],m=t[d+2],h=t[d+3],g=t[d+4],_=t[d+5],v=t[d+6],y=2/(f*f+p*p+m*m+h*h),b=1-y*(m*m+h*h),ee=y*(p*m-f*h),x=y*(p*h+f*m),S=y*(p*m+f*h),te=1-y*(p*p+h*h),ne=y*(m*h-f*p),C=y*(p*h-f*m),re=y*(m*h+f*p),ie=1-y*(p*p+m*m),w=b*s+S*c,ae=ee*s+te*c,T=x*s+ne*c,E=l*(o-a)*ae*T,D=l*(i-o)*T*w,oe=l*(a-i)*w*ae;if(n[d+4]=(E+(a-o)*_*v)/i,n[d+5]=(D+(o-i)*v*g)/a,n[d+6]=(oe+(i-a)*g*_)/o,n[d]=-.5*(p*g+m*_+h*v),n[d+1]=.5*(f*g+m*v-h*_),n[d+2]=.5*(f*_+h*g-p*v),n[d+3]=.5*(f*v+p*_-m*g),u){let t=e*3;u[t]+=r*(b*E+ee*D+x*oe),u[t+1]+=r*(S*E+te*D+ne*oe),u[t+2]+=r*(C*E+re*D+ie*oe)}}}longAxis(e,t){let n=this.y,r=e*j,i=n[r],a=n[r+1],o=n[r+2],s=n[r+3];t[0]=1-2*(o*o+s*s),t[1]=2*(a*o+i*s),t[2]=2*(a*s-i*o)}longAxisAngle(e,t){let n=this.y,r=e*j,i=t*j,a=1-2*(n[r+2]*n[r+2]+n[r+3]*n[r+3]),o=2*(n[r+1]*n[r+2]+n[r]*n[r+3]),s=2*(n[r+1]*n[r+3]-n[r]*n[r+2]),c=1-2*(n[i+2]*n[i+2]+n[i+3]*n[i+3]),l=2*(n[i+1]*n[i+2]+n[i]*n[i+3]),u=2*(n[i+1]*n[i+3]-n[i]*n[i+2]),d=o*u-s*l,f=s*c-a*u,p=a*l-o*c;return Math.atan2(Math.hypot(d,f,p),a*c+o*l+s*u)}angularMomentum(e,t){let n=this.y,r=e*j,i=n[r],a=n[r+1],o=n[r+2],s=n[r+3],c=this.A*n[r+4],l=this.B*n[r+5],u=this.C*n[r+6];t[0]=(1-2*(o*o+s*s))*c+2*(a*o-i*s)*l+2*(a*s+i*o)*u,t[1]=2*(a*o+i*s)*c+(1-2*(a*a+s*s))*l+2*(o*s-i*a)*u,t[2]=2*(a*s-i*o)*c+2*(o*s+i*a)*l+(1-2*(a*a+o*o))*u}quaternion(e,t){let n=e*j;t[0]=this.y[n],t[1]=this.y[n+1],t[2]=this.y[n+2],t[3]=this.y[n+3]}};function de(e,t=T){e.rewind(),e.setBody(0,le()),e.bodies>1&&e.setBody(1,le({offset:t}))}function fe(e={},t=T){let n=new ue({...e,bodies:2});return de(n,t),n}function pe(e,t,n,r){let i=O(e,t);r[0]=n*(Math.cos(i)-t),r[1]=n*Math.sqrt(1-t*t)*Math.sin(i)}var M=.12,N=5;function P(e){let t=(1+Math.sqrt(5))/2,n=[],r=(e,t,r)=>{let i=Math.hypot(e,t,r);return n.push(e/i,t/i,r/i),n.length/3-1};for(let[e,n,i]of[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]])r(e,n,i);let i=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];for(let t=0;t<e;t++){let e=new Map,t=(t,i)=>{let a=t<i?t*65536+i:i*65536+t,o=e.get(a);if(o!==void 0)return o;let s=r(n[t*3]+n[i*3],n[t*3+1]+n[i*3+1],n[t*3+2]+n[i*3+2]);return e.set(a,s),s},a=[];for(let e=0;e<i.length;e+=3){let n=i[e],r=i[e+1],o=i[e+2],s=t(n,r),c=t(r,o),l=t(o,n);a.push(n,s,l,r,c,s,o,l,c,s,c,l)}i=a}return{verts:n,faces:i}}function F(e,t,n,r){let i=Math.imul(e,2376512323)^Math.imul(t,3625334849)^Math.imul(n,3407524639)^r;return i=Math.imul(i^i>>>15,739982445),i=Math.imul(i^i>>>12,695872825),i^=i>>>15,(i>>>0)/4294967295*2-1}var I=e=>e*e*e*(e*(e*6-15)+10),L=(e,t,n)=>e+(t-e)*n;function R(e,t,n,r){let i=Math.floor(e),a=Math.floor(t),o=Math.floor(n),s=I(e-i),c=I(t-a),l=I(n-o),u=(e,t,n)=>F(i+e,a+t,o+n,r);return L(L(L(u(0,0,0),u(1,0,0),s),L(u(0,1,0),u(1,1,0),s),c),L(L(u(0,0,1),u(1,0,1),s),L(u(0,1,1),u(1,1,1),s),c),l)}function me(e,t,n){return R(e*1.35+11.3,t*1.35-4.1,n*1.35+7.7,5369127)+.5*R(e*2.8-3.9,t*2.8+9.2,n*2.8+1.6,2857473)+.25*R(e*5.9+6.4,t*5.9+2.3,n*5.9-8.8,8338517)}function z(e,t,n){return R(e*7+3.1,t*7-5.3,n*7+2.2,1920827)+.5*R(e*15-1.7,t*15+4.4,n*15+9.9,6949350)}function he(){let e=[{dir:((e,t,n)=>{let r=Math.hypot(e,t,n);return[e/r,t/r,n/r]})(.35,.15,1),radius:.62,depth:.15}],t=19840101,n=()=>(t=Math.imul(t,1664525)+1013904223>>>0)/4294967296;for(let t=0;t<11;t++){let t=n()*2-1,r=n()*Math.PI*2,i=Math.sqrt(1-t*t),a=.16+.22*n();e.push({dir:[Math.cos(r)*i,Math.sin(r)*i,t],radius:a,depth:.05+.12*a})}return e}function B(e=1,t=w){let{verts:n,faces:r}=P(N),i=n.length/3,a=he(),o=new Float64Array(i),s=0;for(let e=0;e<i;e++)o[e]=me(n[e*3],n[e*3+1],n[e*3+2]),s=Math.max(s,Math.abs(o[e]));let c=new Float32Array(i*3),l=new Float32Array(i),[u,d,f]=t,p=0;for(let t=0;t<i;t++){let r=n[t*3],i=n[t*3+1],m=n[t*3+2],h=M*o[t]/s;p=Math.max(p,Math.abs(h));let g=0,_=0;for(let e of a){let t=Math.acos(Math.min(1,r*e.dir[0]+i*e.dir[1]+m*e.dir[2]))/e.radius;if(t>1.6)continue;if(t<1){let n=1-t*t;g-=e.depth*n,_=Math.max(_,n)}let n=(t-1)/.22;g+=.22*e.depth*Math.exp(-n*n)}let v=e*(1+h+g);c[t*3]=u*r*v,c[t*3+1]=d*i*v,c[t*3+2]=f*m*v;let y=.88+.08*z(r,i,m);l[t]=Math.max(.3,Math.min(1,y*(1-.42*_*_)+.06*Math.max(0,h/M)))}let m=new Uint16Array(r);if(ge(c,m).volume<0)for(let e=0;e<m.length;e+=3){let t=m[e+1];m[e+1]=m[e+2],m[e+2]=t}return{positions:c,shade:l,index:m,lumpRange:p}}function ge(e,t){let n=0,r=[0,0,0],i=[0,0,0,0,0,0,0,0,0];for(let a=0;a<t.length;a+=3){let o=t[a]*3,s=t[a+1]*3,c=t[a+2]*3,l=e[o],u=e[o+1],d=e[o+2],f=e[s],p=e[s+1],m=e[s+2],h=e[c],g=e[c+1],_=e[c+2],v=l*(p*_-m*g)-u*(f*_-m*h)+d*(f*g-p*h);n+=v/6;let y=l+f+h,b=u+p+g,ee=d+m+_;r[0]+=v/24*y,r[1]+=v/24*b,r[2]+=v/24*ee;let x=[l,u,d,f,p,m,h,g,_],S=[y,b,ee];for(let e=0;e<3;e++)for(let t=0;t<3;t++)i[e*3+t]+=v/120*(x[e]*x[t]+x[3+e]*x[3+t]+x[6+e]*x[6+t]+S[e]*S[t])}let a=[r[0]/n,r[1]/n,r[2]/n];for(let e=0;e<3;e++)for(let t=0;t<3;t++)i[e*3+t]=i[e*3+t]/n-a[e]*a[t];let o=i[0]+i[4]+i[8];return{volume:n,diagonal:[o-i[0],o-i[4],o-i[8]],offDiagonal:Math.max(Math.abs(i[1]),Math.abs(i[2]),Math.abs(i[5])),centroidOffset:Math.hypot(a[0],a[1],a[2])}}var V=.55,_e=.9,ve=1.24,H=1.525,U=1.95,W=2.025,ye=2.27,be=2.214,xe=2.32,G=(e,t,n,r)=>{let i=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)};return i(t-r,t+r,e)*(1-i(n-r,n+r,e))};function Se(e){let t=.12*G(e,ve,H,.015);t+=(.62+.3*Math.min(1,Math.max(0,(e-1.56)/.26)))*G(e,H,U,.006),t+=.05*G(e,U,W,.006);let n=.5*G(e,W,ye,.006);return n*=1-.92*Math.exp(-(((e-be)/.0045)**2)),t+=n,t+=.35*Math.exp(-(((e-xe)/.004)**2)),t}function Ce(e){let t=.3;return t+=.56*G(e,1.575,1.97,.06),t+=(.68-.3)*G(e,W,2.32,.02),t+=.3*Math.exp(-(((e-xe)/.01)**2)),t*=1+.09*Math.sin(e*97+.7)+.06*Math.sin(e*233+2.1)+.04*Math.sin(e*521+.3),t}var we=`
float ringBand(float x, float lo, float hi, float w) {
  return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x));
}
float ringOpacity(float x, float w) {
  float op = 0.12 * ringBand(x, ${ve.toFixed(4)}, ${H.toFixed(4)}, max(w, 0.015));
  op += (0.62 + 0.3 * clamp((x - 1.56) / 0.26, 0.0, 1.0)) * ringBand(x, ${H.toFixed(4)}, ${U.toFixed(4)}, max(w, 0.006));
  op += 0.05 * ringBand(x, ${U.toFixed(4)}, ${W.toFixed(4)}, max(w, 0.006));
  float a = 0.5 * ringBand(x, ${W.toFixed(4)}, ${ye.toFixed(4)}, max(w, 0.006));
  float ew = max(w, 0.0045);
  a *= 1.0 - 0.92 * (0.0045 / ew) * exp(-pow((x - ${be.toFixed(4)}) / ew, 2.0));
  op += a;
  float fw = max(w, 0.004);
  op += 0.35 * (0.004 / fw) * exp(-pow((x - ${xe.toFixed(4)}) / fw, 2.0));
  return op;
}
`,Te=`
uniform sampler2D uData;
uniform vec3 uLight;     // toward the sun, ring frame (ring in xz, pole +y)
uniform float uOmega;    // radians per second at r = 1
uniform float uTime;
varying vec2 vUv;

const float R = ${V.toFixed(5)};
const float FLAT = ${_e.toFixed(5)};

/** 1 in sunlight, 0 inside the planet's shadow (the globe is an ellipsoid: squash y to a sphere) */
float sunlit(vec3 p, vec3 l) {
  vec3 ps = vec3(p.x, p.y / FLAT, p.z);
  vec3 ls = normalize(vec3(l.x, l.y / FLAT, l.z));
  float tc = -dot(ps, ls);
  if (tc <= 0.0) return 1.0;
  float d = length(ps + tc * ls);
  return smoothstep(R * 0.975, R * 1.02, d);
}

void main() {
  vec4 d = texture2D(uData, vUv);
  if (d.x > 10.0) {
    // a star: d = (radius, azimuth, cos polar, brightness)
    float s = sqrt(1.0 - d.z * d.z);
    gl_FragColor = vec4(d.x * vec3(s * cos(d.y), d.z, s * sin(d.y)), d.w);
    return;
  }
  float th = d.y + uOmega * pow(d.x, -1.5) * uTime;
  vec3 p = vec3(d.x * cos(th), d.z, -d.x * sin(th));
  float lit = sunlit(p, uLight);
  // the sunlit face reflects; seen from the other face only the thin parts let light through
  gl_FragColor = vec4(p, d.w * mix(0.035, 1.0, lit));
}
`,K=.012;function Ee(n,i){let a=i*i,o=new Float32Array(a*4),c=1518095889,l=()=>{c=c+1831565813|0;let e=Math.imul(c^c>>>15,1|c);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296},d=()=>Math.sqrt(-2*Math.log(Math.max(1e-9,l())))*Math.cos(2*Math.PI*l()),f=8192,p=1.2,m=new Float64Array(8193);for(let e=0;e<f;e++){let t=p+(e+.5)/f*1.16,n=Se(t);m[e+1]=m[e]+n**.9*t*(t<H?.6:1)}let h=m[f],g=e=>{let t=e*h,n=0,r=f;for(;r-n>1;){let e=n+r>>1;m[e]<t?n=e:r=e}let i=(t-m[n])/Math.max(1e-12,m[r]-m[n]);return p+(n+i)/f*1.16},_=Math.floor(a*K);for(let e=0;e<a;e++){let t=e*4;if(e%Math.round(1/K)===0&&e/Math.round(1/K)<_){o[t]=26+10*l(),o[t+1]=l()*Math.PI*2,o[t+2]=l()*2-1,o[t+3]=.16+.5*l()**6;continue}let n=g(l());o[t]=n*V,o[t+1]=l()*Math.PI*2,o[t+2]=d()*.0016;let r=Ce(n)*(.94+.12*l());o[t+3]=Math.min(1,r)}let v=new r(o,i,i,e,s);v.minFilter=u,v.magFilter=u,v.needsUpdate=!0;let y=new t(-.6,.45,.6).normalize(),b=new C(n,i,Te,{uData:{value:v},uLight:{value:y},uOmega:{value:.05}});return b.run(),{source:b,light:y,dispose(){b.dispose(),v.dispose()}}}var De=`
varying vec3 vObj;
varying vec3 vN;
varying vec3 vWorldN;
varying vec3 vView;
void main() {
  vObj = position;
  vN = normalize(normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`,q=`
uniform vec3 uLight;      // toward the sun, Saturn's frame
uniform float uSun;
uniform float uOpacity;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vWorldN;
varying vec3 vView;

const float R = ${V.toFixed(5)};
${we}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

/** soft latitude bands, a pale equatorial zone, greyer blue-green poles; a little turbulence */
vec3 bands(float lat, float lon) {
  float w = lat + 0.012 * sin(lon * 5.0 + lat * 31.0) + 0.02 * (vnoise(vec2(lon * 6.0, lat * 40.0)) - 0.5);
  float b = 0.5 * sin(w * 10.0 + 0.6) + 0.3 * sin(w * 19.0 + 1.9) + 0.2 * sin(w * 37.0 + 0.4) + 0.12 * sin(w * 71.0);
  vec3 c = mix(vec3(0.9, 0.78, 0.56), vec3(0.72, 0.55, 0.35), 0.5 + 0.45 * b);
  c = mix(c, vec3(0.94, 0.85, 0.64), 0.7 * exp(-w * w / 0.01));
  c = mix(c, vec3(0.62, 0.6, 0.52), smoothstep(0.85, 1.35, abs(lat)));
  return toLinear(c);
}

void main() {
  vec3 n = normalize(vN);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.z, n.x);
  vec3 albedo = bands(lat, lon) * vec3(1.04, 0.97, 0.88);

  float ndl = dot(n, uLight);
  // a soft terminator, warmer and redder where the light grazes
  float dif = smoothstep(-0.10, 0.75, ndl);
  dif = dif * dif * (0.6 + 0.4 * dif);
  vec3 tint = mix(vec3(1.0, 0.55, 0.32), vec3(1.0), smoothstep(0.0, 0.45, ndl));
  vec3 v = normalize(vView);
  float nv = clamp(dot(normalize(vWorldN), v), 0.0, 1.0);
  float limb = 0.5 + 0.5 * pow(nv, 0.45);

  // the rings' shadow: trace toward the sun to the ring plane
  float shade = 1.0;
  float t = -vObj.y / uLight.y;
  vec2 h = vObj.xz + t * uLight.xz;
  float x = length(h) / R;
  float fw = fwidth(x);
  if (vObj.y * uLight.y < 0.0) shade = 1.0 - 0.9 * clamp(ringOpacity(x, fw), 0.0, 1.0);

  // a thin warm glow on the lit limb (haze high in the atmosphere)
  float rim = pow(1.0 - nv, 3.5) * smoothstep(-0.2, 0.3, ndl);
  // light thrown back up from the sunlit face of the rings
  float ringshine = 0.018 * max(0.0, n.y * sign(uLight.y));

  vec3 col = albedo * (uSun * dif * shade * limb * tint + ringshine + 0.004);
  col += vec3(1.0, 0.62, 0.36) * rim * 0.28 * uSun;
  gl_FragColor = vec4(col, uOpacity);
}
`;function Oe(){let e=new o(V,160,100).scale(1,_e,1),n=new a({vertexShader:De,fragmentShader:q,uniforms:{uLight:{value:new t(0,1,0)},uSun:{value:.92},uOpacity:{value:0}},toneMapped:!1}),r=new l(e,n);return r.renderOrder=1,{mesh:r,material:n,set opacity(e){J(n,e)},dispose(){e.dispose(),n.dispose()}}}function J(e,t){e.uniforms.uOpacity.value=t,e.transparent=!(t>.995),e.depthWrite=t>.4,e.visible=t>.002}var ke=.32,Y=`
attribute float aShade;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying float vShade;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vShade = aShade;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`,X=`
const float SPONGE_SCALE = ${(1/(.26*ke)).toFixed(4)};
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// distance to the nearest feature point (x) and the vector from here to it (yzw)
vec4 worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec4 best = vec4(8.0, 0.0, 0.0, 0.0);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + hash3(i + g) - f;
    float d = dot(r, r);
    if (d < best.x) best = vec4(d, r);
  }
  best.x = sqrt(best.x);
  return best;
}
// one size of round bowls: height (x) and its gradient (yzw), in the noise's own units
vec4 bowls(vec3 q, float R) {
  vec4 w = worley(q);
  float x = min(w.x / R, 1.0);
  float h = sqrt(1.0 - x * x);
  vec3 dF = -w.yzw / max(w.x, 1e-4);
  return vec4(h, (-x / (R * max(h, 0.18))) * dF);
}
// packed bowls with steep walls and sharp rims, two sizes: height and its gradient in object units
vec4 sponge(vec3 p) {
  vec3 q = p * SPONGE_SCALE;
  vec4 a = bowls(q * 2.6, 0.66);
  vec4 b = bowls(q * 6.5 + 7.3, 0.55);
  return vec4(0.75 * a.x + 0.25 * b.x, (0.75 * 2.6 * a.yzw + 0.25 * 6.5 * b.yzw) * SPONGE_SCALE);
}
`,Ae=`
uniform vec3 uLight;     // toward the sun, world
uniform vec3 uFillDir;   // toward Saturn, world
uniform vec3 uAlbedo;
uniform vec3 uFill;
uniform float uSun;
uniform float uBump;
uniform float uOpacity;
uniform mat3 uRot;     // the body's turn, object → world
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying float vShade;
${X}

void main() {
  vec4 sp = sponge(vObj);
  float h = sp.x;
  // bump: the height's gradient in the body's own space, turned into the world
  vec3 g = uRot * sp.yzw;
  vec3 n = normalize(vN);
  // g is the gradient of depth: the surface tilts down into each bowl
  n = normalize(n + uBump * (g - dot(g, n) * n));

  float ndl = dot(n, uLight);
  // a rough, dusty surface: light falls off more gently than Lambert near the terminator
  float dif = pow(clamp((ndl + 0.12) / 1.12, 0.0, 1.0), 1.2);
  // crater floors are darker than the rims
  float cavity = mix(1.0, 0.62, h);
  vec3 alb = uAlbedo * vShade * cavity;
  vec3 col = alb * (uSun * dif + uFill * max(dot(n, uFillDir), 0.0) + vec3(0.006));
  gl_FragColor = vec4(col, uOpacity);
}
`,Z=`
uniform vec3 uLight;
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
varying float vShade;
${X}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWorld);
  float nv = abs(dot(n, v));
  float rim = pow(1.0 - nv, 2.2);
  float lit = 0.5 + 0.5 * dot(n, uLight);
  float h = sponge(vObj).x;
  float body = (0.08 + 0.3 * lit * lit) * mix(1.0, 0.45, h) * vShade;
  gl_FragColor = vec4(uColor * (body + 1.1 * rim) * uOpacity, 1.0);
}
`;function je(){let e=B(ke),r=new m;r.setAttribute(`position`,new n(e.positions,3)),r.setIndex(new n(e.index,1)),r.setAttribute(`aShade`,new n(e.shade,1)),r.computeVertexNormals(),r.computeBoundingSphere();let o=new t(0,1,0),s=new a({vertexShader:Y,fragmentShader:Ae,uniforms:{uLight:{value:o},uFillDir:{value:new t(1,0,0)},uAlbedo:{value:new i(.44,.33,.24)},uFill:{value:new i(.05,.035,.02)},uSun:{value:1.35},uBump:{value:.0026},uRot:{value:new f},uOpacity:{value:0}},toneMapped:!1}),c=new a({vertexShader:Y,fragmentShader:Z,uniforms:{uLight:{value:o},uColor:{value:new i},uOpacity:{value:0}},transparent:!0,depthWrite:!1,blending:2,toneMapped:!1}),u=new l(r,s),d=new l(r,c);return u.renderOrder=2,d.renderOrder=12,d.visible=!1,{moon:u,ghost:d,light:o,moonMaterial:s,ghostMaterial:c,set moonOpacity(e){J(s,e)},set ghostOpacity(e){c.uniforms.uOpacity.value=e,d.visible=e>.002},dispose(){r.dispose(),s.dispose(),c.dispose()}}}var Me=Math.PI*2,Ne=Math.PI/180,Pe=2.05,Fe=-128*Ne,Ie=260,Le=-.26,Re=()=>({target:new t,distance:4,azimuth:0,elevation:15,fov:38,aperture:.002}),ze=e=>{let{engine:n,dust:r,rig:i,palette:a,root:o}=e,s=new p;o.add(s);let l=Oe();s.add(l.mesh);let u=je();o.add(u.moon,u.ghost),u.ghostMaterial.uniforms.uColor.value.copy(c(a,.3)).multiplyScalar(2);let f=Ee(n.renderer,e.size),m={...d(a),size:.0036,minPx:.6,gain:.3,streak:.25,tone:`aux`,toneBias:.04,toneScale:.9,twinkle:0},C=new h().setFromAxisAngle(new t(0,1,0),Fe),w=new h().setFromAxisAngle(new t(1,0,0),-Math.PI/2),T=[];{let e=ie,n=Pe*Math.sqrt(1-e*e),r=new t;for(let t=0;t<=512;t++){let i=t/512*Me;r.set(Pe*(Math.cos(i)-e),0,-n*Math.sin(i)).applyQuaternion(C),T.push(r.x,r.y,r.z)}}let E=new S;E.setPositions(T);let D=x(1.1);D.vertexColors=!1,D.depthTest=!0;let oe=c(a,.7),se=new te(E,D);se.frustumCulled=!1,se.renderOrder=3,o.add(se);let O=0,k=e=>{O=e,D.color.copy(oe).multiplyScalar(.32*e),se.visible=e>.002};k(0);let ce=.26*ke*1.75,A=new S;A.setPositions([-ce,0,0,ce,0,0]);let le=[c(a,.86).multiplyScalar(.9),c(a,.3).multiplyScalar(1.6)],j=le.map(()=>{let e=x(1.3);return e.vertexColors=!1,e.depthTest=!0,e}),ue=j.map(e=>{let t=new te(A,e);return t.frustumCulled=!1,t.renderOrder=13,t});u.moon.add(ue[0]),u.ghost.add(ue[1]);let M=0,N=e=>{M=e,j[0].color.copy(le[0]).multiplyScalar(e*$),j[1].color.copy(le[1]).multiplyScalar(e*$*Q),ue[0].visible=e*$>.002},P=fe(),F=0,I=.1,L=!1,R=!1,me=new Float64Array(2),z=new Float64Array(4),he=new h,B=new t,ge=new t,V=new t,_e=new t,ve=new t,H=new t,U=()=>P.t/Me,W=()=>{pe(P.t,ie,Pe,me),B.set(me[0],0,-me[1]).applyQuaternion(C),u.moon.position.copy(B),P.quaternion(0,z),u.moon.quaternion.copy(C).multiply(w).multiply(he.set(z[1],z[2],z[3],z[0]));let e=be(i.camera);ge.copy(B).addScaledVector(e,Le*Q),u.ghost.position.copy(ge),_e.setFromMatrixPosition(i.camera.matrixWorld),ve.subVectors(B,_e).normalize(),H.subVectors(ge,_e).normalize(),P.quaternion(1,z),u.ghost.quaternion.setFromUnitVectors(ve,H).multiply(C).multiply(w).multiply(he.set(z[1],z[2],z[3],z[0])),V.copy(B).addScaledVector(e,.5*Le*Q)},ye=new t,be=e=>ye.setFromMatrixColumn(e.matrixWorld,0).normalize(),xe=()=>{de(P),F=0,L=!1,e.cancel(`orbits`),W()},G=new t(-.6,.45,.6).normalize(),Se=new t,Ce=new t,we=new t,Te=new h,K=new t,De=e=>{let t=i.camera.matrixWorld;return Se.setFromMatrixColumn(t,0),Ce.setFromMatrixColumn(t,1),we.setFromMatrixColumn(t,2),e.set(0,0,0).addScaledVector(Se,-.72).addScaledVector(Ce,.5).addScaledVector(we,.48),e.y=Math.max(e.y,.32*e.length()),e.normalize()},q=Re(),J=Re(),Y=Re(),X=18,Ae={distance:4.7,elevation:17,orbit:1.1},Z={distance:.56,elevation:10,side:-34,up:0,pull:0},ze=0,Q=0,Be=!1,Ve=new t,He=new t,Ue=new t,We=new t(0,1,0),Ge=t=>{Be&&(X+=t*Ae.orbit),q.target.set(0,-.14,0),q.distance=Ae.distance*(e.portrait?.66:1),q.azimuth=X,q.elevation=Ae.elevation,q.fov=38,q.aperture=.0015},Ke=()=>{Ve.copy(B).setY(0).normalize(),He.crossVectors(We,Ve);let e=Z.side*Ne,t=Z.elevation*Ne;Ue.copy(Ve).multiplyScalar(Math.cos(e)).addScaledVector(He,-Math.sin(e)).multiplyScalar(Math.cos(t)).addScaledVector(We,Math.sin(t)),J.target.copy(V).multiplyScalar(1-Z.pull),J.target.y+=Z.up,J.distance=Z.distance,J.azimuth=Math.atan2(Ue.x,Ue.z)/Ne,J.elevation=Math.asin(Math.max(-1,Math.min(1,Ue.y)))/Ne,J.fov=38,J.aperture=.0022},qe=e=>{let t=e;Y.target.lerpVectors(q.target,J.target,t),Y.distance=Math.exp(Math.log(q.distance)+(Math.log(J.distance)-Math.log(q.distance))*t);let n=J.azimuth-q.azimuth;n=((n+180)%360+360)%360-180,Y.azimuth=q.azimuth+n*t,Y.elevation=q.elevation+(J.elevation-q.elevation)*t,Y.fov=q.fov+(J.fov-q.fov)*t,Y.aperture=q.aperture+(J.aperture-q.aperture)*t,e>.999&&(X=J.azimuth)},Je=t=>e.tween(t,e=>ze=e,{ease:_,tag:`cam`}),Ye=t=>{let n=ze;e.tween(t,e=>ze=n*(1-e),{ease:_,tag:`cam`})},Xe=(t,n)=>{let r={...Z};e.tween(n,e=>{for(let n of Object.keys(t))Z[n]=r[n]+((t[n]??r[n])-r[n])*e},{ease:_,tag:`ride`})},Ze=null,Qe=null,$=0,$e=e=>{$=e,l.opacity=e,u.moonOpacity=e},et=(t,n=1.2)=>{R=t;let r=Q;e.tween(n,e=>{Q=r+(+!!t-r)*e,u.ghostOpacity=Q*$},{ease:_,tag:`twin`})},tt=()=>{Qe||=y(e)};return{enter(){r.floorY=null,n.backdrop.floor=0,n.backdrop.level=.55,f.source.run(),r.morphTo(f.source,m,{seconds:3.2,swirl:.9}),$e(0),e.after(.9,()=>e.fade(2.4,0,1,$e)),W(),Ge(0),i.shot({target:[0,-.14,0],distance:Ae.distance,azimuth:X,elevation:Ae.elevation,fov:38,orbit:0,aperture:.0015},2.8),e.after(2.8,()=>Be=!0)},cues:[v(1,()=>{Be=!0,Je(3.4),Ze=b(e,`Hyperion`,`360 × 266 × 205 km`)}),v(2,()=>{I=Math.min(.4,Math.max(.12,(3.9-U())/Math.max(1,e.until(4))))}),v(3,()=>{Ze?.remove(),Ze=null,Xe({distance:3,elevation:36,side:-48,pull:.45},3.4),e.fade(2,O,1,k)}),v(4,()=>{I=Math.max(.03,(4.15-U())/Math.max(1,e.until(5))),et(!0,1.4),e.fade(1.4,M,1,N),g.sfx(`split`,.45),Xe({distance:.74,elevation:12,side:-28,pull:0},3),e.fade(2,O,.35,k)}),v(5,()=>{tt(),g.sfx(`rise`,.5),L=!0;let t=F;e.tween(Math.max(1.6,e.until(6)+1.1),e=>F=t+(8-t)*e,{ease:_,tag:`orbits`,done:()=>{L=!1,I=.05}})}),v(7,()=>{Ye(5.5),e.fade(3,O,.8,k)})],explore(){L=!1,I=.5,e.after(2.6,()=>{et(!0,.8),tt(),e.fade(.8,M,1,N)})},update(t){!L&&(e.time>0||e.lab)&&(F+=t*I);let r=Math.floor(F*Me/ae),a=Math.min(Ie,Math.max(0,r-P.steps));a>0&&P.advance(a),r-P.steps>Ie*4&&(F=U()),Ge(t),W(),Ke(),qe(ze),Be&&i.shot({target:[Y.target.x,Y.target.y,Y.target.z],distance:Y.distance,azimuth:Y.azimuth,elevation:Y.elevation,fov:Y.fov,aperture:Y.aperture,orbit:0},0),De(G),u.light.copy(G),u.moonMaterial.uniforms.uFillDir.value.copy(B).negate().normalize(),u.moon.updateMatrixWorld(),u.moonMaterial.uniforms.uRot.value.setFromMatrix4(u.moon.matrixWorld),s.updateMatrixWorld(),Te.copy(s.quaternion).invert(),l.material.uniforms.uLight.value.copy(G).applyQuaternion(Te),f.light.copy(G).applyQuaternion(Te),f.source.matrix.copy(s.matrixWorld),K.setFromMatrixPosition(i.camera.matrixWorld).applyQuaternion(Te);let o=Math.abs(K.y)/Math.max(.001,K.length());m.gain=.3*Math.min(1,Math.max(.1,o/.3));for(let e of[D,...j])ee(e,n.renderer.getPixelRatio());if((R||Q>0)&&(u.ghostOpacity=Q*$),N(M),Qe){let e=U()*re,t=P.longAxisAngle(0,1)*180/Math.PI;Qe.set(`day ${e.toFixed(0)} apart by ${t<10?t.toFixed(1):t.toFixed(0)}°`)}},exit(){n.backdrop.level=1,e.fade(2.2,$,0,$e),e.fade(1.6,Q,0,e=>u.ghostOpacity=e*$),e.fade(1.6,O,0,k),e.fade(1.6,M,0,N),Be=!1},dispose(){l.dispose(),u.dispose(),E.dispose(),D.dispose(),A.dispose();for(let e of j)e.dispose();ne(r,f.source,()=>f.dispose())},lab:[{kind:`slider`,label:`Orbits per second`,min:0,max:1.5,step:.01,get:()=>I,set:t=>{L=!1,e.cancel(`orbits`),I=t},format:e=>e.toFixed(2)},{kind:`toggle`,label:`Show the copy`,get:()=>R,set:t=>{et(t,.8),t&&(tt(),e.fade(.8,M,1,N))}},{kind:`choice`,label:`Camera`,options:[{value:`saturn`,label:`Saturn`},{value:`moon`,label:`Ride with the moon`}],get:()=>ze>.5?`moon`:`saturn`,set:e=>{Be=!0,e===`moon`?(Xe({distance:R?.74:.56,elevation:12,side:-30,pull:0},1.5),Je(2.5)):Ye(2.5)}},{kind:`action`,label:`Start over`,run:xe},{kind:`readout`,label:`Days`,get:()=>(U()*re).toFixed(0)},{kind:`readout`,label:`Twins apart`,get:()=>`${(P.longAxisAngle(0,1)*180/Math.PI).toFixed(2)}°`}],notes:[`Hyperion is about 360 by 266 by 205 kilometres, a porous rubble pile with the density of snow. Its orbit is stretched (eccentricity 0.1) and nearly synchronous moons nearby keep it from settling, so Saturn’s tidal pull on its long axis changes from pass to pass. Jack Wisdom, Stanton Peale and François Mignard predicted in 1984 that it should tumble chaotically; Voyager 2 and later Cassini found it doing exactly that.`,`Here the moon is a rigid body turned by Saturn’s gravity gradient, integrated with fourth-order Runge–Kutta. Its twin starts turned a tenth of a degree about the orbit’s axis. The gap between them grows by a factor of about e every orbit (21 days), so within half a year they share nothing but their orbit.`,`The rings are made of the same dust as everything else: each particle orbits at its own Kepler speed, at radii drawn from the real profile of the C, B and A rings, the Cassini division and the Encke gap. The planet and the moons are not to scale; the rings, relative to the planet, are.`]}};export{ze as default};