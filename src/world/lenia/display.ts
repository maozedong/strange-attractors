import * as THREE from 'three'
import type { LeniaSim } from './sim'
import { displayFrag, displayVert } from './shaders'

/** The dish's material: samples `sim`'s display textures; `opacity` is its fade uniform. */
export function createDisplayMaterial(sim: LeniaSim, opacity: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Lenia.display',
    vertexShader: displayVert,
    fragmentShader: displayFrag,
    uniforms: {
      uLook: { value: sim.lookTexture },
      uHalo: { value: sim.haloTexture },
      uOpacity: opacity,
    },
    side: THREE.DoubleSide,
    // a flat plane never overlaps itself: one pass for both faces
    forceSinglePass: true,
    transparent: true,
    // push the dish back a hair so the coplanar border always wins the depth test
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}
