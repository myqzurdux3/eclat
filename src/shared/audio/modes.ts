import { hsbToRgb } from '../color'
import type { Color, PanelLayout } from '../types'
import type { AudioFeatures } from './analyser'
import type { AudioSettings } from './palette'

/**
 * What a mode carries from one block to the next.
 *
 * A block lasts about 21 ms, and several modes only read well because they
 * remember: a meter whose peak falls back slowly, a pulse that holds its
 * colour between two beats. The modes stay pure — they take the memory and
 * return the next one — so every transition can be tested on its own.
 */
export interface ModeMemory {
  /** The meter's falling peak, in [0,1]. */
  peak: number
  /** The hue the pulse is holding, in degrees. */
  pulseHue: number
  /** What is left of the pulse, in [0,1]. */
  pulse: number
}

export interface ModeFrame {
  colors: Color[]
  memory: ModeMemory
}

export type Mode = (
  features: AudioFeatures,
  layout: PanelLayout,
  settings: AudioSettings,
  memory: ModeMemory,
) => ModeFrame

/** Hue in degrees for a bass-dominated mix, and for a treble-dominated one. */
export const WARM_HUE = 12
export const COOL_HUE = 210

export const EMPTY_MEMORY: ModeMemory = { peak: 0, pulseHue: WARM_HUE, pulse: 0 }

/** How much of the peak falls away per block: about a second and a half. */
const PEAK_FALL = 0.014
/** How much of a pulse fades per block: a little under half a second. */
const PULSE_FALL = 0.05
/**
 * The hue each beat moves on by.
 *
 * The golden angle never lands twice in the same place, so consecutive
 * beats stay far apart in colour instead of drifting through neighbours.
 */
const BEAT_HUE_STEP = 137.5

const BLACK: Color = { r: 0, g: 0, b: 0 }

const bound = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * The panels read from left to right.
 *
 * Returns indices into `layout.panels`, not panels: a mode needs to give
 * every panel a colour in the layout's own order, and only borrows this to
 * decide which is first.
 */
export function horizontalOrder(layout: PanelLayout): number[] {
  return layout.panels
    .map((panel, index) => ({ index, nx: panel.nx, ny: panel.ny }))
    .sort((a, b) => (a.nx === b.nx ? a.ny - b.ny : a.nx - b.nx))
    .map((entry) => entry.index)
}

/** Lets a memory settle while nothing is playing. */
export function decay(memory: ModeMemory): ModeMemory {
  return {
    ...memory,
    peak: Math.max(0, memory.peak - PEAK_FALL),
    pulse: Math.max(0, memory.pulse - PULSE_FALL),
  }
}

/**
 * A field of colour over the whole wall.
 *
 * The balance between bands sets the hue: bass runs warm, treble cool, so a
 * heavy track reads red and a bright one blue. Each panel's vertical
 * position shifts that hue a little, which puts the low end at the bottom of
 * the wall — where the ear expects it — and spreads the mix over the whole
 * surface instead of flashing it in unison.
 */
export const ambient: Mode = (features, layout, settings, memory) => {
  const total = features.bass + features.mid + features.treble
  const balance = total === 0 ? 0.5 : features.treble / total
  const baseHue = WARM_HUE + (COOL_HUE - WARM_HUE) * balance

  const energy = bound(
    (features.bass * 0.5 + features.mid * 0.3 + features.treble * 0.2) * settings.sensitivity,
    0,
    1,
  )
  const flash = features.beat ? settings.beatFlash : 0

  const colors = layout.panels.map((panel) => {
    // `ny` is 0 at the top of the wall: the low end belongs at the bottom.
    const height = 1 - panel.ny
    return hsbToRgb(
      baseHue + (1 - height) * 40,
      bound(60 + energy * 40, 0, 100),
      bound((0.25 + energy * 0.75 + flash) * 100, 0, 100),
    )
  })

  return { colors, memory }
}

/**
 * A volume meter that fills the wall from left to right.
 *
 * The fill alone flickers with every block and reads as noise; the peak is
 * what the eye actually follows. It rises with the level at once and falls
 * back slowly, and the panel it sits on burns white so it can be picked out
 * of the fill behind it. The colour runs green to red across the wall, the
 * way a meter has always been read.
 */
export const meter: Mode = (features, layout, settings, memory) => {
  const count = layout.panels.length
  const order = horizontalOrder(layout)

  const level = bound(features.level * settings.sensitivity, 0, 1)
  const peak = Math.max(level, memory.peak - PEAK_FALL)

  const filled = level * count
  const peakPlace = peak <= 0 ? -1 : Math.min(count - 1, Math.floor(peak * count))

  const colors = new Array<Color>(count).fill(BLACK)

  order.forEach((panelIndex, place) => {
    // Green on the left, red on the right, whatever the wall's size.
    const hue = 120 * (1 - (count === 1 ? 0 : place / (count - 1)))

    if (place === peakPlace) {
      colors[panelIndex] = hsbToRgb(hue, 20, 100)
      return
    }

    // The panel the fill stops on is lit by however much of it is covered,
    // which keeps the meter from jumping a whole panel at a time.
    const covered = bound(filled - place, 0, 1)
    if (covered <= 0) return

    colors[panelIndex] = hsbToRgb(hue, 90, bound((0.2 + covered * 0.8) * 100, 0, 100))
  })

  return { colors, memory: { ...memory, peak } }
}

/**
 * The wall as a frequency axis: bass on the left, treble on the right.
 *
 * Each panel is given the band its position falls in and lit by that band's
 * energy, so the wall shows the shape of the mix rather than its loudness.
 * The hue follows the same axis, warm at the low end and cool at the high.
 */
export const spectrum: Mode = (features, layout, settings, memory) => {
  const count = layout.panels.length
  const order = horizontalOrder(layout)
  const bands = [features.bass, features.mid, features.treble]

  const colors = new Array<Color>(count).fill(BLACK)

  order.forEach((panelIndex, place) => {
    const across = count === 1 ? 0 : place / (count - 1)
    const band = bands[Math.min(bands.length - 1, Math.floor(across * bands.length))]!
    const energy = bound(band * settings.sensitivity, 0, 1)
    if (energy <= 0) return

    colors[panelIndex] = hsbToRgb(
      WARM_HUE + (COOL_HUE - WARM_HUE) * across,
      90,
      bound(energy * 100, 0, 100),
    )
  })

  return { colors, memory }
}

/**
 * The whole wall on one colour, renewed at every beat.
 *
 * The hue moves by the golden angle on each beat, so two beats in a row are
 * never close in colour, and the light fades in between rather than holding.
 * The level keeps a floor under it: a quiet passage between beats should dim
 * the wall, not switch it off.
 */
export const pulse: Mode = (features, layout, settings, memory) => {
  const pulseHue = features.beat
    ? (memory.pulseHue + BEAT_HUE_STEP) % 360
    : memory.pulseHue
  const remaining = features.beat ? 1 : Math.max(0, memory.pulse - PULSE_FALL)

  const floor = bound(features.level * settings.sensitivity, 0, 1) * 0.3
  const brightness = bound(Math.max(floor, remaining) * 100, 0, 100)
  const color = hsbToRgb(pulseHue, 85, brightness)

  return {
    colors: layout.panels.map(() => color),
    memory: { ...memory, pulseHue, pulse: remaining },
  }
}
