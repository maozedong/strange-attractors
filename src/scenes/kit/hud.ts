/**
 * Where small on-screen words go so they never sit under the captions (bottom centre) or the
 * scene title (top left, first seconds only): the lower-left corner, just above the player bar.
 */
import type { Label } from '../../engine/Labels'
import type { SceneContext } from '../../film/types'

const barHeight = () => (window.innerWidth <= 720 ? 104 : 76)

/** a live figure in the lower-left corner ("time 12.4", "ρ 28.0") */
export function readout(ctx: SceneContext, text = ''): Label {
  return ctx.label(text, { kind: 'num', at: { screen: [0, 1] }, align: 'right', dx: window.innerWidth <= 720 ? 18 : 34, dy: -(barHeight() + 26) })
}

/** a name plate in the lower-left corner: a title line and a smaller second line */
export function plate(ctx: SceneContext, title: string, sub: string): Label {
  const l = ctx.label('', { kind: 'plate', at: { screen: [0, 1] }, align: 'right', dx: window.innerWidth <= 720 ? 18 : 34, dy: -(barHeight() + 62) })
  l.setHtml(`${title}<small>${sub}</small>`)
  return l
}
