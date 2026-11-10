import{En as e,Hn as t,Mn as n,Q as r,S as i,Un as a,Vn as o,W as s,Z as c,et as l,ft as u,nt as d,pt as f,qn as p,ut as m,wn as h}from"./sources-DZb2XxHs.js";import{o as g,s as _}from"./index-p9n9GozK.js";var v=new i,y=new t,b=class extends c{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new s([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new s([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new r(t,6,1);return this.setAttribute(`instanceStart`,new l(n,3,0)),this.setAttribute(`instanceEnd`,new l(n,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new r(t,6,1);return this.setAttribute(`instanceColorStart`,new l(n,3,0)),this.setAttribute(`instanceColorEnd`,new l(n,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new p(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new i);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),v.setFromBufferAttribute(t),this.boundingBox.union(v))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new e),this.boundingBox===null&&this.computeBoundingBox();let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;if(t!==void 0&&n!==void 0){let e=this.boundingSphere.center;this.boundingBox.getCenter(e);let r=0;for(let i=0,a=t.count;i<a;i++)y.fromBufferAttribute(t,i),r=Math.max(r,e.distanceToSquared(y)),y.fromBufferAttribute(n,i),r=Math.max(r,e.distanceToSquared(y));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}};_.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new o},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},g.line={uniforms:n.merge([_.common,_.fog,_.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		float trimSegmentAlpha( const in vec4 start, const in vec4 end ) {

			// compute the interpolation factor needed to trim the segment so it terminates
			// between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column

			// we need different nearEstimate formula for reversed and default depth buffer
			// a is positive with a reversed depth buffer so it can be used for controlling the code flow
			float nearEstimate = ( a > 0.0 ) ? ( - b / ( a + 1.0 ) ) : ( - 0.5 * b / a );

			return ( nearEstimate - start.z ) / ( end.z - start.z );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef USE_DASH

				float lineDistanceStart = dashScale * instanceDistanceStart;
				float lineDistanceEnd = dashScale * instanceDistanceEnd;

			#endif

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( start, end );
					end.xyz = mix( start.xyz, end.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceEnd = mix( lineDistanceStart, lineDistanceEnd, alpha );

					#endif

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( end, start );
					start.xyz = mix( end.xyz, start.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceStart = mix( lineDistanceEnd, lineDistanceStart, alpha );

					#endif

				}

			}

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? lineDistanceStart : lineDistanceEnd;
				vUv = uv;

			#endif

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};var x=class extends h{constructor(e){super({type:`LineMaterial`,uniforms:n.clone(g.line.uniforms),vertexShader:g.line.vertexShader,fragmentShader:g.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return`WORLD_UNITS`in this.defines}set worldUnits(e){e===!0!==this.worldUnits&&(this.needsUpdate=!0),e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return`USE_DASH`in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return`USE_ALPHA_TO_COVERAGE`in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE=``:delete this.defines.USE_ALPHA_TO_COVERAGE)}},S=new a,C=new t,w=new t,T=new a,E=new a,D=new a,O=new t,k=new u,A=new d,j=new t,M=new i,N=new e,P=new a,F,I;function L(e,t,n){return P.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),P.multiplyScalar(1/P.w),P.x=I/n.width,P.y=I/n.height,P.applyMatrix4(e.projectionMatrixInverse),P.multiplyScalar(1/P.w),Math.abs(Math.max(P.x,P.y))}function R(e,n){let r=e.matrixWorld,i=e.geometry,a=i.attributes.instanceStart,o=i.attributes.instanceEnd,s=Math.min(i.instanceCount,a.count);for(let i=0,c=s;i<c;i++){A.start.fromBufferAttribute(a,i),A.end.fromBufferAttribute(o,i),A.applyMatrix4(r);let s=new t,c=new t;F.distanceSqToSegment(A.start,A.end,c,s),c.distanceTo(s)<I*.5&&n.push({point:c,pointOnLine:s,distance:F.origin.distanceTo(c),object:e,face:null,faceIndex:i,uv:null,uv1:null})}}function z(e,n,r){let i=n.projectionMatrix,a=e.material.resolution,o=e.matrixWorld,s=e.geometry,c=s.attributes.instanceStart,l=s.attributes.instanceEnd,u=Math.min(s.instanceCount,c.count),d=-n.near;F.at(1,D),D.w=1,D.applyMatrix4(n.matrixWorldInverse),D.applyMatrix4(i),D.multiplyScalar(1/D.w),D.x*=a.x/2,D.y*=a.y/2,D.z=0,O.copy(D),k.multiplyMatrices(n.matrixWorldInverse,o);for(let n=0,s=u;n<s;n++){if(T.fromBufferAttribute(c,n),E.fromBufferAttribute(l,n),T.w=1,E.w=1,T.applyMatrix4(k),E.applyMatrix4(k),T.z>d&&E.z>d)continue;if(T.z>d){let e=T.z-E.z,t=(T.z-d)/e;T.lerp(E,t)}else if(E.z>d){let e=E.z-T.z,t=(E.z-d)/e;E.lerp(T,t)}T.applyMatrix4(i),E.applyMatrix4(i),T.multiplyScalar(1/T.w),E.multiplyScalar(1/E.w),T.x*=a.x/2,T.y*=a.y/2,E.x*=a.x/2,E.y*=a.y/2,A.start.copy(T),A.start.z=0,A.end.copy(E),A.end.z=0;let s=A.closestPointToPointParameter(O,!0);A.at(s,j);let u=m.lerp(T.z,E.z,s),f=u>=-1&&u<=1,p=O.distanceTo(j)<I*.5;if(f&&p){A.start.fromBufferAttribute(c,n),A.end.fromBufferAttribute(l,n),A.start.applyMatrix4(o),A.end.applyMatrix4(o);let i=new t,a=new t;F.distanceSqToSegment(A.start,A.end,a,i),r.push({point:a,pointOnLine:i,distance:F.origin.distanceTo(a),object:e,face:null,faceIndex:n,uv:null,uv1:null})}}}var B=class extends f{constructor(e=new b,t=new x({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,i=new Float32Array(2*t.count);for(let e=0,r=0,a=t.count;e<a;e++,r+=2)C.fromBufferAttribute(t,e),w.fromBufferAttribute(n,e),i[r]=r===0?0:i[r-1],i[r+1]=i[r]+C.distanceTo(w);let a=new r(i,2,1);return e.setAttribute(`instanceDistanceStart`,new l(a,1,0)),e.setAttribute(`instanceDistanceEnd`,new l(a,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;if(r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`),n===!1&&(this.material.resolution.x===0||this.material.resolution.y===0))return;let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;F=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;I=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),N.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?I*.5:L(r,Math.max(r.near,N.distanceToPoint(F.origin)),s.resolution),N.radius+=c,F.intersectsSphere(N)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),M.copy(o.boundingBox).applyMatrix4(a);let l;l=n?I*.5:L(r,Math.max(r.near,M.distanceToPoint(F.origin)),s.resolution),M.expandByScalar(l),F.intersectsBox(M)!==!1&&(n?R(this,t):z(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(S),this.material.uniforms.resolution.value.set(S.z,S.w))}},V=[[`vertex`,`uniform float linewidth;`,`uniform float linewidth;
		uniform float lineAA;`],[`vertex`,`offset *= linewidth;`,`offset *= linewidth + lineAA;`],[`fragment`,`uniform float linewidth;`,`uniform float linewidth;
		uniform float lineAA;`],[`fragment`,`#include <clipping_planes_fragment>`,`#include <clipping_planes_fragment>
			if ( abs( vUv.y ) > 1.0 ) discard;`],[`fragment`,`#include <color_fragment>`,`#include <color_fragment>
			diffuseColor.rgb *= clamp( 0.5 * ( linewidth + lineAA ) * ( 1.0 - abs( vUv.x ) ) / lineAA, 0.0, 1.0 );`]];function H(e){let t=new x({vertexColors:!0,linewidth:e,transparent:!0,depthTest:!1,depthWrite:!1,blending:2,worldUnits:!1,toneMapped:!1});return t.uniforms.lineAA={value:1},t.onBeforeCompile=e=>{let t={vertex:e.vertexShader,fragment:e.fragmentShader};for(let[e,n]of V)if(!t[e].includes(n)){console.warn(`Trajectories: LineMaterial ${e} shader changed (missing "${n}"); using stock lines`);return}for(let[e,n,r]of V)t[e]=t[e].replace(n,r);e.vertexShader=t.vertex,e.fragmentShader=t.fragment},t.customProgramCacheKey=()=>`trajectory-line:butt-caps+aa`,t}function U(e,t){let n=e.uniforms.lineAA;n&&(n.value=1/Math.max(t,.001))}export{b as a,x as i,U as n,B as r,H as t};