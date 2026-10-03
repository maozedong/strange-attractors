import { Canvas } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { SimClock } from '../sim/SimClock'
import { Swarm } from './Swarm'
import { Trajectories } from './Trajectories'
import { FixedPoints } from './FixedPoints'
import { CameraRig } from './CameraRig'
import { Dust } from './Dust'
import { FractalStage } from './FractalStage'
import { BoxCount } from '../fractal/coast'
import { FILM } from '../film/flag'
import { FilmHook } from '../film/FilmHook'
import { useStore } from '../store'

export function Scene() {
  // origin colours sit side by side on dense sheets, so they need less gain than speed colours to stay distinct
  const colorMode = useStore((s) => s.colorMode)
  return (
    <Canvas
      frameloop={FILM ? 'never' : 'always'}
      dpr={FILM ? 1 : [1, 2]}
      camera={{ fov: 40, near: 0.02, far: 60, position: [1.1, 0.9, 2.8] }}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
      onCreated={({ gl }) => {
        gl.setClearColor('#050408', 1)
      }}
    >
      <SimClock />
      <Swarm gain={colorMode === 'origin' ? 0.018 : 0.035} />
      <Trajectories colors={['#5fc8ff', '#ff9a4a']} linewidth={1.5} />
      <FixedPoints />
      <group rotation-x={-Math.PI / 2}>
        <BoxCount />
      </group>
      <FractalStage />
      <Dust />
      <CameraRig />
      {FILM && <FilmHook />}
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.75} luminanceSmoothing={0.3} intensity={0.8} radius={0.7} />
        {/* a second, very wide and faint bloom: the subject sits in a nebula of its own light */}
        <Bloom mipmapBlur luminanceThreshold={0.12} luminanceSmoothing={0.5} intensity={0.32} radius={1.0} levels={9} />
        <Vignette offset={0.22} darkness={0.72} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Canvas>
  )
}
