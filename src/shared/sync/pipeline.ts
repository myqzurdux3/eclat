import { applyCorrection } from './correction'
import { detectLetterbox } from './letterbox'
import { dominantColor, paletteColors } from './mapping-clusters'
import { mapSpatial } from './mapping-spatial'
import { Smoother } from './smoothing'
import { toSrgb, type Frame, type LinearColor, type Rect } from './srgb'
import type { SyncSettings } from './settings'
import type { Color, PanelLayout } from '../types'

/** Nombre de clusters demandés en mode palette. */
const CLUSTERS = 5

/**
 * Transforme une frame d'écran en une couleur par panneau.
 *
 * L'ordre est imposé par la spec et n'est pas interchangeable : le letterbox
 * doit tomber avant la moyenne, sinon les bandes noires tirent tout vers le
 * bas ; la correction vient après le mapping, sinon on sature du bruit ; et
 * le lissage ferme la marche, en linéaire, avant le retour en sRGB.
 *
 * Seul le lisseur a une mémoire : le reste est fonction pure de la frame.
 */
export class SyncPipeline {
  private smoother: Smoother

  constructor(
    private readonly layout: PanelLayout,
    private settings: SyncSettings,
  ) {
    this.smoother = new Smoother(settings.attack, settings.release)
  }

  /** Applique de nouveaux réglages sans perdre l'historique de lissage. */
  update(settings: SyncSettings): void {
    const rythmeChange =
      settings.attack !== this.settings.attack || settings.release !== this.settings.release
    this.settings = settings
    if (rythmeChange) this.smoother = new Smoother(settings.attack, settings.release)
  }

  reset(): void {
    this.smoother.reset()
  }

  process(frame: Frame): Color[] {
    if (this.layout.panels.length === 0) return []

    const rect = detectLetterbox(frame)
    const brut = this.mapper(frame, rect)
    const corrige = brut.map((color) => applyCorrection(color, this.settings))

    return this.smoother.push(corrige).map((color) => ({
      r: toSrgb(color.r),
      g: toSrgb(color.g),
      b: toSrgb(color.b),
    }))
  }

  private mapper(frame: Frame, rect: Rect): LinearColor[] {
    const count = this.layout.panels.length

    if (this.settings.mode === 'dominant') {
      const couleur = dominantColor(frame, rect)
      return Array.from({ length: count }, () => couleur)
    }

    if (this.settings.mode === 'palette') {
      const palette = paletteColors(frame, rect, CLUSTERS)
      if (palette.length === 0) {
        return Array.from({ length: count }, () => ({ r: 0, g: 0, b: 0 }))
      }
      return Array.from({ length: count }, (_, index) => palette[index % palette.length]!)
    }

    return mapSpatial(frame, rect, this.layout, this.settings.radius)
  }
}
