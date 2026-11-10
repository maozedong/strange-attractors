import{T as e,Tt as t,V as n,w as r,wn as i}from"./sources-DZb2XxHs.js";var a=10,o=`
uniform float uSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`,s=`
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float a = 1.0 - r;
  a *= a;                                      // soft halo, zero at the rim
  float core = 1.0 - smoothstep(0.0, 0.3, r);  // small bright centre
  gl_FragColor = vec4(vColor * (a * 0.6 + core * 1.2), 1.0);
  #include <colorspace_fragment>
}
`,c=class{points;position;color;constructor(c){let l=new e;this.position=new r(new Float32Array(c*3),3).setUsage(n),this.color=new r(new Float32Array(c*3),3),l.setAttribute(`position`,this.position),l.setAttribute(`aColor`,this.color),l.setDrawRange(0,0);let u=new i({uniforms:{uSize:{value:a}},vertexShader:o,fragmentShader:s,transparent:!0,depthTest:!1,depthWrite:!1,blending:2,toneMapped:!1});this.points=new t(l,u),this.points.frustumCulled=!1,this.points.renderOrder=1,this.points.visible=!1}setCount(e){this.points.geometry.setDrawRange(0,e),this.points.visible=e>0}setPosition(e,t,n,r){let i=this.position.array;i[e*3]=t,i[e*3+1]=n,i[e*3+2]=r,this.position.needsUpdate=!0}setColor(e,t){let n=this.color.array;n[e*3]=t.r,n[e*3+1]=t.g,n[e*3+2]=t.b,this.color.needsUpdate=!0}setPixelRatio(e){this.points.material.uniforms.uSize.value=a*e}dispose(){this.points.geometry.dispose(),this.points.material.dispose()}};export{c as t};