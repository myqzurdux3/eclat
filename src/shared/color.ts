import type { Color } from './types'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Convertit le HSB du device en RGB. Le device exprime la teinte en degrés
 * et la saturation comme la luminosité en pourcentage.
 */
export function hsbToRgb(hue: number, saturation: number, brightness: number): Color {
  const h = ((hue % 360) + 360) % 360
  const s = clamp(saturation, 0, 100) / 100
  const v = clamp(brightness, 0, 100) / 100

  const chroma = v * s
  const sector = h / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const floor = v - chroma

  const [r, g, b] =
    sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
    : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma]
    : sector < 5 ? [second, 0, chroma]
    : [chroma, 0, second]

  return {
    r: Math.round((r + floor) * 255),
    g: Math.round((g + floor) * 255),
    b: Math.round((b + floor) * 255),
  }
}
