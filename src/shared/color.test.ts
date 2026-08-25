import { describe, expect, it } from 'vitest'
import { hsbToRgb } from './color'

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
