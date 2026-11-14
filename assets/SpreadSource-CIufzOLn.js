import{At as e,I as t,Sn as n,St as r,W as i,dt as a,gt as o,i as s,ut as c,xn as l,yt as u}from"./sources-DTAw6j4n.js";var d=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,f=`
uniform float uSize;
uniform float uCount;
uniform float uTime;
varying vec2 vUv;
float particleIndex() {
  return floor(gl_FragCoord.y) * uSize + floor(gl_FragCoord.x);
}
float hashI(float i, float salt) {
  vec3 p3 = fract(vec3(i * 0.1031 + salt * 0.37, i * 0.1030 + salt * 0.71, i * 0.0973 + salt * 0.13));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`,p=class{matrix=new c;uniforms;material;renderer;targets;motion;scene=new l;camera=new u(-1,1,1,-1,0,1);quad;index=0;rendered=!1;constructor(e,t,i,o,c=!1){this.renderer=e,this.motion=c,this.targets=c?[s(t),s(t)]:[s(t)],this.uniforms={...o,uSize:{value:t},uCount:{value:t*t},uTime:{value:0}},this.material=new n({vertexShader:d,fragmentShader:f+i,uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.quad=new a(new r(2,2),this.material),this.quad.frustumCulled=!1,this.scene.add(this.quad)}get texture(){return this.targets[this.index].texture}get prevTexture(){return this.motion?this.targets[1-this.index].texture:null}render(e){this.uniforms.uTime.value=e,this.motion&&(this.index=1-this.index),this.draw(this.targets[this.index]),!this.rendered&&this.motion&&this.draw(this.targets[1-this.index]),this.rendered=!0}still(){this.rendered=!1}dispose(){for(let e of this.targets)e.dispose();this.material.dispose(),this.quad.geometry.dispose()}draw(e){let t=this.renderer,n=t.getRenderTarget(),r=t.autoClear;t.autoClear=!1,t.setRenderTarget(e),t.render(this.scene,this.camera),t.setRenderTarget(n),t.autoClear=r}};function m(n,r,a){let s=new t(a??new Float32Array(n*r*4),n,r,e,i);return s.minFilter=o,s.magFilter=o,s.generateMipmaps=!1,s.needsUpdate=!0,s}export{m as n,p as t};