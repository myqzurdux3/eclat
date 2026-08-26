import { decay, EMPTY_MEMORY, type ModeMemory } from './modes'
import { MODES, type AudioSettings } from './palette'
import type { Color, PanelLayout } from '../types'
import type { AudioFeatures } from './analyser'
import { UNLIT } from '../paint'

/**
 * Turns audio features into one colour per panel, block after block.
 *
 * The modes themselves are pure; what lives here is the little they carry
 * between blocks — a falling peak, a pulse fading towards the next beat —
 * and the gate, which belongs to no mode in particular: below it the wall
 * goes black whatever the mode, since showing the analysis of near-silence
 * would just be showing noise.
 */
export class AudioPainter {
  private memory: ModeMemory = EMPTY_MEMORY

  paint(features: AudioFeatures, layout: PanelLayout, settings: AudioSettings): Color[] {
    if (layout.panels.length === 0) return []

    if (features.level < settings.gate) {
      // The memory keeps settling through the silence: a peak that froze
      // where the music stopped would still be there when it starts again.
      this.memory = decay(this.memory)
      return layout.panels.map(() => ({ ...UNLIT }))
    }

    const frame = MODES[settings.mode](features, layout, settings, this.memory)
    this.memory = frame.memory
    return frame.colors
  }

  /** Forgets everything: a new source has nothing to do with the last one. */
  reset(): void {
    this.memory = EMPTY_MEMORY
  }
}
