import { describe, expect, it } from 'vitest'
import { hsbToRgb, hsvToWheel, wheelToHsv } from './color'

describe('hsbToRgb', () => {
  it('converts the saturated primaries', () => {
    expect(hsbToRgb(0, 100, 100)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsbToRgb(120, 100, 100)).toEqual({ r: 0, g: 255, b: 0 })
    expect(hsbToRgb(240, 100, 100)).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('returns white without saturation and black without brightness', () => {
    expect(hsbToRgb(210, 0, 100)).toEqual({ r: 255, g: 255, b: 255 })
    expect(hsbToRgb(210, 80, 0)).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('converts a real entry from the Blaze palette', () => {
    expect(hsbToRgb(36, 92, 92)).toEqual({ r: 235, g: 148, b: 19 })
  })

  it('closes the wheel: 360 equals 0', () => {
    expect(hsbToRgb(360, 100, 100)).toEqual(hsbToRgb(0, 100, 100))
  })

  it('bounds out-of-range inputs', () => {
    expect(hsbToRgb(0, 500, 500)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsbToRgb(0, -20, -20)).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('wheelToHsv', () => {
  it('returns zero saturation at the centre', () => {
    expect(wheelToHsv(0, 0, 100)?.sat).toBe(0)
  })

  it('returns full saturation at the edge', () => {
    expect(wheelToHsv(100, 0, 100)?.sat).toBe(100)
  })

  it('puts red on the right and turns hue clockwise', () => {
    expect(wheelToHsv(100, 0, 100)?.hue).toBeCloseTo(0, 6)
    expect(wheelToHsv(0, 100, 100)?.hue).toBeCloseTo(90, 6)
    expect(wheelToHsv(-100, 0, 100)?.hue).toBeCloseTo(180, 6)
  })

  it('ignores a point outside the disc', () => {
    expect(wheelToHsv(101, 0, 100)).toBeNull()
  })

  it('accepts a zero radius without dividing by zero', () => {
    expect(wheelToHsv(0, 0, 0)).toEqual({ hue: 0, sat: 0 })
  })
})

describe('hsvToWheel', () => {
  it('lands on the centre for zero saturation', () => {
    expect(hsvToWheel(210, 0, 100)).toEqual({ dx: 0, dy: 0 })
  })

  it('round-trips without loss', () => {
    const back = wheelToHsv(hsvToWheel(200, 60, 100).dx, hsvToWheel(200, 60, 100).dy, 100)

    expect(back?.hue).toBeCloseTo(200, 6)
    expect(back?.sat).toBeCloseTo(60, 6)
  })
})
