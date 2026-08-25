import { describe, expect, it } from 'vitest'
import { dominantColor, paletteColors } from './mapping-clusters'
import { toSrgb, type Frame } from './srgb'

function frame(width: number, height: number): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255
  return { width, height, data }
}

/** Peint les `count` premiers pixels de l'image. */
function pixels(f: Frame, from: number, count: number, [r, g, b]: [number, number, number]): void {
  for (let i = from; i < from + count; i += 1) {
    f.data[i * 4] = r
    f.data[i * 4 + 1] = g
    f.data[i * 4 + 2] = b
  }
}

const entier = (f: Frame) => ({ x: 0, y: 0, width: f.width, height: f.height })

describe('dominantColor', () => {
  it('rend la couleur d une image unie', () => {
    const f = frame(16, 16)
    pixels(f, 0, 256, [255, 0, 0])

    const dominante = dominantColor(f, entier(f))

    expect(toSrgb(dominante.r)).toBeGreaterThan(200)
    expect(toSrgb(dominante.b)).toBeLessThan(60)
  })

  it('préfère une petite zone vive à un grand aplat gris', () => {
    // 90 % de gris, 10 % de rouge vif : c'est le rouge qui doit sortir,
    // la pondération par saturation étant faite pour ça.
    const f = frame(16, 16)
    pixels(f, 0, 230, [128, 128, 128])
    pixels(f, 230, 26, [255, 0, 0])

    const dominante = dominantColor(f, entier(f))

    expect(dominante.r).toBeGreaterThan(dominante.g * 3)
  })

  it('rend du noir sur une image noire', () => {
    const f = frame(16, 16)

    const dominante = dominantColor(f, entier(f))

    expect(dominante.r).toBeCloseTo(0, 6)
    expect(dominante.g).toBeCloseTo(0, 6)
  })

  it('rend du noir sur un rectangle vide', () => {
    const f = frame(16, 16)
    pixels(f, 0, 256, [255, 0, 0])

    expect(dominantColor(f, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('paletteColors', () => {
  it('sort deux couleurs distinctes d une image bicolore', () => {
    const f = frame(16, 16)
    pixels(f, 0, 128, [255, 0, 0])
    pixels(f, 128, 128, [0, 0, 255])

    const palette = paletteColors(f, entier(f), 2)

    expect(palette).toHaveLength(2)
    const rouges = palette.filter((c) => c.r > c.b)
    const bleus = palette.filter((c) => c.b > c.r)
    expect(rouges).toHaveLength(1)
    expect(bleus).toHaveLength(1)
  })

  it('ne duplique pas quand l image a moins de couleurs que demandé', () => {
    const f = frame(16, 16)
    pixels(f, 0, 256, [0, 200, 0])

    expect(paletteColors(f, entier(f), 5)).toHaveLength(1)
  })

  it('respecte le nombre demandé quand l image est assez riche', () => {
    const f = frame(16, 16)
    pixels(f, 0, 64, [255, 0, 0])
    pixels(f, 64, 64, [0, 255, 0])
    pixels(f, 128, 64, [0, 0, 255])
    pixels(f, 192, 64, [255, 255, 0])

    expect(paletteColors(f, entier(f), 3)).toHaveLength(3)
  })

  it('classe la couleur la plus présente en premier', () => {
    const f = frame(16, 16)
    pixels(f, 0, 200, [255, 0, 0])
    pixels(f, 200, 56, [0, 0, 255])

    const [premiere] = paletteColors(f, entier(f), 2)

    expect(premiere!.r).toBeGreaterThan(premiere!.b)
  })

  it('rend un tableau vide sur une image noire', () => {
    expect(paletteColors(frame(16, 16), entier(frame(16, 16)), 3)).toEqual([])
  })
})
