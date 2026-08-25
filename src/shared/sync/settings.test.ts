import { describe, expect, it } from 'vitest'
import { clampSettings, DEFAULT_SYNC_SETTINGS } from './settings'

describe('DEFAULT_SYNC_SETTINGS', () => {
  it('reprend les valeurs de la spec', () => {
    expect(DEFAULT_SYNC_SETTINGS).toEqual({
      mode: 'spatial',
      radius: 0.18,
      saturation: 1.25,
      blackFloor: 0.04,
      attack: 0.6,
      release: 0.15,
      hz: 25,
    })
  })
})

describe('clampSettings', () => {
  it('complète les réglages manquants par le défaut', () => {
    expect(clampSettings({ saturation: 1.5 })).toEqual({
      ...DEFAULT_SYNC_SETTINGS,
      saturation: 1.5,
    })
  })

  it('borne chaque réglage par le haut', () => {
    expect(
      clampSettings({
        radius: 9,
        saturation: 9,
        blackFloor: 9,
        attack: 9,
        release: 9,
        hz: 900,
      }),
    ).toEqual({
      mode: 'spatial',
      radius: 0.5,
      saturation: 2,
      blackFloor: 0.2,
      attack: 1,
      release: 0.5,
      hz: 30,
    })
  })

  it('borne chaque réglage par le bas', () => {
    expect(
      clampSettings({
        radius: -1,
        saturation: -1,
        blackFloor: -1,
        attack: -1,
        release: -1,
        hz: -1,
      }),
    ).toEqual({
      mode: 'spatial',
      radius: 0.05,
      saturation: 0.5,
      blackFloor: 0,
      attack: 0.1,
      release: 0.02,
      hz: 10,
    })
  })

  it('accepte les trois modes et refuse le reste', () => {
    expect(clampSettings({ mode: 'dominant' }).mode).toBe('dominant')
    expect(clampSettings({ mode: 'palette' }).mode).toBe('palette')
    expect(clampSettings({ mode: 'inconnu' as never }).mode).toBe('spatial')
  })

  it('ignore les valeurs non numériques', () => {
    expect(clampSettings({ radius: Number.NaN }).radius).toBe(DEFAULT_SYNC_SETTINGS.radius)
  })
})
