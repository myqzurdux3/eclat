import { luminance, type LinearColor } from './srgb'
import type { SyncSettings } from './settings'

const bound = (value: number): number => Math.min(1, Math.max(0, value))

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

  const saturated: LinearColor = {
    r: bound(grey + (color.r - grey) * settings.saturation),
    g: bound(grey + (color.g - grey) * settings.saturation),
    b: bound(grey + (color.b - grey) * settings.saturation),
  }

  if (luminance(saturated) < settings.blackFloor) return { r: 0, g: 0, b: 0 }

  return saturated
}
