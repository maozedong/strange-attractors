import{Cn as e,G as t,L as n,Mt as r,ft as i,i as a,pt as o,vt as s,wn as c,wt as l,xt as u}from"./sources-DZb2XxHs.js";var d=`
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
`,p=class{matrix=new i;uniforms;material;renderer;targets;motion;scene=new e;camera=new u(-1,1,1,-1,0,1);quad;index=0;rendered=!1;constructor(e,t,n,r,i=!1){this.renderer=e,this.motion=i,this.targets=i?[a(t),a(t)]:[a(t)],this.uniforms={...r,uSize:{value:t},uCount:{value:t*t},uTime:{value:0}},this.material=new c({vertexShader:d,fragmentShader:f+n,uniforms:this.uniforms,depthTest:!1,depthWrite:!1}),this.quad=new o(new l(2,2),this.material),this.quad.frustumCulled=!1,this.scene.add(this.quad)}get texture(){return this.targets[this.index].texture}get prevTexture(){return this.motion?this.targets[1-this.index].texture:null}render(e){this.uniforms.uTime.value=e,this.motion&&(this.index=1-this.index),this.draw(this.targets[this.index]),!this.rendered&&this.motion&&this.draw(this.targets[1-this.index]),this.rendered=!0}still(){this.rendered=!1}dispose(){for(let e of this.targets)e.dispose();this.material.dispose(),this.quad.geometry.dispose()}draw(e){let t=this.renderer,n=t.getRenderTarget(),r=t.autoClear;t.autoClear=!1,t.setRenderTarget(e),t.render(this.scene,this.camera),t.setRenderTarget(n),t.autoClear=r}};function m(e,i,a){let o=new n(a??new Float32Array(e*i*4),e,i,r,t);return o.minFilter=s,o.magFilter=s,o.generateMipmaps=!1,o.needsUpdate=!0,o}export{m as n,p as t};