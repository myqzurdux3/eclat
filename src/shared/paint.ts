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

/** Hue and saturation of the colour a click lays down. */
export interface Brush {
  hue: number
  sat: number
}

/**
 * The brush to start from, before the user has chosen one.
 *
 * A device running an effect stops keeping `hue` and `sat` current — they
 * sit at 0 and 0, which is white — so reading them back would hand the user
 * a white brush and every first stroke would be white. When the device has
 * no colour to offer, the brush starts on a warm amber: an arbitrary choice,
 * but a deliberate one, and anything is better than white on a wall.
 */
export const FALLBACK_BRUSH: Brush = { hue: 30, sat: 90 }

export function defaultBrush(state: { hue: number; sat: number } | null): Brush {
  if (state === null || state.sat <= 0) return FALLBACK_BRUSH
  return { hue: state.hue, sat: state.sat }
}
