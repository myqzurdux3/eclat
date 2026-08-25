import { describe, expect, it } from 'vitest'
import { averageLinear, toLinear, toSrgb, type Frame } from './srgb'

/** Builds a flat image, then lets callers paint regions into it. */
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

function paint(f: Frame, x0: number, x1: number, color: [number, number, number]): void {
  for (let y = 0; y < f.height; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = color[0]
      f.data[at + 1] = color[1]
      f.data[at + 2] = color[2]
    }
  }
}

describe('toLinear and toSrgb', () => {
  it('keep black and white exact', () => {
    expect(toLinear(0)).toBe(0)
    expect(toLinear(255)).toBeCloseTo(1, 10)
    expect(toSrgb(0)).toBe(0)
    expect(toSrgb(1)).toBe(255)
  })

  it('round-trip losslessly across all 256 values', () => {
    for (let value = 0; value <= 255; value += 1) {
      expect(toSrgb(toLinear(value))).toBe(value)
    }
  })

  it('place mid grey below half in linear space', () => {
    // sRGB 128 is about 0.216 in linear space — which is the whole point.
    expect(toLinear(128)).toBeCloseTo(0.2158, 3)
  })

  it('clamp out-of-range inputs', () => {
    expect(toSrgb(-1)).toBe(0)
    expect(toSrgb(2)).toBe(255)
  })
})

describe('averageLinear', () => {
  const whole = (f: Frame) => ({ x: 0, y: 0, width: f.width, height: f.height })

  it('returns the colour unchanged on a flat image', () => {
    const f = frame(8, 8, [255, 0, 0])
    const mean = averageLinear(f, whole(f))

    expect(mean.r).toBeCloseTo(1, 6)
    expect(mean.g).toBeCloseTo(0, 6)
  })

  it('averages in linear space, not in sRGB', () => {
    // Half pure red, half black. A naive sRGB mean would give 128;
    // in linear space the mean is 0.5, which re-encodes to 188.
    const f = frame(8, 8, [0, 0, 0])
    paint(f, 0, 4, [255, 0, 0])

    const mean = averageLinear(f, whole(f))

    expect(mean.r).toBeCloseTo(0.5, 6)
    expect(toSrgb(mean.r)).toBe(188)
  })

  it('only looks at the requested rectangle', () => {
    const f = frame(8, 8, [0, 0, 0])
    paint(f, 0, 4, [255, 0, 0])

    const right = averageLinear(f, { x: 4, y: 0, width: 4, height: 8 })

    expect(right.r).toBeCloseTo(0, 6)
  })

  it('returns black for an empty rectangle', () => {
    const f = frame(8, 8, [255, 255, 255])

    expect(averageLinear(f, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('ignores pixels outside the image', () => {
    const f = frame(4, 4, [255, 255, 255])

    const mean = averageLinear(f, { x: 2, y: 2, width: 10, height: 10 })

    expect(mean.r).toBeCloseTo(1, 6)
  })
})
