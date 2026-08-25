import type { Color } from './types'

export interface SceneMotionOptions {
  /** How long one palette colour takes to give way to the next. */
  durationMs?: number
  /** Offset between the first and last panel, as a fraction of a cycle. */
  spread?: number
}

const BLACK: Color = { r: 0, g: 0, b: 0 }
const DEFAULT_DURATION = 4000
const DEFAULT_SPREAD = 0.7

const blend = (a: Color, b: Color, t: number): Color => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
})

/**
 * Brings a palette to life across the wall: a wave of colour travelling over it.
 *
 * **This is not what the panels are showing.** The device exposes no
 * per-panel colour, and its effects are closed plugins, so reproducing them
 * is out of reach. All we know is which colours make up the scene. This
 * function derives a plausible motion from them, so the mock-up breathes
 * instead of sitting frozen — the interface says as much to the user, and it
 * must never claim otherwise.
 */
export function sceneMotion(
  palette: Color[],
  panelCount: number,
  timeMs: number,
  options: SceneMotionOptions = {},
): Color[] {
  if (panelCount <= 0) return []
  if (palette.length === 0) return Array.from({ length: panelCount }, () => ({ ...BLACK }))
  if (palette.length === 1) {
    return Array.from({ length: panelCount }, () => ({ ...palette[0]! }))
  }

  const duration = options.durationMs ?? DEFAULT_DURATION
  const spread = options.spread ?? DEFAULT_SPREAD
  const progress = timeMs / duration

  return Array.from({ length: panelCount }, (_, index) => {
    // Each panel lags behind the previous one, so the wave can be seen moving.
    const offset = panelCount === 1 ? 0 : (index / panelCount) * spread * palette.length
    const position = progress + offset

    const from = Math.floor(position)
    const fraction = position - from
    const a = palette[((from % palette.length) + palette.length) % palette.length]!
    const b = palette[(((from + 1) % palette.length) + palette.length) % palette.length]!

    return blend(a, b, fraction)
  })
}
