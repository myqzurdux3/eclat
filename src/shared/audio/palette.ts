import { hsbToRgb } from '../color'
import type { Color, PanelLayout } from '../types'
import type { AudioFeatures } from './analyser'

export interface AudioSettings {
  /** Multiplies the response; 1 is neutral. */
  sensitivity: number
  /** Extra brightness on a beat, as a fraction. */
  beatFlash: number
  /** Below this level the wall goes dark rather than showing noise. */
  gate: number
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  sensitivity: 1,
  beatFlash: 0.35,
  gate: 0.01,
}

/** Hue in degrees for a bass-dominated mix, and for a treble-dominated one. */
const WARM_HUE = 12
const COOL_HUE = 210

const bound = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Turns audio features into one colour per panel.
 *
 * The balance between bands sets the hue: bass runs warm, treble cool, so a
 * heavy track reads red and a bright one blue. Each panel's vertical
 * position shifts that hue a little, which puts the low end at the bottom of
 * the wall — where the ear expects it — and spreads the mix over the whole
 * surface instead of flashing it in unison.
 *
 * Below the gate the wall goes black: showing the analysis of near-silence
 * would just be showing noise.
 */
export function audioColors(
  features: AudioFeatures,
  layout: PanelLayout,
  settings: AudioSettings,
): Color[] {
  if (layout.panels.length === 0) return []
  if (features.level < settings.gate) {
    return layout.panels.map(() => ({ r: 0, g: 0, b: 0 }))
  }

  const total = features.bass + features.mid + features.treble
  const balance = total === 0 ? 0.5 : features.treble / total
  const baseHue = WARM_HUE + (COOL_HUE - WARM_HUE) * balance

  const energy = bound(
    (features.bass * 0.5 + features.mid * 0.3 + features.treble * 0.2) * settings.sensitivity,
    0,
    1,
  )
  const flash = features.beat ? settings.beatFlash : 0

  return layout.panels.map((panel) => {
    // `ny` is 0 at the top of the wall: the low end belongs at the bottom.
    const height = 1 - panel.ny
    const hue = baseHue + (1 - height) * 40
    const saturation = bound(60 + energy * 40, 0, 100)
    const brightness = bound((0.25 + energy * 0.75 + flash) * 100, 0, 100)

    return hsbToRgb(hue, saturation, brightness)
  })
}
