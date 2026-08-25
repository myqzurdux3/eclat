import { describe, expect, it } from 'vitest'
import { detectLetterbox } from './letterbox'
import type { Frame } from './srgb'

function frame(width: number, height: number, fill = 0): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(fill)
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255
  return { width, height, data }
}

function bande(f: Frame, y0: number, y1: number, value: number): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < f.width; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = value
      f.data[at + 1] = value
      f.data[at + 2] = value
    }
  }
}

function colonne(f: Frame, x0: number, x1: number, value: number): void {
  for (let y = 0; y < f.height; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = value
      f.data[at + 1] = value
      f.data[at + 2] = value
    }
  }
}

describe('detectLetterbox', () => {
  it('rend l image entière quand elle est pleine', () => {
    const f = frame(64, 36, 200)

    expect(detectLetterbox(f)).toEqual({ x: 0, y: 0, width: 64, height: 36 })
  })

  it('retire des bandes horizontales', () => {
    const f = frame(64, 36)
    bande(f, 8, 28, 200)

    expect(detectLetterbox(f)).toEqual({ x: 0, y: 8, width: 64, height: 20 })
  })

  it('retire des bandes verticales', () => {
    const f = frame(64, 36)
    colonne(f, 10, 54, 200)

    expect(detectLetterbox(f)).toEqual({ x: 10, y: 0, width: 44, height: 36 })
  })

  it('retire les deux à la fois', () => {
    const f = frame(64, 36)
    bande(f, 6, 30, 200)
    colonne(f, 0, 10, 0)
    colonne(f, 54, 64, 0)

    expect(detectLetterbox(f)).toEqual({ x: 10, y: 6, width: 44, height: 24 })
  })

  it('voit les bandes noires imparfaites de la compression', () => {
    const f = frame(64, 36, 6)
    bande(f, 8, 28, 200)

    expect(detectLetterbox(f).y).toBe(8)
  })

  it('rend l image entière si elle est toute noire', () => {
    // Une scène nocturne n'est pas un letterbox : mieux vaut tout garder
    // que renvoyer un rectangle vide.
    expect(detectLetterbox(frame(64, 36))).toEqual({ x: 0, y: 0, width: 64, height: 36 })
  })

  it('renonce quand le crop mangerait plus de la moitié de l image', () => {
    const f = frame(64, 36)
    bande(f, 17, 19, 200)

    expect(detectLetterbox(f)).toEqual({ x: 0, y: 0, width: 64, height: 36 })
  })

  it('ne rend jamais un rectangle vide', () => {
    const f = frame(64, 36, 1)
    const rect = detectLetterbox(f)

    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })
})
