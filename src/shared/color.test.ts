import { describe, expect, it } from 'vitest'
import { hsbToRgb, hsvToWheel, wheelToHsv } from './color'

describe('hsbToRgb', () => {
  it('convertit les primaires saturées', () => {
    expect(hsbToRgb(0, 100, 100)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsbToRgb(120, 100, 100)).toEqual({ r: 0, g: 255, b: 0 })
    expect(hsbToRgb(240, 100, 100)).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('rend du blanc sans saturation et du noir sans luminosité', () => {
    expect(hsbToRgb(210, 0, 100)).toEqual({ r: 255, g: 255, b: 255 })
    expect(hsbToRgb(210, 80, 0)).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('convertit une entrée réelle de la palette Blaze', () => {
    expect(hsbToRgb(36, 92, 92)).toEqual({ r: 235, g: 148, b: 19 })
  })

  it('referme la roue : 360 équivaut à 0', () => {
    expect(hsbToRgb(360, 100, 100)).toEqual(hsbToRgb(0, 100, 100))
  })

  it('borne les entrées hors plage', () => {
    expect(hsbToRgb(0, 500, 500)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsbToRgb(0, -20, -20)).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('wheelToHsv', () => {
  it('rend une saturation nulle au centre', () => {
    expect(wheelToHsv(0, 0, 100)?.sat).toBe(0)
  })

  it('rend une saturation pleine au bord', () => {
    expect(wheelToHsv(100, 0, 100)?.sat).toBe(100)
  })

  it('place le rouge à droite et fait tourner la teinte dans le sens horaire', () => {
    expect(wheelToHsv(100, 0, 100)?.hue).toBeCloseTo(0, 6)
    expect(wheelToHsv(0, 100, 100)?.hue).toBeCloseTo(90, 6)
    expect(wheelToHsv(-100, 0, 100)?.hue).toBeCloseTo(180, 6)
  })

  it('ignore un point hors du disque', () => {
    expect(wheelToHsv(101, 0, 100)).toBeNull()
  })

  it('accepte un rayon nul sans diviser par zéro', () => {
    expect(wheelToHsv(0, 0, 0)).toEqual({ hue: 0, sat: 0 })
  })
})

describe('hsvToWheel', () => {
  it('ramène le centre pour une saturation nulle', () => {
    expect(hsvToWheel(210, 0, 100)).toEqual({ dx: 0, dy: 0 })
  })

  it('fait l aller-retour sans perte', () => {
    const back = wheelToHsv(hsvToWheel(200, 60, 100).dx, hsvToWheel(200, 60, 100).dy, 100)

    expect(back?.hue).toBeCloseTo(200, 6)
    expect(back?.sat).toBeCloseTo(60, 6)
  })
})
