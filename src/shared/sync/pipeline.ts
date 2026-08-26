import { applyCorrection } from './correction'
import { detectLetterbox } from './letterbox'
import { dominantColor, paletteColors } from './mapping-clusters'
import { mapSpatial } from './mapping-spatial'
import { Smoother } from './smoothing'
import { LINEAR_BLACK, toSrgb, type Frame, type LinearColor, type Rect } from './srgb'
import type { SyncSettings } from './settings'
import type { Color, PanelLayout } from '../types'

/** How many clusters palette mode asks for. */
const CLUSTERS = 5

/**
 * Turns a frame of the screen into one colour per panel.
 *
 * The order comes from the spec and is not interchangeable: letterbox
 * detection has to happen before averaging, or the black bars drag
 * everything down; correction comes after mapping, or it saturates noise;
 * and smoothing closes the march, in linear space, before the return to sRGB.
 *
 * Only the smoother carries state — the rest is a pure function of the frame.
 */
export class SyncPipeline {
  private readonly smoother: Smoother

  constructor(
    private readonly layout: PanelLayout,
    private settings: SyncSettings,
  ) {
    this.smoother = new Smoother(settings.attack, settings.release)
  }

  /** Applies new settings without losing the smoothing history. */
  update(settings: SyncSettings): void {
    this.settings = settings
    this.smoother.retune(settings.attack, settings.release)
  }

  reset(): void {
    this.smoother.reset()
  }

  process(frame: Frame): Color[] {
    if (this.layout.panels.length === 0) return []

    const rect = detectLetterbox(frame)
    const raw = this.map(frame, rect)
    const corrected = raw.map((color) => applyCorrection(color, this.settings))

    return this.smoother.push(corrected).map((color) => ({
      r: toSrgb(color.r),
      g: toSrgb(color.g),
      b: toSrgb(color.b),
    }))
  }

  private map(frame: Frame, rect: Rect): LinearColor[] {
    const count = this.layout.panels.length

    if (this.settings.mode === 'dominant') {
      const colour = dominantColor(frame, rect)
      return Array.from({ length: count }, () => colour)
    }

    if (this.settings.mode === 'palette') {
      const palette = paletteColors(frame, rect, CLUSTERS)
      if (palette.length === 0) {
        return Array.from({ length: count }, () => ({ ...LINEAR_BLACK }))
      }
      return Array.from({ length: count }, (_, index) => palette[index % palette.length]!)
    }

    return mapSpatial(frame, rect, this.layout, this.settings.radius)
  }
}
