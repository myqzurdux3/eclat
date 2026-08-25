import { luminance, type LinearColor } from './srgb'
import type { SyncSettings } from './settings'

const borner = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * Pousse la saturation et applique le plancher de noir.
 *
 * La saturation est étirée autour de la luminance : chaque canal s'écarte
 * du gris de même luminosité, ce qui vivifie sans déplacer la luminance
 * perçue — un simple facteur multiplicatif éclaircirait l'image au passage.
 *
 * Le plancher écrase à zéro ce qui passe en dessous : le device coupe de
 * toute façon sous un certain seuil, et laisser traîner des valeurs
 * résiduelles fait scintiller les panneaux dans les scènes sombres.
 */
export function applyCorrection(color: LinearColor, settings: SyncSettings): LinearColor {
  const gris = luminance(color)

  const sature: LinearColor = {
    r: borner(gris + (color.r - gris) * settings.saturation),
    g: borner(gris + (color.g - gris) * settings.saturation),
    b: borner(gris + (color.b - gris) * settings.saturation),
  }

  if (luminance(sature) < settings.blackFloor) return { r: 0, g: 0, b: 0 }

  return sature
}
