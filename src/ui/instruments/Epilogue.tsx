import { useStore } from '../../store'

export function Epilogue() {
  const setFreePlay = useStore((s) => s.setFreePlay)
  const setChapter = useStore((s) => s.setChapter)
  return (
    <div className="row">
      <button className="action" onClick={() => setFreePlay(true)}>
        Enter free play
      </button>
      <button className="textbtn" onClick={() => setChapter(0)}>
        Start over
      </button>
    </div>
  )
}
