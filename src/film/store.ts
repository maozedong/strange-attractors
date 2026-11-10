import { create } from 'zustand'
import type { ActInfo } from './screenplay'

/** What the interface needs to know about the film. Written by the director, read by React. */
export interface FilmState {
  /** the engine is up and the title is on screen */
  ready: boolean
  /** set when the graphics card cannot run the film */
  error: string | null
  /** the visitor has pressed Begin at least once */
  started: boolean
  status: 'title' | 'playing' | 'paused' | 'gate' | 'ended'
  /** what `paused` goes back to */
  resumeTo: 'playing' | 'gate' | null
  /** index into the screenplay, −1 on the title */
  index: number
  /** seconds into the current scene */
  sceneTime: number
  /** length of every scene, seconds */
  durations: number[]
  caption: { text: string; key: string } | null
  /** what the film is asking the visitor to do */
  prompt: string | null
  /** act title card */
  card: ActInfo | null
  /** scene title, shown for a few seconds as the scene opens */
  slate: { title: string; key: number } | null
  loading: boolean
  lab: boolean
  labAvailable: boolean
  captions: boolean
  indexOpen: boolean
}

const CAPTIONS_KEY = 'strange-attractors:captions'

function savedCaptions(): boolean {
  try {
    return localStorage.getItem(CAPTIONS_KEY) !== '0'
  } catch {
    return true
  }
}

export const useFilm = create<FilmState>(() => ({
  ready: false,
  error: null,
  started: false,
  status: 'title',
  resumeTo: null,
  index: -1,
  sceneTime: 0,
  durations: [],
  caption: null,
  prompt: null,
  card: null,
  slate: null,
  loading: false,
  lab: false,
  labAvailable: false,
  captions: savedCaptions(),
  indexOpen: false,
}))

export function setCaptions(on: boolean) {
  try {
    localStorage.setItem(CAPTIONS_KEY, on ? '1' : '0')
  } catch {
    /* private mode */
  }
  useFilm.setState({ captions: on })
}
