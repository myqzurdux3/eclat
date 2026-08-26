import type { Color } from './types'

/** What the frame carries for a panel the user has switched off. */
export const UNLIT: Color = { r: 0, g: 0, b: 0 }

/** A panel the user has switched off carries no light at all. */
export const isUnlit = (color: Color): boolean => color.r === 0 && color.g === 0 && color.b === 0

/**
 * The colour a click on a panel should write.
 *
 * Clicking a panel the user has already lit switches it off. The wall offers
 * no other per-panel control, so a second click is the only obvious way to
 * undo the first; without it a painted panel could never be taken back.
 * Everything else — an untouched panel, one already switched off — takes the
 * brush.
 */
export function nextPaint(current: Color | undefined, brush: Color): Color {
  return current !== undefined && !isUnlit(current) ? UNLIT : brush
}
