import type { Color } from './types'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Converts the device's HSB to RGB. The device expresses hue in degrees, and
 * both saturation and brightness as percentages.
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

export interface WheelPosition {
  hue: number
  sat: number
}

/**
 * From a position on the wheel to hue and saturation.
 *
 * `dx`/`dy` are relative to the centre, in pixels, with Y pointing down as
 * on screen. Red sits on the right and hue increases clockwise, matching the
 * visual order of the gradient `ColorWheel` draws. Returns `null` outside
 * the disc: the click did not land on the wheel.
 */
export function wheelToHsv(dx: number, dy: number, radius: number): WheelPosition | null {
  const distance = Math.hypot(dx, dy)
  if (radius <= 0) return { hue: 0, sat: 0 }
  if (distance > radius) return null

  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI
  return {
    hue: ((degrees % 360) + 360) % 360,
    sat: (distance / radius) * 100,
  }
}

/** The inverse of `wheelToHsv`, used to place the cursor on the wheel. */
export function hsvToWheel(hue: number, sat: number, radius: number): { dx: number; dy: number } {
  const angle = (hue * Math.PI) / 180
  const distance = (clamp(sat, 0, 100) / 100) * radius
  // `+ 0` folds the -0 a negative cosine produces at zero distance.
  return { dx: distance * Math.cos(angle) + 0, dy: distance * Math.sin(angle) + 0 }
}
