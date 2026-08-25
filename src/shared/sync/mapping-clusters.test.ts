import { describe, expect, it } from 'vitest'
import { dominantColor, paletteColors } from './mapping-clusters'
import { toSrgb, type Frame } from './srgb'

function frame(width: number, height: number): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255
  return { width, height, data }
}

/** Paints the first `count` pixels of the image. */
function pixels(f: Frame, from: number, count: number, [r, g, b]: [number, number, number]): void {
  for (let i = from; i < from + count; i += 1) {
    f.data[i * 4] = r
    f.data[i * 4 + 1] = g
    f.data[i * 4 + 2] = b
  }
}

const whole = (f: Frame) => ({ x: 0, y: 0, width: f.width, height: f.height })

describe('dominantColor', () => {
  it('returns the colour of a flat image', () => {
    const f = frame(16, 16)
    pixels(f, 0, 256, [255, 0, 0])

    const dominant = dominantColor(f, whole(f))

    expect(toSrgb(dominant.r)).toBeGreaterThan(200)
    expect(toSrgb(dominant.b)).toBeLessThan(60)
  })

  it('prefers a small vivid area over a large flat grey', () => {
    // 90 % grey, 10 % vivid red: red has to win — that is exactly what
    // the saturation weighting is for.
    const f = frame(16, 16)
    pixels(f, 0, 230, [128, 128, 128])
    pixels(f, 230, 26, [255, 0, 0])

    const dominant = dominantColor(f, whole(f))

    expect(dominant.r).toBeGreaterThan(dominant.g * 3)
  })

  it('returns black on a black image', () => {
    const f = frame(16, 16)

    const dominant = dominantColor(f, whole(f))

    expect(dominant.r).toBeCloseTo(0, 6)
    expect(dominant.g).toBeCloseTo(0, 6)
  })

  it('returns black for an empty rectangle', () => {
    const f = frame(16, 16)
    pixels(f, 0, 256, [255, 0, 0])

    expect(dominantColor(f, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('paletteColors', () => {
  it('extracts two distinct colours from a two-colour image', () => {
    const f = frame(16, 16)
    pixels(f, 0, 128, [255, 0, 0])
    pixels(f, 128, 128, [0, 0, 255])

    const palette = paletteColors(f, whole(f), 2)

    expect(palette).toHaveLength(2)
    const reds = palette.filter((c) => c.r > c.b)
    const blues = palette.filter((c) => c.b > c.r)
    expect(reds).toHaveLength(1)
    expect(blues).toHaveLength(1)
  })

  it('does not duplicate when the image has fewer colours than asked for', () => {
    const f = frame(16, 16)
    pixels(f, 0, 256, [0, 200, 0])

    expect(paletteColors(f, whole(f), 5)).toHaveLength(1)
  })

  it('honours the requested count when the image is rich enough', () => {
    const f = frame(16, 16)
    pixels(f, 0, 64, [255, 0, 0])
    pixels(f, 64, 64, [0, 255, 0])
    pixels(f, 128, 64, [0, 0, 255])
    pixels(f, 192, 64, [255, 255, 0])

    expect(paletteColors(f, whole(f), 3)).toHaveLength(3)
  })

  it('ranks the most present colour first', () => {
    const f = frame(16, 16)
    pixels(f, 0, 200, [255, 0, 0])
    pixels(f, 200, 56, [0, 0, 255])

    const [first] = paletteColors(f, whole(f), 2)

    expect(first!.r).toBeGreaterThan(first!.b)
  })

  it('returns an empty array on a black image', () => {
    expect(paletteColors(frame(16, 16), whole(frame(16, 16)), 3)).toEqual([])
  })
})
