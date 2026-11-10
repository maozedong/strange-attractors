/** Line icons drawn for this film: one stroke weight, round ends, no fills except play and pause. */
const PATHS: Record<string, React.ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z" />,
  prev: <path d="M17 6l-8 6 8 6M7 6v12" />,
  next: <path d="M7 6l8 6-8 6M17 6v12" />,
  captions: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 14.5h4M13.5 14.5H17M7 11h2.5M12 11h5" />
    </>
  ),
  sound: <path d="M4 10v4h3l4.5 3.5v-11L7 10zM15 9.5a3.5 3.5 0 010 5M17.5 7a7 7 0 010 10" />,
  mute: <path d="M4 10v4h3l4.5 3.5v-11L7 10zM15.5 9.5l5 5M20.5 9.5l-5 5" />,
  // a pair of dials
  lab: (
    <>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </>
  ),
  scenes: <path d="M4 6h16M4 12h16M4 18h10" />,
  full: <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />,
}

export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
