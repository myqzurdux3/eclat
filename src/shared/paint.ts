import type { Color } from './types'

/** What the frame carries for a panel the user has switched off. */
export const UNLIT: Color = { r: 0, g: 0, b: 0 }

/** A panel the user has switched off carries no light at all. */
export const isUnlit = (color: Color): boolean => color.r === 0 && color.g === 0 && color.b === 0

/**
 * The colour a click on a panel should write.
 *
 * Clicking a panel the user has already chosen switches it off. The wall
 * offers no other per-panel control, so a second click is the only obvious
 * way to undo the first; without it a lit panel could never be taken back.
 *
 * The question is whether the user chose this panel, not what colour it is
 * showing: the first stroke seeds every other panel with the wall's own
 * appearance, and those must still answer a click by lighting up.
 */
export function nextPaint(chosen: boolean, brush: Color): Color {
  return chosen ? UNLIT : brush
}

/**
 * The colour to actually send for a panel the mock-up is drawing with
 * `shown`.
 *
 * The tints passed in are screen conventions, not light: the unlit tint
 * stands for a panel that is off, the neutral one for a wall whose colours
 * are unknown. Sending either to the device would invent light — a wall lit
 * dim grey because the app could not name what it was showing. They become
 * real black, and so does a panel the mock-up knows nothing about.
 */
export function toFrameColor(shown: Color | undefined, ...tints: Color[]): Color {
  if (shown === undefined) return UNLIT
  const isTint = tints.some(
    (tint) => shown.r === tint.r && shown.g === tint.g && shown.b === tint.b,
  )
  return isTint ? UNLIT : shown
}
