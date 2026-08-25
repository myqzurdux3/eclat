import { hsbToRgb } from './color'
import type { Color, DeviceState, EffectPalette, NormalizedPanel } from './types'

/** Muted grey shown while the device state is still unknown. */
const NEUTRAL: Color = { r: 40, g: 42, b: 52 }
const OFF: Color = { r: 0, g: 0, b: 0 }

const dim = (color: Color, factor: number): Color => ({
  r: Math.round(color.r * factor),
  g: Math.round(color.g * factor),
  b: Math.round(color.b * factor),
})

/**
 * The colour to show for each panel.
 *
 * The device publishes no per-panel colour: only streaming knows it, and only
 * for what it sends itself. Outside streaming we approximate — the current
 * effect's palette spread over the wall, or the configured hue in solid
 * colour mode. This is a mock-up faithful to the device's state, not a
 * reading of its LEDs.
 */
export function wallColors(
  panels: NormalizedPanel[],
  state: DeviceState | null,
  palettes: EffectPalette[],
  painted: Map<number, Color>,
): Map<number, Color> {
  const colors = new Map<number, Color>()

  const palette =
    state !== null && state.colorMode === 'effect'
      ? palettes.find((entry) => entry.name === state.effect)?.colors
      : undefined
  const factor = state === null ? 1 : Math.max(0, Math.min(100, state.brightness)) / 100

  panels.forEach((panel, index) => {
    // A painted panel was painted on purpose: it keeps its full colour.
    const paintedColour = painted.get(panel.panelId)
    if (paintedColour !== undefined) {
      colors.set(panel.panelId, paintedColour)
      return
    }

    if (state === null) {
      colors.set(panel.panelId, NEUTRAL)
      return
    }

    if (!state.on) {
      colors.set(panel.panelId, OFF)
      return
    }

    if (palette !== undefined && palette.length > 0) {
      colors.set(panel.panelId, dim(palette[index % palette.length]!, factor))
      return
    }

    // In effect mode `hue` and `sat` are stale: the device stops updating
    // them as soon as a scene runs, and they often sit at 0/0 — pure white.
    // Showing that white would suggest a wall lit white when in truth we
    // simply do not know what it is showing.
    const base = state.colorMode === 'effect' ? NEUTRAL : hsbToRgb(state.hue, state.sat, 100)

    colors.set(panel.panelId, dim(base, factor))
  })

  return colors
}
