/**
 * Browser half of `pnpm tsx src/world/lenia/verify.ts --gpu`: runs the stage's real LeniaSim
 * on this page's WebGL 2 context and compares it with the CPU reference on the same 256²
 * fields. Writes one JSON object (GpuCheckResult) into <pre id="out">. Not part of the app.
 *
 *  - noise: every species, one and two generations from uniform random noise. Every cell is
 *    non-zero, so any tap, addressing or wrap-around error shows.
 *  - layout: every species from the stage's own seed (sim.seed), compared at the requested
 *    generations: field, mass, and the telemetry reduction (mass, blobs) against the CPU.
 *  - the display material compiles; one asynchronous telemetry readback lands.
 */
import * as THREE from 'three'
import { SEED_LAYOUT, countBlobs, stampPattern } from './core'
import { CpuLenia } from './cpu'
import { createDisplayMaterial } from './display'
import { LENIA_GRID } from './shaders'
import { LeniaSim } from './sim'
import { LENIA_SPECIES } from './species'

export interface GpuCheckResult {
  renderer: string
  noise: { id: string; diff1: number; diff2: number }[]
  layout: {
    id: string
    rows: { gen: number; diff: number; gpuMass: number; cpuMass: number; teleMass: number; teleBlobs: number; cpuBlobs: number }[]
  }[]
  msPerStep: number
  displayCompiled: boolean
  asyncStats: { mass: number; blobs: number } | null
  asyncExpected: { mass: number; blobs: number } | null
  error?: string
}

const N = LENIA_GRID

function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

function sum(a: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return s
}

function cpuBlobs(a: Float32Array): number {
  const n = 32
  const blocks = new Float32Array(n * n)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) blocks[(y >> 3) * n + (x >> 3)] += a[y * N + x]
  return countBlobs(blocks, n, 0.1 * 64, new Int32Array(n * n), new Int32Array(n * n))
}

async function main(): Promise<GpuCheckResult> {
  const gens = (new URLSearchParams(location.search).get('gens') ?? '1,10,100').split(',').map(Number)
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const result: GpuCheckResult = {
    renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    noise: [],
    layout: [],
    msPerStep: 0,
    displayCompiled: false,
    asyncStats: null,
    asyncExpected: null,
  }
  const sim = new LeniaSim(renderer)
  const field = new Float32Array(N * N)
  const scratch = new Float32Array(N * N * 4)

  // 1. one and two generations from noise
  for (const sp of LENIA_SPECIES) {
    let seed = 0x9e3779b9
    const cpu = new CpuLenia(N, sp)
    for (let i = 0; i < N * N; i++) {
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      cpu.A[i] = Math.fround(((t ^ (t >>> 14)) >>> 0) / 4294967296)
    }
    sim.setSpecies(sp)
    sim.load(cpu.A)
    sim.step(1)
    cpu.step()
    const diff1 = maxDiff(sim.readField(field, scratch), cpu.A)
    sim.step(1)
    cpu.step()
    const diff2 = maxDiff(sim.readField(field, scratch), cpu.A)
    result.noise.push({ id: sp.id, diff1, diff2 })
  }

  // 2. the stage's seed, compared along the way; time 100 GPU steps on the first species
  for (const sp of LENIA_SPECIES) {
    sim.setSpecies(sp)
    sim.seed(sp)
    const cpu = new CpuLenia(N, sp)
    for (const s of SEED_LAYOUT) stampPattern(cpu.A, N, sp.cells, s.x * N, s.y * N, s.turns)
    const rows: GpuCheckResult['layout'][number]['rows'] = []
    let done = 0
    for (const g of gens) {
      sim.step(g - done)
      for (; done < g; done++) cpu.step()
      const gpu = sim.readField(field, scratch)
      const st = sim.sampleStatsSync()
      rows.push({ gen: g, diff: maxDiff(gpu, cpu.A), gpuMass: sum(gpu), cpuMass: cpu.mass(), teleMass: st.mass, teleBlobs: st.blobs, cpuBlobs: cpuBlobs(cpu.A) })
    }
    result.layout.push({ id: sp.id, rows })
    if (result.msPerStep === 0) {
      sim.readField(field, scratch) // drain the queue
      const t0 = performance.now()
      sim.step(100)
      sim.readField(field, scratch)
      result.msPerStep = (performance.now() - t0) / 100
    }
  }

  // 3. the display material compiles and draws
  {
    const debug = renderer.debug
    const prevCheck = debug.checkShaderErrors
    const prevHook = debug.onShaderError
    let failed = false
    debug.checkShaderErrors = true
    debug.onShaderError = () => {
      failed = true
    }
    sim.present(0.5)
    const material = createDisplayMaterial(sim, { value: 1 })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), material)
    const scene = new THREE.Scene()
    scene.add(mesh)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(0, 0, 5.5)
    renderer.render(scene, camera)
    result.displayCompiled = !failed && gl.getError() === gl.NO_ERROR
    debug.checkShaderErrors = prevCheck
    debug.onShaderError = prevHook
    material.dispose()
    mesh.geometry.dispose()
  }

  // 4. one asynchronous readback (step first so the field is "changed")
  sim.step(1)
  const want = sum(sim.readField(field, scratch))
  result.asyncExpected = { mass: want, blobs: cpuBlobs(field) }
  if (sim.sampleStats()) {
    for (let i = 0; i < 100 && !(Math.abs(sim.stats.mass - want) < 1e-4 * want); i++) await new Promise((r) => setTimeout(r, 20))
    result.asyncStats = { ...sim.stats }
  }
  sim.dispose()
  renderer.dispose()
  return result
}

const out = document.getElementById('out')
main()
  .catch((e: unknown) => ({ error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) }))
  .then((r) => {
    if (out) out.textContent = JSON.stringify(r)
    document.title = 'lenia-gpu-check-done'
  })
