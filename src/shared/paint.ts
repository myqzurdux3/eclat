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
 * The unlit tint is a screen convention — a panel drawn in pure black over a
 * near-black stage disappears — but the wall is sent real black. A panel the
 * mock-up knows nothing about is unlit too.
 */
export function toFrameColor(shown: Color | undefined, unlitTint: Color): Color {
  if (shown === undefined) return UNLIT
  const isTint =
    shown.r === unlitTint.r && shown.g === unlitTint.g && shown.b === unlitTint.b
  return isTint ? UNLIT : shown
}
