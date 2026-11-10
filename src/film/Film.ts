/**
 * The director. Plays the screenplay scene by scene: starts each narration segment, fires the
 * scene's cues as their words are spoken, shows the captions, waits at gates for the visitor
 * (and acts for them if they sit back), holds the picture for a breath, and moves on.
 *
 * The clock is the film's own (engine time), nudged to the audio element while it plays, so the
 * picture follows the voice but still runs with sound off, at other speeds, or frame by frame.
 */
import * as THREE from 'three'
import type { Engine } from '../engine/Engine'
import type { Label, LabelOptions } from '../engine/Labels'
import { sound, type VoiceClip } from '../sound/audio'
import { ACTS, SCREENPLAY, lineSay, lineText, segmentStem, segmentsOf, type Act, type SceneScript, type Segment } from './screenplay'
import { useFilm } from './store'
import { easeInOut, type Cue, type Scene, type SceneContext, type SceneFactory, type StagePointer } from './types'

interface LineTiming {
  s: number
  e: number
  w: number[]
}
interface SegmentTiming {
  dur: number
  lines: LineTiming[]
}
type TimingFile = Record<string, (SegmentTiming | null)[]>

/** seconds per character when a segment has not been recorded yet */
const SECONDS_PER_CHAR = 0.068
const LINE_GAP = 0.45
/** quiet beat before a scene's first word */
const LEAD = 1.4
const CARD_SECONDS = 3.8
/** the music bed for each act: public/music/<id>.mp3 */
const MUSIC: Record<number, string> = { 0: 'storm', 1: 'storm', 2: 'water', 3: 'moss', 4: 'brass', 5: 'phosphor', 6: 'storm' }
/** how long the scene being left keeps running under the new one */
const OVERLAP = 3.2

interface Tween {
  tag?: string
  clock: number
  seconds: number
  apply: (u: number) => void
  ease: (t: number) => number
  done?: () => void
}

interface Timer {
  left: number
  fn: () => void
}

interface ResolvedCue {
  seg: number
  time: number
  fired: boolean
  run: () => void
}

interface Running {
  index: number
  script: SceneScript
  segments: Segment[]
  timing: SegmentTiming[]
  scene: Scene
  root: THREE.Group
  cues: ResolvedCue[]
  tweens: Tween[]
  timers: Timer[]
  labels: Label[]
  pointers: ((e: StagePointer) => void)[]
  /** scene clock */
  t: number
  phase: 'lead' | 'speaking' | 'gate' | 'outro' | 'done'
  phaseClock: number
  seg: number
  segTime: number
  clip: VoiceClip | null
  caption: number
  alive: boolean
}

function estimate(seg: Segment): SegmentTiming {
  let t = 0.15
  const lines = seg.lines.map((l) => {
    const say = lineSay(l)
    const s = t
    const dur = say.length * SECONDS_PER_CHAR
    const words = say.split(' ')
    const w: number[] = []
    let c = 0
    for (const word of words) {
      w.push(s + (c / Math.max(1, say.length)) * dur)
      c += word.length + 1
    }
    t = s + dur + LINE_GAP
    return { s, e: s + dur, w }
  })
  return { dur: t, lines }
}

type Loader = () => Promise<{ default: SceneFactory }>

export class Film {
  readonly engine: Engine
  private readonly loaders: Record<string, Loader>
  private readonly modules = new Map<string, Promise<SceneFactory>>()
  private timingFile: TimingFile = {}
  private cur: Running | null = null
  private leaving: { run: Running; left: number }[] = []
  private token = 0
  /** the title, shown before the film begins */
  private readonly titleFactory: SceneFactory | null
  private gestureArmed = false

  constructor(engine: Engine, loaders: Record<string, Loader>, title: SceneFactory | null = null) {
    this.engine = engine
    this.loaders = loaders
    this.titleFactory = title
    engine.onFrame((dt, _time, real) => this.update(dt, real))
    this.listen()
  }

  /** load word timings, then show the title */
  async init() {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}vo/timing.json`, { cache: 'no-cache' })
      if (r.ok) this.timingFile = (await r.json()) as TimingFile
    } catch {
      /* not recorded yet: estimated timings */
    }
    useFilm.setState({ durations: SCREENPLAY.map((s) => this.sceneSeconds(s)) })
    this.showTitle()
    // the first scene's code and voice, ahead of the click
    void this.module(SCREENPLAY[0].id)
    sound.preloadVoice(segmentStem(SCREENPLAY[0].id, 0))
  }

  get index() {
    return this.cur?.index ?? -1
  }

  get scene(): Scene | null {
    return this.cur?.scene ?? null
  }

  // ───────────── transport ─────────────

  /** start (or restart) the film at a scene */
  begin(index = 0) {
    sound.unlock()
    void this.goto(index)
  }

  toggle() {
    const s = useFilm.getState()
    if (s.status === 'playing' || s.status === 'gate') this.pause()
    else if (s.status === 'paused') this.resume()
    else if (s.status === 'ended') this.begin(0)
  }

  pause() {
    const s = useFilm.getState()
    if (s.status !== 'playing' && s.status !== 'gate') return
    this.engine.paused = true
    this.cur?.clip?.pause()
    useFilm.setState({ status: 'paused', resumeTo: s.status })
  }

  resume() {
    const s = useFilm.getState()
    if (s.status !== 'paused') return
    this.engine.paused = false
    const c = this.cur
    if (c && c.phase === 'speaking') c.clip?.play(c.segTime)
    useFilm.setState({ status: s.resumeTo ?? 'playing' })
  }

  next() {
    const i = this.index
    if (i < 0) return this.begin(0)
    if (i >= SCREENPLAY.length - 1) return this.end()
    void this.goto(i + 1)
  }

  prev() {
    const c = this.cur
    if (!c) return
    // early in a scene, go to the one before; later, restart this one
    void this.goto(c.t < 4 && c.index > 0 ? c.index - 1 : c.index)
  }

  replay() {
    if (this.cur) void this.goto(this.cur.index)
  }

  /** open the gate the film is waiting at */
  openGate() {
    const c = this.cur
    if (!c || c.phase !== 'gate') return
    const gate = c.segments[c.seg].gate
    useFilm.setState({ prompt: null, status: 'playing' })
    if (gate) c.scene.gates?.[gate.gate]?.()
    this.startSegment(c, c.seg + 1)
  }

  /** hand the scene to the visitor: narration and cues stop, the simulation keeps running */
  setLab(on: boolean) {
    const s = useFilm.getState()
    if (on === s.lab) return
    const c = this.cur
    if (on) {
      if (s.status === 'paused') this.resume()
      c?.clip?.pause()
      this.engine.rig.free = true
      useFilm.setState({ lab: true, prompt: null, caption: null })
    } else {
      this.engine.rig.free = false
      this.engine.rig.recentre(1.5)
      useFilm.setState({ lab: false })
      if (c && c.phase === 'speaking') c.clip?.play(c.segTime)
      if (c && c.phase === 'gate') useFilm.setState({ prompt: c.segments[c.seg].gate?.prompt ?? null })
    }
  }

  /** jump to a scene and play it from its first word */
  async goto(index: number) {
    const script = SCREENPLAY[index]
    if (!script) return
    const token = ++this.token
    const prev = this.cur
    const prevAct = prev ? prev.script.act : -1

    this.engine.paused = false
    this.engine.rig.free = false
    useFilm.setState({ status: 'playing', index, caption: null, prompt: null, lab: false, loading: true, started: true, slate: null })

    const factory = await this.module(script.id)
    if (token !== this.token) return

    if (prev) this.retire(prev)
    this.engine.labels.clear()
    this.engine.rig.recentre(1.4)
    this.engine.rig.track(null)

    const newAct = script.act !== prevAct
    if (newAct) {
      this.engine.setAct(script.act)
      sound.setMusic(MUSIC[script.act] ?? null)
    }

    const run = this.mount(index, script, factory)
    this.cur = run
    run.scene.enter(prev ? prev.script.id : null)

    const info = ACTS.find((a) => a.act === script.act)
    const card = newAct && script.act >= 1 && script.act <= 5 && info ? info : null
    run.phaseClock = card ? CARD_SECONDS : LEAD
    useFilm.setState({ loading: false, card, labAvailable: !!run.scene.lab?.length || !!run.scene.notes?.length })
    if (card) run.timers.push({ left: CARD_SECONDS - 0.5, fn: () => useFilm.setState({ card: null }) })

    // warm up what comes next
    for (let s = 0; s < run.segments.length; s++) sound.preloadVoice(segmentStem(script.id, s))
    const next = SCREENPLAY[index + 1]
    if (next) {
      void this.module(next.id)
      run.timers.push({ left: 6, fn: () => sound.preloadVoice(segmentStem(next.id, 0)) })
    }
  }

  // ───────────── frame ─────────────

  private update(dt: number, real: number) {
    // scenes that are leaving keep moving until their props have faded
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i]
      l.left -= real
      this.advance(l.run, dt)
      l.run.scene.update?.(dt, l.run.t)
      if (l.left <= 0) {
        this.unmount(l.run)
        this.leaving.splice(i, 1)
      }
    }

    const c = this.cur
    if (!c) return
    const state = useFilm.getState()
    const holding = state.lab || state.status === 'title' || state.status === 'ended'

    this.advance(c, dt)

    if (!holding && dt > 0) {
      if (c.phase === 'lead') {
        c.phaseClock -= dt
        if (c.phaseClock <= 0) {
          useFilm.setState({ slate: { title: c.script.title, key: c.index } })
          c.timers.push({ left: 4.2, fn: () => useFilm.getState().slate?.key === c.index && useFilm.setState({ slate: null }) })
          this.startSegment(c, 0)
        }
      } else if (c.phase === 'speaking') {
        c.t += dt
        c.segTime += dt
        // the voice is the master clock while it plays at normal speed
        const heard = c.clip?.time ?? NaN
        if (this.engine.speed === 1 && Number.isFinite(heard) && Math.abs(heard - c.segTime) > 0.12) c.segTime = heard
        this.fire(c)
        this.caption(c)
        if (c.segTime >= c.timing[c.seg].dur + 0.15) this.endSegment(c)
      } else if (c.phase === 'gate') {
        c.t += dt
        c.phaseClock -= dt
        if (c.phaseClock <= 0) this.openGate()
      } else if (c.phase === 'outro') {
        c.t += dt
        c.segTime += dt
        c.phaseClock -= dt
        this.fire(c)
        if (c.phaseClock <= 0) {
          c.phase = 'done'
          if (c.index >= SCREENPLAY.length - 1) this.end()
          else void this.goto(c.index + 1)
        }
      }
      useFilm.setState({ sceneTime: c.t })
    }

    c.scene.update?.(dt, c.t)
  }

  /** tweens and timers run on film time */
  private advance(run: Running, dt: number) {
    if (dt <= 0) return
    for (let i = run.tweens.length - 1; i >= 0; i--) {
      const tw = run.tweens[i]
      tw.clock += dt
      const u = Math.min(1, tw.clock / tw.seconds)
      tw.apply(tw.ease(u))
      if (u >= 1) {
        run.tweens.splice(run.tweens.indexOf(tw), 1)
        tw.done?.()
      }
    }
    for (let i = run.timers.length - 1; i >= 0; i--) {
      const tm = run.timers[i]
      tm.left -= dt
      if (tm.left <= 0) {
        run.timers.splice(run.timers.indexOf(tm), 1)
        tm.fn()
      }
    }
  }

  private startSegment(c: Running, seg: number) {
    if (seg >= c.segments.length) {
      c.phase = 'outro'
      c.phaseClock = c.script.outro ?? 2.5
      c.seg = c.segments.length - 1
      c.segTime = c.timing[c.seg].dur + 0.2
      this.fire(c)
      useFilm.setState({ caption: null })
      return
    }
    c.seg = seg
    c.segTime = 0
    c.caption = -1
    c.phase = 'speaking'
    c.clip?.stop()
    c.clip = sound.voice(segmentStem(c.script.id, seg))
    if (this.engine.speed === 1) c.clip.play(0)
  }

  private endSegment(c: Running) {
    c.clip?.stop()
    const gate = c.segments[c.seg].gate
    useFilm.setState({ caption: null })
    if (gate) {
      c.phase = 'gate'
      c.phaseClock = gate.timeout
      useFilm.setState({ prompt: gate.prompt, status: 'gate' })
      this.gestureArmed = false
      window.setTimeout(() => (this.gestureArmed = true), 250)
    } else {
      this.startSegment(c, c.seg + 1)
    }
  }

  private fire(c: Running) {
    for (const cue of c.cues) {
      if (cue.fired) continue
      if (cue.seg < c.seg || (cue.seg === c.seg && cue.time <= c.segTime)) {
        cue.fired = true
        cue.run()
      }
    }
  }

  private caption(c: Running) {
    const lines = c.timing[c.seg].lines
    let k = -1
    for (let i = 0; i < lines.length; i++) if (c.segTime >= lines[i].s - 0.08) k = i
    // a caption lingers a moment after its last word, unless the next has begun
    if (k >= 0 && c.segTime > lines[k].e + 1.1) k = -1
    if (k === c.caption) return
    c.caption = k
    useFilm.setState({ caption: k < 0 ? null : { text: lineText(c.segments[c.seg].lines[k]), key: `${c.index}:${c.seg}:${k}` } })
  }

  private end() {
    this.cur?.clip?.stop()
    useFilm.setState({ status: 'ended', caption: null, prompt: null })
  }

  // ───────────── scenes ─────────────

  private showTitle() {
    if (!this.titleFactory) return
    const run = this.mount(-1, { id: 'title', act: 0, title: 'Strange Attractors', lines: [] }, this.titleFactory)
    this.cur = run
    this.engine.setAct(0)
    run.scene.enter(null)
    run.phase = 'done'
    useFilm.setState({ status: 'title', index: -1 })
  }

  private module(id: string): Promise<SceneFactory> {
    let p = this.modules.get(id)
    if (!p) {
      const load = this.loaders[id]
      p = (load ? load() : Promise.reject(new Error(`no scene '${id}'`)))
        .then((m) => m.default)
        .catch((e) => {
          console.warn(`Scene '${id}' is not available:`, e)
          return this.loaders.__placeholder().then((m) => m.default)
        })
      this.modules.set(id, p)
    }
    return p
  }

  private mount(index: number, script: SceneScript, factory: SceneFactory): Running {
    const segments = segmentsOf(script)
    const timing = segments.map((seg, i) => {
      const t = this.timingFile[script.id]?.[i]
      return t && t.lines.length === seg.lines.length ? t : estimate(seg)
    })
    const root = new THREE.Group()
    root.name = `scene:${script.id}`
    this.engine.scene.add(root)
    const run: Running = {
      index,
      script,
      segments,
      timing,
      scene: null as unknown as Scene,
      root,
      cues: [],
      tweens: [],
      timers: [],
      labels: [],
      pointers: [],
      t: 0,
      phase: 'lead',
      phaseClock: LEAD,
      seg: 0,
      segTime: 0,
      clip: null,
      caption: -1,
      alive: true,
    }
    run.scene = factory(this.context(run))
    run.cues = (run.scene.cues ?? []).map((cue) => this.resolve(run, cue))
    return run
  }

  private context(run: Running): SceneContext {
    const engine = this.engine
    const film = this
    return {
      engine,
      dust: engine.dust,
      rig: engine.rig,
      renderer: engine.renderer,
      size: engine.size,
      palette: engine.palette,
      root: run.root,
      get time() {
        return run.t
      },
      get portrait() {
        return engine.rig.portrait
      },
      get lab() {
        return useFilm.getState().lab
      },
      tween(seconds, apply, opts = {}) {
        if (opts.tag) run.tweens = run.tweens.filter((t) => t.tag !== opts.tag)
        if (seconds <= 0) {
          apply(1)
          opts.done?.()
          return
        }
        run.tweens.push({ tag: opts.tag, clock: 0, seconds, apply, ease: opts.ease ?? easeInOut, done: opts.done })
      },
      cancel(tag) {
        run.tweens = run.tweens.filter((t) => t.tag !== tag)
      },
      after(seconds, fn) {
        run.timers.push({ left: seconds, fn })
      },
      label(text: string, opts: LabelOptions) {
        const l = engine.labels.add(text, opts)
        run.labels.push(l)
        return l
      },
      until(line, word) {
        return film.until(run, line, word)
      },
      onPointer(fn) {
        run.pointers.push(fn)
      },
      fade(seconds, from, to, apply) {
        apply(from)
        this.tween(seconds, (u) => apply(from + (to - from) * u))
      },
    }
  }

  /** where in the scene a cue falls: segment and seconds into it */
  private locate(run: Running, line: number, word?: string): { seg: number; time: number } | null {
    for (let s = 0; s < run.segments.length; s++) {
      const seg = run.segments[s]
      const k = line - seg.first
      if (k < 0 || k >= seg.lines.length) continue
      const lt = run.timing[s].lines[k]
      let time = lt.s
      if (word) {
        const say = lineSay(seg.lines[k]).toLowerCase()
        const text = lineText(seg.lines[k]).toLowerCase()
        const needle = word.toLowerCase()
        // look in what is spoken first, then in what is shown
        let pos = say.indexOf(needle)
        let source = say
        if (pos < 0) {
          pos = text.indexOf(needle)
          source = text
        }
        if (pos >= 0) {
          const wordIndex = source.slice(0, pos).split(' ').length - 1
          const scaled = source === say ? wordIndex : Math.round((wordIndex / Math.max(1, text.split(' ').length)) * lt.w.length)
          time = lt.w[Math.min(lt.w.length - 1, Math.max(0, scaled))] ?? lt.s
        } else if (import.meta.env.DEV) {
          console.warn(`[film] '${run.script.id}' line ${line}: phrase "${word}" not found`)
        }
      }
      return { seg: s, time }
    }
    return null
  }

  private resolve(run: Running, cue: Cue): ResolvedCue {
    const last = run.segments.length - 1
    let seg = 0
    let time = 0
    if (cue.when === 'end') {
      seg = last
      time = run.timing[last].dur + 0.2
    } else if (cue.line !== undefined) {
      const at = this.locate(run, cue.line, cue.word)
      if (at) {
        seg = at.seg
        time = at.time
      } else if (import.meta.env.DEV) {
        console.warn(`[film] '${run.script.id}': no line ${cue.line}`)
      }
    }
    return { seg, time: Math.max(0, time + (cue.offset ?? 0)), fired: false, run: cue.run }
  }

  private until(run: Running, line: number, word?: string): number {
    const at = this.locate(run, line, word)
    if (!at) return Infinity
    if (at.seg < run.seg || run.phase === 'outro' || run.phase === 'done') return Infinity
    if (run.phase === 'lead') {
      if (at.seg !== 0) return Infinity
      return run.phaseClock + at.time
    }
    if (at.seg === run.seg) {
      const d = at.time - (run.phase === 'gate' ? run.timing[run.seg].dur : run.segTime)
      return d >= 0 ? d : Infinity
    }
    // later segment: the rest of this one, the gates in between at half their patience
    let d = run.timing[run.seg].dur - run.segTime
    for (let s = run.seg; s < at.seg; s++) {
      if (s > run.seg) d += run.timing[s].dur
      d += (run.segments[s].gate?.timeout ?? 0) * 0.5
    }
    return d + at.time
  }

  /** the scene stops speaking and starts fading, but keeps running for a few seconds */
  private retire(run: Running) {
    if (!run.alive) return
    run.clip?.stop()
    run.clip = null
    run.cues = []
    run.pointers = []
    for (const l of run.labels) l.remove()
    run.labels = []
    run.scene.exit?.()
    this.leaving.push({ run, left: OVERLAP })
  }

  private unmount(run: Running) {
    if (!run.alive) return
    run.alive = false
    try {
      run.scene.dispose()
    } catch (e) {
      console.warn(e)
    }
    this.engine.scene.remove(run.root)
  }

  private sceneSeconds(script: SceneScript): number {
    const segs = segmentsOf(script)
    let total = LEAD + (script.outro ?? 2.5)
    segs.forEach((seg, i) => {
      const t = this.timingFile[script.id]?.[i]
      total += (t && t.lines.length === seg.lines.length ? t.dur : estimate(seg).dur) + (seg.gate ? seg.gate.timeout * 0.5 : 0)
    })
    return total
  }

  // ───────────── input ─────────────

  private listen() {
    const canvas = this.engine.canvas
    const rig = this.engine.rig
    let pressed = false
    let lastX = 0
    let lastY = 0
    let moved = 0
    const emit = (type: StagePointer['type'], e: PointerEvent) => {
      const c = this.cur
      const rect = canvas.getBoundingClientRect()
      const ev: StagePointer = {
        type,
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: 1 - ((e.clientY - rect.top) / rect.height) * 2,
        dx: e.clientX - lastX,
        dy: e.clientY - lastY,
        pressed,
        claim: () => {
          rig.locked = true
        },
      }
      lastX = e.clientX
      lastY = e.clientY
      if (c) for (const fn of c.pointers) fn(ev)
    }
    // capture phase, so a scene can claim the drag before the camera sees it
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        pressed = true
        moved = 0
        lastX = e.clientX
        lastY = e.clientY
        emit('down', e)
      },
      { capture: true },
    )
    canvas.addEventListener('pointermove', (e) => {
      if (pressed) moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY)
      emit('move', e)
    })
    const up = (e: PointerEvent) => {
      if (!pressed) return
      pressed = false
      emit('up', e)
      rig.locked = false
      // a click (not a drag) on the stage answers the gate
      if (moved < 6 && this.gestureArmed && useFilm.getState().status === 'gate') this.openGate()
    }
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
  }
}

export const actOf = (index: number): Act => SCREENPLAY[index]?.act ?? 0
