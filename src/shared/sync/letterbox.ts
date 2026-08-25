import { toLinear, type Frame, type Rect } from './srgb'

/**
 * Luminance linéaire au-dessus de laquelle une bande n'est plus considérée
 * comme noire. Les bandes d'un film compressé ne sont jamais exactement à
 * zéro : ce seuil correspond à peu près à 20 en sRGB.
 */
export const DEFAULT_THRESHOLD = 0.006

/** Au-delà, ce n'est plus un letterbox mais une scène sombre. */
const CROP_MAXIMAL = 0.45

function ligneNoire(frame: Frame, y: number, seuil: number): boolean {
  let somme = 0
  for (let x = 0; x < frame.width; x += 1) {
    const at = (y * frame.width + x) * 4
    somme +=
      0.2126 * toLinear(frame.data[at]!) +
      0.7152 * toLinear(frame.data[at + 1]!) +
      0.0722 * toLinear(frame.data[at + 2]!)
  }
  return somme / frame.width <= seuil
}

function colonneNoire(frame: Frame, x: number, seuil: number): boolean {
  let somme = 0
  for (let y = 0; y < frame.height; y += 1) {
    const at = (y * frame.width + x) * 4
    somme +=
      0.2126 * toLinear(frame.data[at]!) +
      0.7152 * toLinear(frame.data[at + 1]!) +
      0.0722 * toLinear(frame.data[at + 2]!)
  }
  return somme / frame.height <= seuil
}

/**
 * Rectangle utile de l'image, bandes noires retirées.
 *
 * Sans cette étape, un film en 2.35:1 éteint les panneaux hauts et bas : ils
 * échantillonneraient la bande, pas l'image.
 *
 * Le balayage s'arrête à la première ligne qui dépasse le seuil, et le
 * résultat est abandonné si le crop mangeait plus de 45 % d'un axe — à ce
 * compte-là c'est une scène sombre, et rogner la ferait disparaître.
 */
export function detectLetterbox(frame: Frame, threshold = DEFAULT_THRESHOLD): Rect {
  const entier: Rect = { x: 0, y: 0, width: frame.width, height: frame.height }
  if (frame.width === 0 || frame.height === 0) return entier

  let haut = 0
  while (haut < frame.height && ligneNoire(frame, haut, threshold)) haut += 1

  // Image entièrement sous le seuil : rien à rogner.
  if (haut === frame.height) return entier

  let bas = frame.height - 1
  while (bas > haut && ligneNoire(frame, bas, threshold)) bas -= 1

  let gauche = 0
  while (gauche < frame.width && colonneNoire(frame, gauche, threshold)) gauche += 1

  let droite = frame.width - 1
  while (droite > gauche && colonneNoire(frame, droite, threshold)) droite -= 1

  const height = bas - haut + 1
  const width = droite - gauche + 1

  const tropHaut = height < frame.height * (1 - CROP_MAXIMAL)
  const tropLarge = width < frame.width * (1 - CROP_MAXIMAL)

  return {
    x: tropLarge ? 0 : gauche,
    y: tropHaut ? 0 : haut,
    width: tropLarge ? frame.width : width,
    height: tropHaut ? frame.height : height,
  }
}
