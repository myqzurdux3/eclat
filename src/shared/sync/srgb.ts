/**
 * Image telle que la voit le pipeline.
 *
 * Structurellement compatible avec `ImageData`, mais déclarée ici pour que
 * l'analyse se teste sous Node, sans DOM.
 */
export interface Frame {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Couleur en espace linéaire, chaque canal dans [0,1]. */
export interface LinearColor {
  r: number
  g: number
  b: number
}

const NOIR: LinearColor = { r: 0, g: 0, b: 0 }

/** Table de conversion : 256 entrées, calculées une fois. */
const VERS_LINEAIRE = new Float64Array(256)
for (let value = 0; value < 256; value += 1) {
  const canal = value / 255
  VERS_LINEAIRE[value] = canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4
}

/** sRGB 0-255 vers linéaire 0-1. */
export function toLinear(channel: number): number {
  return VERS_LINEAIRE[Math.min(255, Math.max(0, Math.round(channel)))]!
}

/** Linéaire 0-1 vers sRGB 0-255. */
export function toSrgb(linear: number): number {
  const borne = Math.min(1, Math.max(0, linear))
  const canal = borne <= 0.0031308 ? borne * 12.92 : 1.055 * borne ** (1 / 2.4) - 0.055
  return Math.round(canal * 255)
}

/**
 * Moyenne d'un rectangle, en espace linéaire.
 *
 * Moyenner directement des valeurs sRGB produit du gris désaturé : l'encodage
 * gamma n'est pas linéaire, la moyenne de deux couleurs vives y tombe trop
 * bas. C'est la source d'erreur la plus visible de tout le pipeline.
 */
export function averageLinear(frame: Frame, rect: Rect): LinearColor {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(frame.width, Math.floor(rect.x + rect.width))
  const y1 = Math.min(frame.height, Math.floor(rect.y + rect.height))

  if (x1 <= x0 || y1 <= y0) return { ...NOIR }

  let r = 0
  let g = 0
  let b = 0

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * frame.width + x) * 4
      r += VERS_LINEAIRE[frame.data[at]!]!
      g += VERS_LINEAIRE[frame.data[at + 1]!]!
      b += VERS_LINEAIRE[frame.data[at + 2]!]!
    }
  }

  const total = (x1 - x0) * (y1 - y0)
  return { r: r / total, g: g / total, b: b / total }
}

/** Luminance linéaire, pondérations Rec. 709. */
export function luminance(color: LinearColor): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}
