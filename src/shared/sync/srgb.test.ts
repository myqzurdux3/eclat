import { describe, expect, it } from 'vitest'
import { averageLinear, toLinear, toSrgb, type Frame } from './srgb'

/** Fabrique une image unie, puis laisse la peindre par zones. */
function frame(width: number, height: number, fill: [number, number, number]): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

function peindre(f: Frame, x0: number, x1: number, color: [number, number, number]): void {
  for (let y = 0; y < f.height; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = color[0]
      f.data[at + 1] = color[1]
      f.data[at + 2] = color[2]
    }
  }
}

describe('toLinear et toSrgb', () => {
  it('gardent le noir et le blanc exacts', () => {
    expect(toLinear(0)).toBe(0)
    expect(toLinear(255)).toBeCloseTo(1, 10)
    expect(toSrgb(0)).toBe(0)
    expect(toSrgb(1)).toBe(255)
  })

  it('font l aller-retour sans perte sur les 256 valeurs', () => {
    for (let value = 0; value <= 255; value += 1) {
      expect(toSrgb(toLinear(value))).toBe(value)
    }
  })

  it('placent le gris moyen sous la moitié en linéaire', () => {
    // 128 en sRGB vaut environ 0,216 en linéaire : c'est tout l'intérêt.
    expect(toLinear(128)).toBeCloseTo(0.2158, 3)
  })

  it('bornent les entrées hors plage', () => {
    expect(toSrgb(-1)).toBe(0)
    expect(toSrgb(2)).toBe(255)
  })
})

describe('averageLinear', () => {
  const rect = (f: Frame) => ({ x: 0, y: 0, width: f.width, height: f.height })

  it('rend la couleur telle quelle sur une image unie', () => {
    const f = frame(8, 8, [255, 0, 0])
    const moyenne = averageLinear(f, rect(f))

    expect(moyenne.r).toBeCloseTo(1, 6)
    expect(moyenne.g).toBeCloseTo(0, 6)
  })

  it('moyenne en linéaire, pas en sRGB', () => {
    // Moitié rouge pur, moitié noir. En sRGB naïf on obtiendrait 128 ;
    // en linéaire la moyenne vaut 0,5, soit 188 une fois réencodée.
    const f = frame(8, 8, [0, 0, 0])
    peindre(f, 0, 4, [255, 0, 0])

    const moyenne = averageLinear(f, rect(f))

    expect(moyenne.r).toBeCloseTo(0.5, 6)
    expect(toSrgb(moyenne.r)).toBe(188)
  })

  it('ne regarde que le rectangle demandé', () => {
    const f = frame(8, 8, [0, 0, 0])
    peindre(f, 0, 4, [255, 0, 0])

    const droite = averageLinear(f, { x: 4, y: 0, width: 4, height: 8 })

    expect(droite.r).toBeCloseTo(0, 6)
  })

  it('rend du noir sur un rectangle vide', () => {
    const f = frame(8, 8, [255, 255, 255])

    expect(averageLinear(f, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('ignore les pixels hors de l image', () => {
    const f = frame(4, 4, [255, 255, 255])

    const moyenne = averageLinear(f, { x: 2, y: 2, width: 10, height: 10 })

    expect(moyenne.r).toBeCloseTo(1, 6)
  })
})
