import { describe, expect, it } from 'vitest'
import { mapSpatial } from './mapping-spatial'
import { normalizeLayout } from '../../main/device/layout'
import { toLinear, type Frame } from './srgb'

function frame(width: number, height: number): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255
  return { width, height, data }
}

function paint(
  f: Frame,
  x0: number,
  x1: number,
  [r, g, b]: [number, number, number],
): void {
  for (let y = 0; y < f.height; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = r
      f.data[at + 1] = g
      f.data[at + 2] = b
    }
  }
}

/** Two panels, one on the left, one on the right. */
const pair = normalizeLayout(
  [
    { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
    { panelId: 2, x: 300, y: 0, o: 0, shapeType: 8 },
  ],
  100,
)

const wholeRect = (f: Frame) => ({ x: 0, y: 0, width: f.width, height: f.height })

function halfRedHalfBlue(): Frame {
  const f = frame(64, 36)
  paint(f, 0, 32, [255, 0, 0])
  paint(f, 32, 64, [0, 0, 255])
  return f
}

describe('mapSpatial', () => {
  it('returns one colour per panel', () => {
    expect(mapSpatial(halfRedHalfBlue(), wholeRect(halfRedHalfBlue()), pair, 0.18)).toHaveLength(
      2,
    )
  })

  it('gives the left panel the colour on the left', () => {
    const f = halfRedHalfBlue()
    const [left, right] = mapSpatial(f, wholeRect(f), pair, 0.12)

    expect(left!.r).toBeGreaterThan(left!.b)
    expect(right!.b).toBeGreaterThan(right!.r)
  })

  it('a wide radius brings panels together, a narrow one separates them', () => {
    const f = halfRedHalfBlue()
    const gap = (radius: number) => {
      const [a, b] = mapSpatial(f, wholeRect(f), pair, radius)
      return Math.abs(a!.r - b!.r)
    }

    expect(gap(0.5)).toBeLessThan(gap(0.05))
  })

  it('only looks at the useful rectangle', () => {
    const f = frame(64, 36)
    // Black bars top and bottom, red picture in the middle.
    paint(f, 0, 64, [0, 0, 0])
    for (let y = 10; y < 26; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const at = (y * 64 + x) * 4
        f.data[at] = 255
      }
    }

    const cropped = mapSpatial(f, { x: 0, y: 10, width: 64, height: 16 }, pair, 0.18)

    expect(cropped[0]!.r).toBeGreaterThan(0.9)
  })

  it('returns an empty array for a wall with no panels', () => {
    const f = halfRedHalfBlue()

    expect(mapSpatial(f, wholeRect(f), normalizeLayout([], 100), 0.18)).toEqual([])
  })

  it('never returns NaN, even at a tiny radius', () => {
    const f = halfRedHalfBlue()

    for (const color of mapSpatial(f, wholeRect(f), pair, 0.001)) {
      expect(Number.isFinite(color.r)).toBe(true)
      expect(Number.isFinite(color.g)).toBe(true)
      expect(Number.isFinite(color.b)).toBe(true)
    }
  })

  it('stays black when the image is black', () => {
    const f = frame(64, 36)

    for (const color of mapSpatial(f, wholeRect(f), pair, 0.18)) {
      expect(color.r).toBeCloseTo(0, 6)
    }
  })
})

describe('mapSpatial — the separable form', () => {
  /**
   * The weights are built from a row table and a column table rather than
   * one exponential per pixel. That is an identity, not an approximation:
   * this pins it against the definition it replaced.
   */
  it('matches the Gaussian evaluated pixel by pixel', () => {
    const width = 32
    const height = 18
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 37) % 256

    const frame = { width, height, data }
    const rect = { x: 0, y: 0, width, height }
    const layout = normalizeLayout(
      Array.from({ length: 9 }, (_, index) => ({
        panelId: index + 1,
        x: (index % 3) * 100,
        y: Math.floor(index / 3) * 100,
        o: 0,
        shapeType: 8,
      })),
      100,
    )

    const radius = 0.18
    const sigma = Math.max(radius, 0.5 / Math.max(width, height))
    const twoSigmaSquared = 2 * sigma * sigma

    const reference = layout.panels.map((panel) => {
      let r = 0
      let g = 0
      let b = 0
      let total = 0
      for (let y = 0; y < height; y += 1) {
        const dy = (y + 0.5) / height - panel.ny
        for (let x = 0; x < width; x += 1) {
          const dx = (x + 0.5) / width - panel.nx
          const weight = Math.exp(-(dx * dx + dy * dy) / twoSigmaSquared)
          if (weight < 1e-6) continue
          const at = (y * width + x) * 4
          r += weight * toLinear(data[at]!)
          g += weight * toLinear(data[at + 1]!)
          b += weight * toLinear(data[at + 2]!)
          total += weight
        }
      }
      return { r: r / total, g: g / total, b: b / total }
    })

    const actual = mapSpatial(frame, rect, layout, radius)

    actual.forEach((colour, index) => {
      expect(colour.r).toBeCloseTo(reference[index]!.r, 12)
      expect(colour.g).toBeCloseTo(reference[index]!.g, 12)
      expect(colour.b).toBeCloseTo(reference[index]!.b, 12)
    })
  })
})
