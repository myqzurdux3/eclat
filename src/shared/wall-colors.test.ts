import { describe, expect, it } from 'vitest'
import { wallColors } from './wall-colors'
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

const rien = new Map<number, Color>()

describe('wallColors', () => {
  it('donne une couleur à chaque panneau', () => {
    expect([...wallColors(layout.panels, state(), palettes, rien).keys()]).toEqual([1, 2, 3])
  })

  it('la peinture manuelle prime sur tout le reste', () => {
    const peint = new Map([[2, { r: 1, g: 2, b: 3 }]])

    expect(wallColors(layout.panels, state(), palettes, peint).get(2)).toEqual({
      r: 1,
      g: 2,
      b: 3,
    })
  })

  it('reprend la teinte et la saturation hors mode effet', () => {
    const colors = wallColors(layout.panels, state({ hue: 120, sat: 100 }), palettes, rien)

    expect(colors.get(1)).toEqual({ r: 0, g: 255, b: 0 })
  })

  it('étale la palette de l effet courant sur les panneaux', () => {
    const courant = state({ colorMode: 'effect', effect: 'Blaze' })
    const colors = wallColors(layout.panels, courant, palettes, rien)

    expect(colors.get(1)).toEqual({ r: 200, g: 100, b: 0 })
    expect(colors.get(2)).toEqual({ r: 100, g: 50, b: 0 })
    // La palette est cyclée quand il y a plus de panneaux que de couleurs.
    expect(colors.get(3)).toEqual({ r: 200, g: 100, b: 0 })
  })

  it('atténue selon la luminosité du device', () => {
    const courant = state({ colorMode: 'effect', effect: 'Blaze', brightness: 50 })

    expect(wallColors(layout.panels, courant, palettes, rien).get(1)).toEqual({
      r: 100,
      g: 50,
      b: 0,
    })
  })

  it('éteint les panneaux quand le device est éteint', () => {
    const colors = wallColors(layout.panels, state({ on: false }), palettes, rien)

    expect(colors.get(1)).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('retombe sur la teinte quand la palette de l effet est inconnue', () => {
    const courant = state({ colorMode: 'effect', effect: 'Inconnu', hue: 240, sat: 100 })

    expect(wallColors(layout.panels, courant, palettes, rien).get(1)).toEqual({
      r: 0,
      g: 0,
      b: 255,
    })
  })

  it('rend une teinte neutre sans état connu', () => {
    const colors = wallColors(layout.panels, null, palettes, rien)

    expect(colors.get(1)).toBeDefined()
    expect(colors.get(1)).not.toEqual({ r: 0, g: 0, b: 0 })
  })

  it('garde la peinture visible même device éteint', () => {
    const peint = new Map([[1, { r: 255, g: 255, b: 255 }]])

    expect(wallColors(layout.panels, state({ on: false }), palettes, peint).get(1)).toEqual({
      r: 255,
      g: 255,
      b: 255,
    })
  })
})
