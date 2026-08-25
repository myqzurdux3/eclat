import { describe, expect, it } from 'vitest'
import { fitTransform, unproject, wallBounds } from './view'
import { normalizeLayout } from '../main/device/layout'
import { panelPolygon } from './geometry'

const row = normalizeLayout(
  [
    { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
    { panelId: 2, x: 200, y: 0, o: 0, shapeType: 8 },
  ],
  100,
)

describe('wallBounds', () => {
  it('encloses the vertices, not just the centres', () => {
    const bounds = wallBounds(row)
    const vertices = row.panels.flatMap((panel) => panelPolygon(panel, row.nSideLength))

    expect(bounds.minX).toBeCloseTo(Math.min(...vertices.map((p) => p.x)), 6)
    expect(bounds.maxY).toBeCloseTo(Math.max(...vertices.map((p) => p.y)), 6)
  })

  it('overflows the box of centres', () => {
    expect(wallBounds(row).minX).toBeLessThan(0)
  })

  it('returns a unit box with no panels', () => {
    expect(wallBounds(normalizeLayout([], 100))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    })
  })
})

describe('fitTransform', () => {
  const square = { minX: 0, minY: 0, maxX: 1, maxY: 1 }

  it('keeps squares square in a square canvas', () => {
    const { scale } = fitTransform(square, 1)

    expect(scale[0]).toBeCloseTo(scale[1], 6)
  })

  it('compensates a wide canvas by tightening the X axis', () => {
    const { scale } = fitTransform(square, 2)

    expect(scale[0]).toBeCloseTo(scale[1] / 2, 6)
  })

  it('aims at the centre of the box', () => {
    const { centre } = fitTransform({ minX: 2, minY: 4, maxX: 6, maxY: 10 }, 1)

    expect(centre).toEqual([4, 7])
  })

  it('fits inside clip space, margin included', () => {
    const { scale } = fitTransform(square, 1, 0.9)

    // Half the content width, scaled, stays under the margin.
    expect(0.5 * scale[0]).toBeLessThanOrEqual(0.9 + 1e-9)
    expect(0.5 * scale[1]).toBeCloseTo(0.9, 6)
  })

  it('fills the constrained axis, leaving no gap', () => {
    // Content twice as wide as it is tall in a square canvas: X is the
    // constraint, and it has to touch the margin.
    const { scale } = fitTransform({ minX: 0, minY: 0, maxX: 2, maxY: 1 }, 1, 0.9)

    expect(1 * scale[0]).toBeCloseTo(0.9, 6)
    expect(0.5 * scale[1]).toBeLessThanOrEqual(0.9 + 1e-9)
  })

  it('survives a degenerate box', () => {
    const { scale } = fitTransform({ minX: 3, minY: 3, maxX: 3, maxY: 3 }, 1)

    expect(Number.isFinite(scale[0])).toBe(true)
    expect(Number.isFinite(scale[1])).toBe(true)
  })
})

describe('unproject', () => {
  it('maps the centre of the box to the centre of the canvas', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const transform = fitTransform(bounds, 1)

    const point = unproject(transform, 0.5, 0.5)

    expect(point.x).toBeCloseTo(0.5, 6)
    expect(point.y).toBeCloseTo(0.5, 6)
  })

  it('round-trips an arbitrary point', () => {
    const transform = fitTransform({ minX: -0.2, minY: 0.1, maxX: 1.3, maxY: 0.9 }, 1.6, 0.9)
    // The forward projection, the one the shader performs.
    const target = { x: 0.42, y: 0.61 }
    const ndcX = (target.x - transform.centre[0]) * transform.scale[0]
    const ndcY = -(target.y - transform.centre[1]) * transform.scale[1]

    const back = unproject(transform, (ndcX + 1) / 2, (1 - ndcY) / 2)

    expect(back.x).toBeCloseTo(target.x, 6)
    expect(back.y).toBeCloseTo(target.y, 6)
  })
})
