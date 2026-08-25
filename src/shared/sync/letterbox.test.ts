import { describe, expect, it } from 'vitest'
import { detectLetterbox } from './letterbox'
import type { Frame } from './srgb'

function frame(width: number, height: number, fill = 0): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(fill)
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255
  return { width, height, data }
}

function band(f: Frame, y0: number, y1: number, value: number): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < f.width; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = value
      f.data[at + 1] = value
      f.data[at + 2] = value
    }
  }
}

function column(f: Frame, x0: number, x1: number, value: number): void {
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
  it('returns the whole image when it is full', () => {
    const f = frame(64, 36, 200)

    expect(detectLetterbox(f)).toEqual({ x: 0, y: 0, width: 64, height: 36 })
  })

  it('removes horizontal bars', () => {
    const f = frame(64, 36)
    band(f, 8, 28, 200)

    expect(detectLetterbox(f)).toEqual({ x: 0, y: 8, width: 64, height: 20 })
  })

  it('removes vertical bars', () => {
    const f = frame(64, 36)
    column(f, 10, 54, 200)

    expect(detectLetterbox(f)).toEqual({ x: 10, y: 0, width: 44, height: 36 })
  })

  it('removes both at once', () => {
    const f = frame(64, 36)
    band(f, 6, 30, 200)
    column(f, 0, 10, 0)
    column(f, 54, 64, 0)

    expect(detectLetterbox(f)).toEqual({ x: 10, y: 6, width: 44, height: 24 })
  })

  it('sees the imperfect black bars left by compression', () => {
    const f = frame(64, 36, 6)
    band(f, 8, 28, 200)

    expect(detectLetterbox(f).y).toBe(8)
  })

  it('returns the whole image when it is all black', () => {
    // A night scene is not letterboxing: better to keep everything than
    // to hand back an empty rectangle.
    expect(detectLetterbox(frame(64, 36))).toEqual({ x: 0, y: 0, width: 64, height: 36 })
  })

  it('gives up when the crop would eat more than half the image', () => {
    const f = frame(64, 36)
    band(f, 17, 19, 200)

    expect(detectLetterbox(f)).toEqual({ x: 0, y: 0, width: 64, height: 36 })
  })

  it('never returns an empty rectangle', () => {
    const f = frame(64, 36, 1)
    const rect = detectLetterbox(f)

    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })
})
