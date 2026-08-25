import { describe, expect, it } from 'vitest'
import { sceneMotion } from './scene-motion'
import type { Color } from './types'

const palette: Color[] = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
]

describe('sceneMotion', () => {
  it('returns one colour per panel', () => {
    expect(sceneMotion(palette, 5, 0)).toHaveLength(5)
  })

  it('returns black with no palette', () => {
    expect(sceneMotion([], 2, 0)).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
    ])
  })

  it('returns an empty array with no panels', () => {
    expect(sceneMotion(palette, 0, 0)).toEqual([])
  })

  it('holds the single colour of a one-entry palette', () => {
    const single = [{ r: 10, g: 20, b: 30 }]

    for (const colour of sceneMotion(single, 4, 1234)) {
      expect(colour).toEqual({ r: 10, g: 20, b: 30 })
    }
  })

  it('moves forward in time', () => {
    const start = sceneMotion(palette, 6, 0)
    const later = sceneMotion(palette, 6, 1500)

    expect(later).not.toEqual(start)
  })

  it('loops over its period without a jump', () => {
    const period = 3 * 4000
    const after = sceneMotion(palette, 6, period)
    const start = sceneMotion(palette, 6, 0)

    // Within one level: `3 + 1.05` and `1.05` do not share a mantissa.
    after.forEach((colour, index) => {
      expect(Math.abs(colour.r - start[index]!.r)).toBeLessThanOrEqual(1)
      expect(Math.abs(colour.g - start[index]!.g)).toBeLessThanOrEqual(1)
      expect(Math.abs(colour.b - start[index]!.b)).toBeLessThanOrEqual(1)
    })
  })

  it('offsets the panels from one another', () => {
    const colours = sceneMotion(palette, 6, 0)

    expect(colours[0]).not.toEqual(colours[3])
  })

  it('interpolates between two palette entries', () => {
    // Halfway between red and green, both channels are present.
    const middle = sceneMotion([palette[0]!, palette[1]!], 1, 2000, { durationMs: 4000 })[0]!

    expect(middle.r).toBeGreaterThan(0)
    expect(middle.g).toBeGreaterThan(0)
  })

  it('stays within the RGB bounds', () => {
    for (const t of [0, 137, 999, 5000, 123456]) {
      for (const colour of sceneMotion(palette, 9, t)) {
        for (const channel of [colour.r, colour.g, colour.b]) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(255)
          expect(Number.isInteger(channel)).toBe(true)
        }
      }
    }
  })

  it('tightens or spreads the wave as asked', () => {
    const tight = sceneMotion(palette, 6, 0, { spread: 0 })
    const wide = sceneMotion(palette, 6, 0, { spread: 1 })

    // With no spread, every panel shares the same colour.
    expect(tight.every((colour) => colour === tight[0] || sameColour(colour, tight[0]!))).toBe(
      true,
    )
    expect(sameColour(wide[0]!, wide[3]!)).toBe(false)
  })
})

function sameColour(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}
