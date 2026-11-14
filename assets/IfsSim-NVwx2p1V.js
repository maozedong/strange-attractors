import{At as e,C as t,D as n,I as r,Sn as i,St as a,Un as o,Vn as s,W as c,dt as l,gt as u,o as d,s as f,xn as p,yt as m}from"./sources-DTAw6j4n.js";var h=8*Math.PI/180,g=.06;function _(e){return .12+.28*e}var v={sierpinski:{maps:[{a:.5,b:0,c:0,d:.5,e:0,f:0,p:1/3,color:1},{a:.5,b:0,c:0,d:.5,e:.5,f:0,p:1/3,color:2},{a:.5,b:0,c:0,d:.5,e:.25,f:Math.sqrt(3)/2/2,p:1/3,color:3}],frame:{cx:.4998,cy:.4295,halfW:.4935,halfH:.4295},variation:{rotation:1,scale:1},gain:.67,source:`Sierpiński (1915); the chaos game as in Barnsley, Fractals Everywhere (1988)`},fern:{maps:[{a:0,b:0,c:0,d:.16,e:0,f:0,p:.01,color:0,stem:!0},{a:.85,b:.04,c:-.04,d:.85,e:0,f:1.6,p:.85,color:2},{a:.2,b:-.26,c:.23,d:.22,e:0,f:1.6,p:.07,color:1},{a:-.15,b:.28,c:.26,d:.24,e:0,f:.44,p:.07,color:3}],frame:{cx:.2421,cy:5.1515,halfW:2.4123,halfH:4.8437},variation:{rotation:1,scale:.5},gain:.8,source:`Barnsley, Fractals Everywhere (1988), Table 3.8.3`},dragon:{maps:[{a:.5,b:-.5,c:.5,d:.5,e:0,f:0,p:.5,color:1},{a:-.5,b:-.5,c:.5,d:-.5,e:1,f:0,p:.5,color:3}],frame:{cx:.416,cy:.1673,halfW:.7439,halfH:.4955},variation:{rotation:1,scale:.3},gain:1.6,source:`Heighway dragon (Davis & Knuth, 1970); IFS form as in Edgar, Measure, Topology and Fractal Geometry`},leaf:{maps:[{a:.14,b:.01,c:0,d:.51,e:-.08,f:-1.31,p:.1,color:0,stem:!0},{a:.43,b:.52,c:-.45,d:.5,e:1.49,f:-.75,p:.35,color:1},{a:.45,b:-.49,c:.47,d:.47,e:-1.62,f:-.74,p:.35,color:2},{a:.49,b:0,c:0,d:.51,e:.02,f:1.62,p:.2,color:3}],frame:{cx:-.0425,cy:-.0357,halfW:3.1767,halfH:3.1094},variation:{rotation:1,scale:.7},gain:2.5,source:`Barnsley's maple leaf, as tabulated in Paul Bourke's IFS notes`},spiral:{maps:[{a:.787879,b:-.424242,c:.242424,d:.859848,e:1.758647,f:1.408065,p:.9,color:2},{a:-.121212,b:.257576,c:.151515,d:.05303,e:-6.721654,f:1.377236,p:.05,color:1},{a:.181818,b:-.136364,c:.090909,d:.181818,e:6.086107,f:1.568035,p:.05,color:3}],frame:{cx:-.0213,cy:4.9808,halfW:6.8591,halfH:4.4877},variation:{rotation:1,scale:.4},gain:.4,source:`Fractint's spiral.ifs, as tabulated in Paul Bourke's IFS notes`}};function y(e,t={cx:0,cy:0,halfW:1,halfH:1}){let n=v[e].frame,r=Math.max(n.halfW,n.halfH);return t.cx=0,t.cy=0,t.halfW=n.halfW/r,t.halfH=n.halfH/r,t}function b(){return{count:1,maps:new Float32Array(24),cumulative:new Float32Array(4),tones:new Float32Array(4),motion:new Float32Array(32),frame:{cx:0,cy:0,halfW:1,halfH:1}}}function x(e,t,n,r){let i=v[e],a=i.maps[t],o=i.frame,s=Math.max(o.halfW,o.halfH),c=a.a,l=a.b,u=a.c,d=a.d,f=(a.a*o.cx+a.b*o.cy+a.e-o.cx)/s,p=(a.c*o.cx+a.d*o.cy+a.f-o.cy)/s,m=E(n);if(m!==0&&!a.stem){let e=(1-c)*(1-d)-l*u,t=((1-d)*f+l*p)/e,n=(u*f+(1-c)*p)/e,r=1+g*i.variation.scale*m,a=h*i.variation.rotation*m,o=r*Math.cos(a),s=r*Math.sin(a),_=o*c-s*u,v=o*l-s*d,y=s*c+o*u,b=s*l+o*d;c=_,l=v,u=y,d=b,f=t-(c*t+l*n),p=n-(u*t+d*n)}return r.a=c,r.b=l,r.c=u,r.d=d,r.e=f,r.f=p,r}var S={a:0,b:0,c:0,d:0,e:0,f:0};function C(e,t,n=b()){let r=v[e],i=Math.min(r.maps.length,4),a=0;for(let e=0;e<i;e++)a+=r.maps[e].p;n.count=i;let o=0;for(let s=0;s<4;s++){let c=s*6,l=s*8;if(s>=i){n.maps.set(w,c),n.motion.set(T,l),n.cumulative[s]=1,n.tones[s]=_(0);continue}let u=r.maps[s],d=x(e,s,t,S);n.maps[c]=d.a,n.maps[c+1]=d.b,n.maps[c+2]=d.e,n.maps[c+3]=d.c,n.maps[c+4]=d.d,n.maps[c+5]=d.f,o+=u.p,n.cumulative[s]=s===i-1?1:o/a,n.tones[s]=_(u.color);let f=(1-d.a)*(1-d.d)-d.b*d.c,p=((1-d.d)*d.e+d.b*d.f)/f,m=(d.c*d.e+(1-d.a)*d.f)/f,h=Math.atan2(d.c-d.b,d.a+d.d),g=Math.cos(h),v=Math.sin(h),y=g*d.a+v*d.c,b=.5*(g*d.b+v*d.d+(g*d.c-v*d.a)),C=g*d.d-v*d.b;n.motion[l]=p,n.motion[l+1]=m,n.motion[l+2]=h,n.motion[l+3]=0,n.motion[l+4]=y,n.motion[l+5]=b,n.motion[l+6]=C,n.motion[l+7]=0}return y(e,n.frame),n}var w=[1,0,0,0,1,0],T=[0,0,0,0,1,0,1,0];function E(e){return Number.isFinite(e)?Math.max(-1,Math.min(1,e)):0}var D=`
vec3 speedColor(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.043, 0.114, 0.420); // #0b1d6b
  vec3 c1 = vec3(0.302, 0.247, 0.839); // #4d3fd6
  vec3 c2 = vec3(0.914, 0.416, 0.627); // #e96aa0
  vec3 c3 = vec3(1.000, 0.941, 0.784); // #fff0c8
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.35, t));
  c = mix(c, c2, smoothstep(0.35, 0.68, t));
  c = mix(c, c3, smoothstep(0.68, 1.0, t));
  return c;
}

vec3 hueColor(float h) {
  // fully saturated wheel, slightly lifted so no hue goes black; additive overlap whitens it anyway
  vec3 p = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  vec3 rgb = clamp(p - 1.0, 0.0, 1.0);
  return rgb * 0.92 + 0.08;
}

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}
`,O=.4,k=.25,A=`
#define MAP_COUNT_MAX 4
uniform sampler2D uState;
// per map two rows of [A | t]: x' = dot(uRows[2i], (x, y, 1)), y' = dot(uRows[2i + 1], (x, y, 1))
uniform vec3 uRows[2 * MAP_COUNT_MAX];
uniform float uCum[MAP_COUNT_MAX];
uniform float uTones[MAP_COUNT_MAX];
uniform float uCount;
uniform float uSeed;
// respawn rectangle: centre, half-extents
uniform vec4 uSpawn;
uniform float uBound;
varying vec2 vUv;

// "Hash without Sine" (Dave Hoskins, MIT). Stable for the small, integer-ish inputs we feed it.
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

void main() {
  vec4 s = texture2D(uState, vUv);
  // the integer texel coordinate and a small per-step seed, not vUv + time: once time reaches
  // the thousands, adding it to a 0..1 uv would round neighbouring texels to the same value
  // hash33 is symmetric in x and y to first order, so one round gives texel pairs the same
  // die forever and they collapse onto each other; a second round with the first's output
  // and a rotated input decorrelates them (measured: parity with a proper PRNG)
  vec3 hp = vec3(gl_FragCoord.xy, uSeed);
  vec3 u = hash33(hash33(hp) * 977.0 + hp.yzx);

  // roll the die: the map index is the number of cumulative thresholds u has passed
  float k = 0.0;
  for (int i = 0; i < MAP_COUNT_MAX - 1; i++) {
    if (u.x >= uCum[i]) k += 1.0;
  }
  k = min(k, uCount - 1.0);

  vec3 rowX = uRows[0];
  vec3 rowY = uRows[1];
  float tone = uTones[0];
  for (int i = 1; i < MAP_COUNT_MAX; i++) {
    if (k == float(i)) {
      rowX = uRows[2 * i];
      rowY = uRows[2 * i + 1];
      tone = uTones[i];
    }
  }

  vec3 h = vec3(s.xy, 1.0);
  vec2 np = vec2(dot(rowX, h), dot(rowY, h));
  float mapIndex = k;

  // !(x < limit) is also true for NaN and Inf, so one test covers escaped and broken points
  vec2 off = np - uSpawn.xy;
  if (!(dot(off, off) < uBound * uBound)) {
    np = uSpawn.xy + (2.0 * u.yz - 1.0) * uSpawn.zw;
    mapIndex = -1.0;
    tone = ${O.toFixed(4)};
  }

  gl_FragColor = vec4(np, mapIndex, tone);
}
`;`${D}${2500 .toFixed(1)}${260 .toFixed(1)}${k.toFixed(3)}${4 .toFixed(3)}`;var j=526141957,M=1e3,N=.7548776662,P=4096,F=class{size;count;refAttribute;positionAttribute;renderer;read;write;scene=new p;camera=new m(-1,1,1,-1,0,1);quad;stepUniforms={uState:{value:null},uRows:{value:new Float32Array(24)},uCum:{value:new Float32Array(4).fill(1)},uTones:{value:new Float32Array(4).fill(O)},uCount:{value:1},uSeed:{value:0},uSpawn:{value:new s(0,0,1,1)},uBound:{value:50}};initUniforms={uSource:{value:null}};stepMaterial;initMaterial;uploadData;upload;serial=0;savedTarget=null;savedFace=0;savedMip=0;savedAutoClear=!0;savedXr=!1;savedShadowAuto=!0;disposed=!1;constructor(i,s=512){let f=i.getContext();if(typeof WebGL2RenderingContext>`u`||!(f instanceof WebGL2RenderingContext))throw Error(`The chaos game needs WebGL 2, which this browser or GPU does not provide.`);if(!i.extensions.has(`EXT_color_buffer_float`))throw Error(`The chaos game needs the WebGL 2 extension EXT_color_buffer_float (rendering to 32-bit float textures), which this GPU or browser does not support.`);let p=i.capabilities.maxTextureSize;if(!Number.isInteger(s)||s<1||s>p)throw Error(`IfsSim size must be an integer between 1 and ${p}, got ${s}.`);this.renderer=i,this.size=s,this.count=s*s;let m={type:c,format:e,minFilter:u,magFilter:u,wrapS:n,wrapT:n,generateMipmaps:!1,depthBuffer:!1,stencilBuffer:!1};this.read=new o(s,s,m),this.write=new o(s,s,m),this.read.texture.name=`IfsSim.stateA`,this.write.texture.name=`IfsSim.stateB`,this.uploadData=new Float32Array(this.count*4),this.upload=new r(this.uploadData,s,s,e,c),this.upload.minFilter=u,this.upload.magFilter=u,this.upload.generateMipmaps=!1,this.stepMaterial=I(`IfsSim.step`,A,this.stepUniforms),this.initMaterial=I(`IfsSim.init`,d,this.initUniforms),this.quad=new l(new a(2,2),this.initMaterial),this.quad.frustumCulled=!1,this.scene.add(this.quad);let h=new Float32Array(this.count*2);for(let e=0;e<this.count;e++)h[e*2]=(e%s+.5)/s,h[e*2+1]=(Math.floor(e/s)+.5)/s;this.refAttribute=new t(h,2),this.positionAttribute=new t(new Float32Array(this.count*3),3);try{this.validate()}catch(e){throw this.dispose(),e}}get texture(){return this.read.texture}get previousTexture(){return this.write.texture}setMaps(e){let t=this.stepUniforms;t.uRows.value.set(e.maps),t.uCum.value.set(e.cumulative),t.uTones.value.set(e.tones),t.uCount.value=Math.max(1,Math.min(4,e.count)),t.uSpawn.value.set(e.frame.cx,e.frame.cy,e.frame.halfW,e.frame.halfH)}step(e){if(this.disposed)return;let t=this.stepUniforms,n=Number.isFinite(e)?Math.abs(e)%M:0;t.uSeed.value=n+this.serial%P*N,this.serial++,t.uState.value=this.read.texture,this.begin(),this.pass(this.stepMaterial,this.write),this.swap(),this.end()}scatter(e){let t=this.uploadData,n=R(j),{cx:r,cy:i,halfW:a,halfH:o}=e;for(let e=0;e<this.count;e++){let s=e*4;t[s]=r+(2*n()-1)*a,t[s+1]=i+(2*n()-1)*o,t[s+2]=-1,t[s+3]=O}this.uploadToBoth()}dispose(){this.disposed||(this.disposed=!0,this.read.dispose(),this.write.dispose(),this.upload.dispose(),this.stepMaterial.dispose(),this.initMaterial.dispose(),this.quad.geometry.dispose())}uploadToBoth(){this.disposed||(this.upload.needsUpdate=!0,this.initUniforms.uSource.value=this.upload,this.begin(),this.pass(this.initMaterial,this.read),this.pass(this.initMaterial,this.write),this.end(),this.upload.dispose())}swap(){let e=this.read;this.read=this.write,this.write=e}begin(){let e=this.renderer;this.savedTarget=e.getRenderTarget(),this.savedFace=e.getActiveCubeFace(),this.savedMip=e.getActiveMipmapLevel(),this.savedAutoClear=e.autoClear,this.savedXr=e.xr.enabled,this.savedShadowAuto=e.shadowMap.autoUpdate,e.autoClear=!1,e.xr.enabled=!1,e.shadowMap.autoUpdate=!1}end(){let e=this.renderer;e.setRenderTarget(this.savedTarget,this.savedFace,this.savedMip),e.autoClear=this.savedAutoClear,e.xr.enabled=this.savedXr,e.shadowMap.autoUpdate=this.savedShadowAuto,this.savedTarget=null}pass(e,t){this.quad.material=e,this.renderer.setRenderTarget(t),this.renderer.render(this.scene,this.camera)}validate(){let e=this.renderer,t=e.getContext(),n=e.debug,r=n.checkShaderErrors,i=n.onShaderError,a=null;n.checkShaderErrors=!0,n.onShaderError=(e,n,r,i)=>{a=L(t,n,r,i)};let o=(e,t)=>{if(this.pass(e,t),a!==null)throw Error(`${e.name} shader failed to compile.\n${a}`)};this.begin();try{e.setRenderTarget(this.read);let n=t.checkFramebufferStatus(t.FRAMEBUFFER);if(n!==t.FRAMEBUFFER_COMPLETE)throw Error(`This GPU cannot render to 32-bit float textures (framebuffer status 0x${n.toString(16)}), which the chaos game needs.`);this.upload.needsUpdate=!0,this.initUniforms.uSource.value=this.upload,o(this.initMaterial,this.read),this.stepUniforms.uState.value=this.read.texture,o(this.stepMaterial,this.write),o(this.initMaterial,this.write)}finally{this.end(),n.checkShaderErrors=r,n.onShaderError=i,this.upload.dispose()}}};function I(e,t,n){return new i({name:e,vertexShader:f,fragmentShader:t,uniforms:n,depthTest:!1,depthWrite:!1,blending:0})}function L(e,t,n,r){let i=[],a=e.getProgramInfoLog(t)?.trim();a&&i.push(`program: ${a}`);for(let[t,a]of[[`vertex`,n],[`fragment`,r]]){if(e.getShaderParameter(a,e.COMPILE_STATUS))continue;let n=e.getShaderInfoLog(a)?.trim()??``;i.push(`${t}: ${n}`);let r=/ERROR:\s*\d+:(\d+)/.exec(n),o=e.getShaderSource(a);if(r&&o){let e=Number(r[1]),t=o.split(`
`),n=Math.max(0,e-5),a=Math.min(t.length,e+2);for(let r=n;r<a;r++)i.push(`${r+1===e?`>`:` `} ${r+1}: ${t[r]}`)}}return i.join(`
`).replace(/\0/g,``)}function R(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}export{C as a,b as i,L as n,D as r,F as t};