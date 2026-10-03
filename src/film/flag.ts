/** `?film=1` turns the app into a frame-stepped renderer for recording (see FilmHook). */
export const FILM = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('film')
