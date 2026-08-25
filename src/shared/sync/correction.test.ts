import { describe, expect, it } from 'vitest'
import { applyCorrection } from './correction'
import { luminance } from './srgb'
import { DEFAULT_SYNC_SETTINGS } from './settings'

const reglages = (over: Partial<typeof DEFAULT_SYNC_SETTINGS> = {}) => ({
  ...DEFAULT_SYNC_SETTINGS,
  ...over,
})

describe('applyCorrection', () => {
  it('ne touche à rien avec une saturation neutre et aucun plancher', () => {
    const couleur = { r: 0.4, g: 0.2, b: 0.1 }

    const corrigee = applyCorrection(couleur, reglages({ saturation: 1, blackFloor: 0 }))

    expect(corrigee.r).toBeCloseTo(0.4, 6)
    expect(corrigee.g).toBeCloseTo(0.2, 6)
    expect(corrigee.b).toBeCloseTo(0.1, 6)
  })

  it('écarte les canaux quand la saturation monte', () => {
    const couleur = { r: 0.5, g: 0.3, b: 0.3 }
    const settings = reglages({ saturation: 2, blackFloor: 0 })

    const corrigee = applyCorrection(couleur, settings)

    expect(corrigee.r - corrigee.g).toBeGreaterThan(couleur.r - couleur.g)
  })

  it('garde la luminance en poussant la saturation', () => {
    const couleur = { r: 0.5, g: 0.3, b: 0.2 }

    const corrigee = applyCorrection(couleur, reglages({ saturation: 1.8, blackFloor: 0 }))

    expect(luminance(corrigee)).toBeCloseTo(luminance(couleur), 6)
  })

  it('laisse un gris gris, quelle que soit la saturation', () => {
    const gris = { r: 0.3, g: 0.3, b: 0.3 }

    const corrigee = applyCorrection(gris, reglages({ saturation: 2, blackFloor: 0 }))

    expect(corrigee.r).toBeCloseTo(corrigee.g, 6)
    expect(corrigee.g).toBeCloseTo(corrigee.b, 6)
  })

  it('écrase à zéro ce qui passe sous le plancher de noir', () => {
    const sombre = { r: 0.02, g: 0.02, b: 0.02 }

    expect(applyCorrection(sombre, reglages({ blackFloor: 0.05 }))).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('laisse passer ce qui est juste au-dessus du plancher', () => {
    const couleur = { r: 0.2, g: 0.2, b: 0.2 }

    const corrigee = applyCorrection(couleur, reglages({ blackFloor: 0.05 }))

    expect(corrigee.r).toBeGreaterThan(0)
  })

  it('ne sort jamais des bornes', () => {
    const vif = { r: 1, g: 0, b: 0 }

    const corrigee = applyCorrection(vif, reglages({ saturation: 2, blackFloor: 0 }))

    expect(corrigee.r).toBeLessThanOrEqual(1)
    expect(corrigee.g).toBeGreaterThanOrEqual(0)
  })
})
