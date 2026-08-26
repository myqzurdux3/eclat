import { LINEAR_BLACK, luminance, type LinearColor } from './srgb'
import { clamp } from '../color'

const clamp01 = (value: number): number => clamp(value, 0, 1)
import type { SyncSettings } from './settings'

/**
 * Boosts saturation and applies the black floor.
 *
 * Saturation is stretched around the luminance: each channel moves away from
 * the grey of the same brightness, which livens the colour without shifting
 * perceived luminance — a plain multiplication would brighten the image on
 * the way.
 *
 * The floor clamps anything below it to zero: the device cuts out below a
 * certain level anyway, and leaving residual values there makes the panels
 * flicker in dark scenes.
 */
export function applyCorrection(color: LinearColor, settings: SyncSettings): LinearColor {
  const grey = luminance(color)

  // Stretching every channel by the same factor around the grey of the same
  // luminance leaves that luminance untouched — the weights sum to one, so
  // the deviations cancel. Clamping a single channel breaks that: it puts
  // back light the others were never asked to give up, and since the clamp
  // is one-sided the correction could then only ever brighten. Instead the
  // factor is pulled back until every channel fits on its own.
  const reach = (channel: number): number => {
    const deviation = channel - grey
    if (deviation === 0) return Number.POSITIVE_INFINITY
    return deviation > 0 ? (1 - grey) / deviation : -grey / deviation
  }

  const factor = Math.max(
    0,
    Math.min(settings.saturation, reach(color.r), reach(color.g), reach(color.b)),
  )

  const saturated: LinearColor = {
    r: clamp01(grey + (color.r - grey) * factor),
    g: clamp01(grey + (color.g - grey) * factor),
    b: clamp01(grey + (color.b - grey) * factor),
  }

  if (luminance(saturated) < settings.blackFloor) return { ...LINEAR_BLACK }

  return saturated
}
