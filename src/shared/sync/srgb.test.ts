import { describe, expect, it } from 'vitest'
import { toLinear, toSrgb } from './srgb'



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
