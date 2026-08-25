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

export interface WheelPosition {
  hue: number
  sat: number
}

/**
 * Position dans la roue vers teinte et saturation.
 *
 * `dx`/`dy` sont relatifs au centre, en pixels, axe Y vers le bas comme à
 * l'écran. Le rouge est à droite et la teinte croît dans le sens horaire,
 * ce qui correspond à l'ordre visuel du dégradé dessiné par `ColorWheel`.
 * Renvoie `null` hors du disque : le clic n'a pas visé la roue.
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

/** Inverse de `wheelToHsv`, pour placer le curseur sur la roue. */
export function hsvToWheel(hue: number, sat: number, radius: number): { dx: number; dy: number } {
  const angle = (hue * Math.PI) / 180
  const distance = (clamp(sat, 0, 100) / 100) * radius
  // `+ 0` ramène les -0 produits par un cosinus négatif à distance nulle.
  return { dx: distance * Math.cos(angle) + 0, dy: distance * Math.sin(angle) + 0 }
}
