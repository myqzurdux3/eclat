import { describe, expect, it } from 'vitest'
import { OFF, wallColors } from './wall-colors'
import { normalizeLayout } from '../main/device/layout'
import type { Color, DeviceState, EffectPalette } from './types'

const layout = normalizeLayout(
  [
    { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
    { panelId: 2, x: 100, y: 0, o: 0, shapeType: 8 },
    { panelId: 3, x: 200, y: 0, o: 0, shapeType: 8 },
  ],
  100,
)

const state = (over: Partial<DeviceState> = {}): DeviceState => ({
  on: true,
  brightness: 100,
  hue: 0,
  sat: 100,
  ct: 4000,
  colorMode: 'hs',
  effect: '',
  ...over,
})

const palettes: EffectPalette[] = [
  {
    name: 'Blaze',
    colors: [
      { r: 200, g: 100, b: 0 },
      { r: 100, g: 50, b: 0 },
    ],
  },
]

const nothing = new Map<number, Color>()

describe('wallColors', () => {
  it('gives every panel a colour', () => {
    expect([...wallColors(layout.panels, state(), palettes, nothing).keys()]).toEqual([1, 2, 3])
  })

  it('manual painting wins over the effect and the solid colour', () => {
    const painted = new Map([[2, { r: 1, g: 2, b: 3 }]])

    expect(wallColors(layout.panels, state(), palettes, painted).get(2)).toEqual({
      r: 1,
      g: 2,
      b: 3,
    })
  })

  it('uses hue and saturation outside effect mode', () => {
    const colors = wallColors(layout.panels, state({ hue: 120, sat: 100 }), palettes, nothing)

    expect(colors.get(1)).toEqual({ r: 0, g: 255, b: 0 })
  })

  it('spreads the current effect palette over the panels', () => {
    const current = state({ colorMode: 'effect', effect: 'Blaze' })
    const colors = wallColors(layout.panels, current, palettes, nothing)

    expect(colors.get(1)).toEqual({ r: 200, g: 100, b: 0 })
    expect(colors.get(2)).toEqual({ r: 100, g: 50, b: 0 })
    // The palette cycles when there are more panels than colours.
    expect(colors.get(3)).toEqual({ r: 200, g: 100, b: 0 })
  })

  it('dims according to the device brightness', () => {
    const current = state({ colorMode: 'effect', effect: 'Blaze', brightness: 50 })

    expect(wallColors(layout.panels, current, palettes, nothing).get(1)).toEqual({
      r: 100,
      g: 50,
      b: 0,
    })
  })

  it('switches the panels off when the device is off', () => {
    const colors = wallColors(layout.panels, state({ on: false }), palettes, nothing)

    expect(colors.get(1)).toEqual(OFF)
  })

  it('stays neutral when the effect palette is unknown', () => {
    // In effect mode hue and saturation are stale: the device stops
    // updating them. Reading them would give pure white, suggesting a wall
    // lit white when in truth we simply do not know.
    const current = state({ colorMode: 'effect', effect: 'Inconnu', hue: 0, sat: 0 })
    const colour = wallColors(layout.panels, current, palettes, nothing).get(1)!

    const channels = [colour.r, colour.g, colour.b]

    expect(colour).not.toEqual({ r: 255, g: 255, b: 255 })
    expect(Math.max(...channels)).toBeLessThan(120)
    // Muted, so barely coloured: nothing is claimed about the real hue.
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(24)
  })

  it('returns white in desaturated solid-colour mode', () => {
    // Here, by contrast, the device really does say it is lighting white.
    const current = state({ colorMode: 'hs', hue: 0, sat: 0 })

    expect(wallColors(layout.panels, current, palettes, nothing).get(1)).toEqual({
      r: 255,
      g: 255,
      b: 255,
    })
  })

  it('returns a neutral tint with no known state', () => {
    const colors = wallColors(layout.panels, null, palettes, nothing)

    expect(colors.get(1)).toBeDefined()
    expect(colors.get(1)).not.toEqual(OFF)
  })

  /**
   * Manual painting drives every panel: the frame carries a colour for the
   * painted ones and black for all the rest. Showing the others under the
   * effect palette would be inventing light the wall does not emit.
   */
  it('switches unpainted panels off as soon as one is painted', () => {
    const painted = new Map([[2, { r: 255, g: 0, b: 0 }]])

    const colors = wallColors(layout.panels, state({ colorMode: 'effect', effect: 'Blaze' }), palettes, painted)

    expect(colors.get(2)).toEqual({ r: 255, g: 0, b: 0 })
    expect(colors.get(1)).toEqual(OFF)
    expect(colors.get(3)).toEqual(OFF)
  })

  it('leaves the effect alone while nothing is painted', () => {
    const colors = wallColors(layout.panels, state({ colorMode: 'effect', effect: 'Blaze' }), palettes, nothing)

    expect(colors.get(1)).not.toEqual(OFF)
  })

  /**
   * Power beats painting. The device cuts its LEDs whatever external control
   * last sent it, so a painted panel drawn lit over an off wall is the
   * mock-up contradicting the room.
   */
  it('switches painted panels off along with the device', () => {
    const painted = new Map([[1, { r: 255, g: 255, b: 255 }]])

    expect(wallColors(layout.panels, state({ on: false }), palettes, painted).get(1)).toEqual(OFF)
  })

  /**
   * Switching a panel off writes black into the painting, and black is what
   * the wall receives. On screen it has to read as unlit rather than vanish:
   * a panel nobody can see is a panel nobody can click back on.
   */
  it('draws a panel switched off by hand as unlit, not as a hole', () => {
    const painted = new Map([[1, { r: 0, g: 0, b: 0 }]])

    expect(wallColors(layout.panels, state(), palettes, painted).get(1)).toEqual(OFF)
  })

  /**
   * The stage behind the wall is nearly black. An unlit panel drawn in pure
   * black left nothing on screen to aim at once the wall was switched off.
   */
  it('keeps an unlit panel visible against the stage', () => {
    expect(OFF).not.toEqual({ r: 0, g: 0, b: 0 })
  })

  it('paints again as soon as the device comes back on', () => {
    const painted = new Map([[1, { r: 255, g: 255, b: 255 }]])

    expect(wallColors(layout.panels, state({ on: true }), palettes, painted).get(1)).toEqual({
      r: 255,
      g: 255,
      b: 255,
    })
  })
})
