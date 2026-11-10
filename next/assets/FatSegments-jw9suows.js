import{J as e,T as t,Tt as n,V as r,w as i,wn as a}from"./sources-DZb2XxHs.js";import{a as o,n as s,r as c,t as l}from"./lineMaterial-BQu74erT.js";var u=()=>{},d=class{line;geometry;pos;col;capacity;materials=[];posBuf;colBuf;width;shown=0;constructor(e,t,n=20){this.capacity=e,this.width=t;let i=new o;i.setPositions(new Float32Array(e*6)),i.setColors(new Float32Array(e*6)),this.posBuf=i.getAttribute(`instanceStart`).data,this.colBuf=i.getAttribute(`instanceColorStart`).data,this.posBuf.setUsage(r),this.pos=this.posBuf.array,this.col=this.colBuf.array,i.instanceCount=0,this.geometry=i;let a=l(t);this.materials.push({m:a,k:1}),this.line=new c(i,a),this.line.frustumCulled=!1,this.line.raycast=u,this.line.renderOrder=n}get count(){return this.shown}set count(e){this.shown=Math.max(0,Math.min(this.capacity,e)),this.geometry.instanceCount=this.shown}commit(e=!1){let t=this.shown*6;t!==0&&(this.posBuf.clearUpdateRanges(),this.posBuf.addUpdateRange(0,t),this.posBuf.needsUpdate=!0,e&&this.commitColors())}commitColors(){let e=this.shown*6;e!==0&&(this.colBuf.clearUpdateRanges(),this.colBuf.addUpdateRange(0,e),this.colBuf.needsUpdate=!0)}fillColor(e,t=0,n=this.capacity){let r=this.col;for(let i=t*2;i<n*2;i++)r[i*3]=e.r,r[i*3+1]=e.g,r[i*3+2]=e.b;this.colBuf.clearUpdateRanges(),this.colBuf.needsUpdate=!0}mirror(e){let t=l(this.width);t.side=2,this.materials.push({m:t,k:e});let n=new c(this.geometry,t);return n.frustumCulled=!1,n.raycast=u,n.renderOrder=this.line.renderOrder-1,n}set opacity(e){for(let{m:t,k:n}of this.materials)t.opacity=e*n,t.uniforms.opacity.value=e*n;let t=e>5e-4;for(let{m:e}of this.materials)e.visible=t}setPixelRatio(e){for(let{m:t}of this.materials)s(t,e)}dispose(){this.geometry.dispose();for(let{m:e}of this.materials)e.dispose()}},f=`
attribute float aSize;
attribute vec3 aColor;
uniform float uDpr;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uDpr;
}
`,p=`
uniform float uOpacity;
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  // a solid bead with a soft rim and a faint halo
  float disc = 1.0 - smoothstep(0.42, 0.62, r);
  float halo = (1.0 - r) * (1.0 - r) * 0.35;
  gl_FragColor = vec4(vColor * (disc + halo) * uOpacity, 1.0);
}
`,m=class{points;pos;col;size;capacity;geometry=new t;materials=[];posAttr;colAttr;sizeAttr;constructor(e,t=22){this.capacity=e,this.pos=new Float32Array(e*3),this.col=new Float32Array(e*3),this.size=new Float32Array(e),this.posAttr=new i(this.pos,3).setUsage(r),this.colAttr=new i(this.col,3),this.sizeAttr=new i(this.size,1),this.geometry.setAttribute(`position`,this.posAttr),this.geometry.setAttribute(`aColor`,this.colAttr),this.geometry.setAttribute(`aSize`,this.sizeAttr),this.geometry.setDrawRange(0,0);let a=this.material();this.materials.push({m:a,k:1}),this.points=new n(this.geometry,a),this.points.frustumCulled=!1,this.points.raycast=u,this.points.renderOrder=t}set count(e){this.geometry.setDrawRange(0,Math.max(0,Math.min(this.capacity,e)))}commit(e=!1){this.posAttr.needsUpdate=!0,e&&(this.colAttr.needsUpdate=!0,this.sizeAttr.needsUpdate=!0)}mirror(e){let t=this.material();this.materials.push({m:t,k:e});let r=new n(this.geometry,t);return r.frustumCulled=!1,r.raycast=u,r.renderOrder=this.points.renderOrder-1,r}set opacity(e){for(let{m:t,k:n}of this.materials)t.uniforms.uOpacity.value=e*n,t.visible=e>5e-4}setPixelRatio(e){for(let{m:t}of this.materials)t.uniforms.uDpr.value=e}dispose(){this.geometry.dispose();for(let{m:e}of this.materials)e.dispose()}material(){return new a({vertexShader:f,fragmentShader:p,uniforms:{uDpr:{value:1},uOpacity:{value:1}},transparent:!0,depthTest:!1,depthWrite:!1,blending:2,toneMapped:!1})}};function h(t){let n=new e;return n.scale.y=-1,n.position.y=2*t,n}export{d as n,h as r,m as t};