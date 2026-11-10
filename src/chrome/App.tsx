import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Engine } from '../engine/Engine'
import { Film } from '../film/Film'
import { ACTS, SCREENPLAY } from '../film/screenplay'
import { setCaptions, useFilm } from '../film/store'
import type { LabControl } from '../film/types'
import { SCENE_LOADERS } from '../scenes'
import titleScene from '../scenes/title'
import { sound } from '../sound/audio'
import { Icon } from './icons'

const PROGRESS_KEY = 'strange-attractors:scene'

let film: Film | null = null

function savedScene(): number {
  try {
    const id = localStorage.getItem(PROGRESS_KEY)
    const i = SCREENPLAY.findIndex((s) => s.id === id)
    return i > 0 ? i : 0
  } catch {
    return 0
  }
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useSound() {
  return useSyncExternalStore(
    (fn) => sound.onChange(fn),
    () => `${sound.state}:${sound.muted}`,
  )
}

export default function App() {
  const host = useRef<HTMLDivElement>(null)
  const status = useFilm((s) => s.status)
  const error = useFilm((s) => s.error)
  const lab = useFilm((s) => s.lab)
  const indexOpen = useFilm((s) => s.indexOpen)
  const [idle, setIdle] = useState(false)
  const [resumeAt] = useState(savedScene)

  // the engine and the film are made once, outside React's render cycle
  useEffect(() => {
    if (film || !host.current) return
    try {
      const engine = new Engine(host.current)
      film = new Film(engine, SCENE_LOADERS, titleScene)
      sound.arm()
      engine.start()
      void film.init().then(() => {
        useFilm.setState({ ready: true })
        // development and capture: ?scene=<id> starts there at once, ?speed=3 runs the film clock faster (silent)
        const q = new URLSearchParams(window.location.search)
        const speed = Number(q.get('speed'))
        if (speed > 0) engine.speed = speed
        const at = SCREENPLAY.findIndex((s) => s.id === q.get('scene'))
        if (at >= 0) film?.begin(at)
      })
      const w = window as unknown as Record<string, unknown>
      w.strangeAttractors = { film, engine, sound, state: useFilm }
    } catch (e) {
      useFilm.setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  // remember where the visitor got to
  useEffect(
    () =>
      useFilm.subscribe((s, p) => {
        if (s.index === p.index || s.index < 0) return
        try {
          localStorage.setItem(PROGRESS_KEY, SCREENPLAY[s.index].id)
        } catch {
          /* private mode */
        }
      }),
    [],
  )

  // the lab drawer takes the right of the screen: keep the subject in what is left
  useEffect(() => {
    if (!film) return
    const wide = window.innerWidth > 720
    film.engine.rig.offsetX = lab && wide ? 170 : 0
    film.engine.rig.offsetY = lab && !wide ? window.innerHeight * 0.2 : 0
  }, [lab])

  // while the film plays untouched, the interface gets out of the way
  useEffect(() => {
    let last = performance.now()
    const wake = () => {
      last = performance.now()
      setIdle(false)
    }
    // checked on a clock rather than once per gesture, so it also hides when the film was started
    // and then simply left alone
    const tick = window.setInterval(() => {
      const s = useFilm.getState()
      setIdle(performance.now() - last > 3200 && s.status === 'playing' && !s.lab && !s.indexOpen)
    }, 400)
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { passive: true })
    return () => {
      window.clearInterval(tick)
      for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, wake)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey || e.altKey || !film) return
      const s = useFilm.getState()
      const key = e.key.toLowerCase()
      if (key === 'escape') {
        if (s.indexOpen) useFilm.setState({ indexOpen: false, indexExplore: false })
        else if (s.lab) film.setLab(false)
        return
      }
      if (s.indexOpen) return
      if (key === ' ' || key === 'enter') {
        if (el && el.tagName === 'BUTTON') return
        e.preventDefault()
        if (s.status === 'title') film.begin(0)
        else if (s.status === 'gate') film.openGate()
        else film.toggle()
      } else if (key === 'arrowright') film.next()
      else if (key === 'arrowleft') film.prev()
      else if (key === 'c') setCaptions(!s.captions)
      else if (key === 'm') sound.setMuted(!sound.muted)
      else if ((key === 'e' || key === 'l') && s.status !== 'title' && s.status !== 'ended') film.setLab(!s.lab)
      else if (key === 's') useFilm.setState({ indexOpen: true })
      else if (key === 'f') toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const playing = status !== 'title' && status !== 'ended'

  return (
    <div className={`film${idle && playing && !lab ? ' is-idle' : ''}${lab ? ' is-lab' : ''}`} ref={host}>
      <div className="over">
        {error ? (
          <Unsupported reason={error} />
        ) : (
          <>
            {status === 'title' && <Start resumeAt={resumeAt} />}
            {playing && <Stage />}
            {playing && <Bar />}
            {status === 'ended' && <End />}
            {lab && <Lab />}
            {indexOpen && <SceneIndex />}
            {playing && <SoundNotice />}
          </>
        )}
      </div>
    </div>
  )
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.().catch(() => undefined)
}

function Start({ resumeAt }: { resumeAt: number }) {
  const ready = useFilm((s) => s.ready)
  const durations = useFilm((s) => s.durations)
  const minutes = Math.round(durations.reduce((a, b) => a + b, 0) / 60) || 16
  return (
    <section className="start" aria-label="Strange Attractors">
      <h1 className="sr-only">Strange Attractors</h1>
      <p className="start__what">A film about chaos, fractals and the order that appears from nothing. Every point of light is computed as you watch.</p>
      <div className="start__ways">
        <div className="way">
          <button className="begin begin--main" onClick={() => film?.begin(0, false)} disabled={!ready} autoFocus>
            Watch the film
          </button>
          <span>{minutes} minutes, narrated. Best with sound.</span>
        </div>
        <div className="way">
          <button className="begin" onClick={() => useFilm.setState({ indexOpen: true, indexExplore: true })} disabled={!ready}>
            Explore on your own
          </button>
          <span>Every scene, with its dials in your hands.</span>
        </div>
      </div>
      {resumeAt > 0 && (
        <div className="start__more">
          <button className="link" onClick={() => film?.begin(resumeAt, false)}>
            Continue the film from “{SCREENPLAY[resumeAt].title}”
          </button>
        </div>
      )}
    </section>
  )
}

/** captions, the scene's title, act cards and the film's requests to the visitor */
function Stage() {
  const caption = useFilm((s) => s.caption)
  const captions = useFilm((s) => s.captions)
  const slate = useFilm((s) => s.slate)
  const card = useFilm((s) => s.card)
  const prompt = useFilm((s) => s.prompt)
  const lab = useFilm((s) => s.lab)
  return (
    <>
      {card && (
        <div className="card" key={card.act}>
          <span className="card__numeral">Part {card.numeral}</span>
          <h2>{card.title}</h2>
          <p>{card.tagline}</p>
        </div>
      )}
      {slate && !card && !lab && (
        <div className="slate" key={slate.key}>
          <h2>{slate.title}</h2>
        </div>
      )}
      {prompt && !lab ? (
        <button className="prompt" onClick={() => film?.openGate()}>
          <span className="prompt__pulse" />
          {prompt}
        </button>
      ) : (
        caption &&
        captions &&
        !lab && (
          <div className="captions" aria-live="off">
            <p className="caption" key={caption.key}>
              {caption.text}
            </p>
          </div>
        )
      )}
    </>
  )
}

const HINT_KEY = 'strange-attractors:explore-hint'

/**
 * Once, a little way into the first scene after the prologue, point at the Explore switch.
 * Never again after the visitor has used the switch or seen the hint.
 */
function useExploreHint(index: number, lab: boolean): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const done = () => {
      try {
        localStorage.setItem(HINT_KEY, '1')
      } catch {
        /* private mode */
      }
    }
    if (lab) {
      done()
      setShow(false)
      return
    }
    let seen = false
    try {
      seen = localStorage.getItem(HINT_KEY) === '1'
    } catch {
      /* private mode */
    }
    if (seen || index < 1) return
    const on = window.setTimeout(() => setShow(true), 8000)
    const off = window.setTimeout(() => {
      setShow(false)
      done()
    }, 22000)
    return () => {
      window.clearTimeout(on)
      window.clearTimeout(off)
    }
  }, [index >= 1, lab])
  return show
}

function Bar() {
  const status = useFilm((s) => s.status)
  const index = useFilm((s) => s.index)
  const durations = useFilm((s) => s.durations)
  const sceneTime = useFilm((s) => s.sceneTime)
  const captions = useFilm((s) => s.captions)
  const lab = useFilm((s) => s.lab)
  const hint = useExploreHint(index, lab)
  useSound()

  const total = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations])
  const before = useMemo(() => durations.slice(0, Math.max(0, index)).reduce((a, b) => a + b, 0), [durations, index])
  const scene = SCREENPLAY[index]
  const act = scene ? ACTS.find((a) => a.act === scene.act) : null
  const fraction = scene ? Math.min(1, sceneTime / Math.max(1, durations[index] ?? 1)) : 0
  const paused = status === 'paused'

  return (
    <>
      <button className="mark" onClick={() => useFilm.setState({ indexOpen: true })} title="Scenes (S)">
        Strange Attractors
      </button>
      <footer className="bar">
        <div className="bar__group bar__play">
          <button className="icon icon--play" onClick={() => film?.toggle()} aria-label={lab ? 'Back to the film' : paused ? 'Play' : 'Pause'} title="Space">
            <Icon name={paused || lab ? 'play' : 'pause'} />
          </button>
          <button className="icon icon--wide" onClick={() => film?.prev()} aria-label="Previous scene" title="←">
            <Icon name="prev" />
          </button>
          <button className="icon icon--wide" onClick={() => film?.next()} aria-label="Next scene" title="→">
            <Icon name="next" />
          </button>
        </div>

        <div className="strip">
          <div className="strip__now">
            <span className="strip__title">
              {act?.numeral ? <i>{act.numeral}</i> : null}
              {scene?.title}
            </span>
            <span className="strip__time">
              {clock(before + sceneTime)} / {clock(total)}
            </span>
          </div>
          <div className="strip__track" role="group" aria-label="Scenes">
            {ACTS.map((a) => {
              const scenes = SCREENPLAY.map((s, i) => ({ s, i })).filter(({ s }) => s.act === a.act)
              const weight = scenes.reduce((sum, { i }) => sum + (durations[i] ?? 40), 0)
              return (
                <div className="strip__act" key={a.act} style={{ flex: `${weight} 1 0` }}>
                  {scenes.map(({ s, i }) => (
                    <button
                      key={s.id}
                      className={`seg${i < index ? ' is-past' : ''}`}
                      style={{ flex: `${durations[i] ?? 40} 1 0` }}
                      onClick={() => void film?.goto(i)}
                      aria-label={s.title}
                      aria-current={i === index ? 'true' : undefined}
                    >
                      {i === index && <span className="seg__fill" style={{ width: `${fraction * 100}%` }} />}
                      <span className="seg__tip">{s.title}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        <div className="bar__group bar__tools">
          <div className="mode" role="group" aria-label="Mode">
            <button aria-pressed={!lab} onClick={() => film?.setLab(false)} title="Watch the film">
              Watch
            </button>
            <button aria-pressed={lab} onClick={() => film?.setLab(true)} title="Stop the film here and take the controls (E)">
              <Icon name="lab" />
              Explore
            </button>
            {hint && (
              <span className="mode__hint" role="status">
                Want to play with it? Switch to Explore. The film waits for you.
              </span>
            )}
          </div>
          <button className="icon" onClick={() => setCaptions(!captions)} aria-pressed={captions} aria-label="Captions" title="Captions (C)">
            <Icon name="captions" />
          </button>
          <button className="icon" onClick={() => sound.setMuted(!sound.muted)} aria-pressed={!sound.muted} aria-label="Sound" title="Sound (M)">
            <Icon name={sound.muted ? 'mute' : 'sound'} />
          </button>
          <button className="icon" onClick={() => useFilm.setState({ indexOpen: true })} aria-label="Scenes" title="Scenes (S)">
            <Icon name="scenes" />
          </button>
          <button className="icon icon--wide" onClick={toggleFullscreen} aria-label="Full screen" title="Full screen (F)">
            <Icon name="full" />
          </button>
        </div>
      </footer>
    </>
  )
}

function SceneIndex() {
  const index = useFilm((s) => s.index)
  const durations = useFilm((s) => s.durations)
  const lab = useFilm((s) => s.lab)
  const pick = useFilm((s) => s.indexExplore)
  const exploring = pick || lab
  const close = () => useFilm.setState({ indexOpen: false, indexExplore: false })
  return (
    <section className="index" aria-label="Scenes">
      <div className="index__inner">
        <header className="index__head">
          <div>
            <h2>{exploring ? 'Explore' : 'Scenes'}</h2>
            <p>{exploring ? 'Pick a scene. It opens with its dials and notes, and no narration.' : 'Pick a scene. The film plays on from there.'}</p>
          </div>
          <button className="link" onClick={close} autoFocus>
            Close
          </button>
        </header>
        <div className="index__acts">
          {ACTS.filter((a) => a.act >= 1 && a.act <= 5).map((a) => {
            // the prologue sits with the first act, the epilogue with the last
            const acts = a.act === 1 ? [0, 1] : a.act === 5 ? [5, 6] : [a.act]
            return (
              <div className="index__act" key={a.act}>
                <h3>
                  <i>{a.numeral}</i>
                  {a.title}
                </h3>
                <p>{a.tagline}</p>
                <ol className="index__list">
                  {SCREENPLAY.map((s, i) => ({ s, i }))
                    .filter(({ s }) => acts.includes(s.act))
                    .map(({ s, i }) => (
                      <li key={s.id}>
                        <button
                          aria-current={i === index ? 'true' : undefined}
                          onClick={() => {
                            close()
                            film?.begin(i, exploring)
                          }}
                        >
                          {s.title}
                          {!exploring && <span>{clock(durations[i] ?? 0)}</span>}
                        </button>
                      </li>
                    ))}
                </ol>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** re-render a few times a second: lab controls read live values from the scene */
function useTick(hz: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), 1000 / hz)
    return () => window.clearInterval(id)
  }, [hz])
}

function Control({ c }: { c: LabControl }) {
  if (c.kind === 'slider') {
    const v = c.get()
    return (
      <div>
        <div className="ctl__label">
          <span>{c.label}</span>
          <span className="ctl__value">{c.format ? c.format(v) : v.toFixed(2)}</span>
        </div>
        <input type="range" min={c.min} max={c.max} step={c.step ?? (c.max - c.min) / 500} value={v} onChange={(e) => c.set(Number(e.target.value))} aria-label={c.label} />
      </div>
    )
  }
  if (c.kind === 'choice') {
    const v = c.get()
    return (
      <div>
        <div className="ctl__label">
          <span>{c.label}</span>
        </div>
        <div className="choice">
          {c.options.map((o) => (
            <button key={o.value} aria-pressed={o.value === v} onClick={() => c.set(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (c.kind === 'toggle') {
    return (
      <label className="toggle">
        {c.label}
        <input type="checkbox" checked={c.get()} onChange={(e) => c.set(e.target.checked)} />
      </label>
    )
  }
  if (c.kind === 'action') {
    return (
      <button className="action" onClick={c.run}>
        {c.label}
      </button>
    )
  }
  return (
    <div className="ctl__label">
      <span>{c.label}</span>
      <span className="ctl__value">{c.get()}</span>
    </div>
  )
}

function Lab() {
  const index = useFilm((s) => s.index)
  useTick(8)
  const scene = film?.scene
  const script = SCREENPLAY[index]
  if (!scene || !script) return null
  const prev = SCREENPLAY[index - 1]
  const next = SCREENPLAY[index + 1]
  const empty = !scene.lab?.length && !scene.notes?.length
  return (
    <aside className="lab" aria-label="Explore this scene">
      <div className="lab__head">
        <span>Exploring. The film is waiting.</span>
        <button className="link" onClick={() => useFilm.setState({ indexOpen: true })}>
          All scenes
        </button>
      </div>
      <h2>{script.title}</h2>
      <div className="lab__scroll">
        {scene.lab && scene.lab.length > 0 && (
          <div className="lab__controls">
            {scene.lab.map((c, i) => (
              <Control c={c} key={`${script.id}:${i}`} />
            ))}
          </div>
        )}
        <div className="lab__notes">
          {scene.notes?.map((p, i) => <p key={i}>{p}</p>)}
          {empty && <p>Drag to look around; scroll or pinch to move in.</p>}
        </div>
      </div>
      <nav className="lab__nav" aria-label="Other scenes">
        <button className="link" disabled={!prev} onClick={() => film?.prev()}>
          {prev ? `‹ ${prev.title}` : ''}
        </button>
        <button className="link" disabled={!next} onClick={() => film?.next()}>
          {next ? `${next.title} ›` : ''}
        </button>
      </nav>
      <div className="lab__foot">
        <button className="action action--main" onClick={() => film?.setLab(false)}>
          <Icon name="play" />
          Back to the film
        </button>
      </div>
    </aside>
  )
}

function End() {
  return (
    <section className="start end" aria-label="The end">
      <p className="start__what">Every picture in this film was computed in your browser while you watched. The mathematics is real; the narration and the music were generated.</p>
      <div className="end__actions">
        <button className="begin" onClick={() => film?.begin(0)}>
          Watch again
        </button>
        <button className="begin" onClick={() => useFilm.setState({ indexOpen: true, indexExplore: true })}>
          Explore on your own
        </button>
      </div>
      <div className="start__more">
        <a className="link" href="https://github.com/maozedong/strange-attractors" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </div>
    </section>
  )
}

/** the browser refused to start audio: say so, and offer the one thing that fixes it */
function SoundNotice() {
  const s = useSound()
  if (s.startsWith('running') || sound.muted) return null
  return (
    <button className="notice" onClick={() => sound.unlock()}>
      Sound is blocked. Tap to turn it on.
    </button>
  )
}

function Unsupported({ reason }: { reason: string }) {
  return (
    <section className="unsupported">
      <h1>Strange Attractors</h1>
      <p>{reason}</p>
      <p>Try a current desktop browser, or a recent phone.</p>
    </section>
  )
}
