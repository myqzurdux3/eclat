import { describe, expect, it } from 'vitest'
import { circumradius, panelAt, panelPolygon, pointInPolygon, rotateLayout } from './geometry'
import { normalizeLayout } from '../main/device/layout'
import type { NormalizedPanel } from './types'

const panel = (over: Partial<NormalizedPanel> = {}): NormalizedPanel => ({
  panelId: 1,
  x: 0,
  y: 0,
  o: 0,
  shapeType: 8,
  nx: 0.5,
  ny: 0.5,
  ...over,
})

const near = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6)

describe('circumradius', () => {
  it('equals the side over the square root of three for a triangle', () => {
    near(circumradius(3, 1), 1 / Math.sqrt(3))
  })

  it('equals the side for a hexagon', () => {
    near(circumradius(6, 1), 1)
  })
})

describe('panelPolygon', () => {
  it('returns three vertices for a Shapes triangle', () => {
    expect(panelPolygon(panel({ shapeType: 8 }), 0.2)).toHaveLength(3)
  })

  it('returns six vertices for a Shapes hexagon', () => {
    expect(panelPolygon(panel({ shapeType: 7 }), 0.2)).toHaveLength(6)
  })

  it('returns four vertices for a Canvas square', () => {
    expect(panelPolygon(panel({ shapeType: 2 }), 0.2)).toHaveLength(4)
  })

  it('falls back to a square for an unknown shape', () => {
    expect(panelPolygon(panel({ shapeType: 999 }), 0.2)).toHaveLength(4)
  })

  it('places every vertex at the circumradius', () => {
    const points = panelPolygon(panel(), 0.3)

    for (const point of points) {
      near(Math.hypot(point.x - 0.5, point.y - 0.5), circumradius(3, 0.3))
    }
  })

  it('points a vertex up at zero orientation', () => {
    const [first] = panelPolygon(panel({ o: 0 }), 0.3)

    near(first!.x, 0.5)
    expect(first!.y).toBeLessThan(0.5)
  })

  it('flips the triangle at 180 degrees', () => {
    const [first] = panelPolygon(panel({ o: 180 }), 0.3)

    near(first!.x, 0.5)
    expect(first!.y).toBeGreaterThan(0.5)
  })

  it('turns clockwise, the Y axis being flipped on screen', () => {
    const [first] = panelPolygon(panel({ o: 90 }), 0.3)

    near(first!.y, 0.5)
    expect(first!.x).toBeLessThan(0.5)
  })

  it('centres the polygon on the panel’s normalised position', () => {
    const points = panelPolygon(panel({ nx: 0.25, ny: 0.75 }), 0.3)
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length

    near(cx, 0.25)
    near(cy, 0.75)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]

  it('accepts an interior point', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true)
  })

  it('rejects an exterior point', () => {
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBe(false)
  })

  it('rejects a degenerate polygon', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false)
  })
})

describe('panelAt', () => {
  const layout = normalizeLayout(
    [
      { panelId: 11, x: 0, y: 0, o: 0, shapeType: 8 },
      { panelId: 22, x: 300, y: 0, o: 0, shapeType: 8 },
    ],
    100,
  )

  it('picks the panel under the point', () => {
    const target = layout.panels[1]!

    expect(panelAt(layout, { x: target.nx, y: target.ny })?.panelId).toBe(22)
  })

  it('picks nothing in empty space', () => {
    expect(panelAt(layout, { x: 0.5, y: 0.02 })).toBeNull()
  })
})

describe('rotateLayout', () => {
  const layout = normalizeLayout(
    [
      { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
      { panelId: 2, x: 0, y: 300, o: 0, shapeType: 8 },
    ],
    100,
  )

  it('changes nothing at a zero angle', () => {
    expect(rotateLayout(layout, 0)).toEqual(layout)
  })

  it('brings the top to the right for a quarter turn', () => {
    const top = layout.panels.reduce((a, b) => (a.ny < b.ny ? a : b))
    const right = rotateLayout(layout, 90).panels.reduce((a, b) => (a.nx > b.nx ? a : b))

    expect(right.panelId).toBe(top.panelId)
  })

  it('subtracts the angle from every panel’s orientation', () => {
    expect(rotateLayout(layout, 37).panels[0]!.o).toBe(layout.panels[0]!.o - 37)
  })

  it('accepts an angle that is not a multiple of 90', () => {
    const oblique = rotateLayout(layout, 37)

    for (const panel of oblique.panels) {
      expect(Number.isFinite(panel.nx)).toBe(true)
      expect(Number.isFinite(panel.ny)).toBe(true)
    }
    expect(oblique.panels[0]!.nx).not.toBeCloseTo(layout.panels[0]!.nx, 3)
  })

  it('preserves the distances between panels', () => {
    const gap = (l: typeof layout) =>
      Math.hypot(
        l.panels[0]!.nx - l.panels[1]!.nx,
        l.panels[0]!.ny - l.panels[1]!.ny,
      )

    expect(gap(rotateLayout(layout, 37))).toBeCloseTo(gap(layout), 6)
  })

  it('brings a full turn back to the start', () => {
    const back = rotateLayout(layout, 360)

    back.panels.forEach((panel, index) => {
      expect(panel.nx).toBeCloseTo(layout.panels[index]!.nx, 6)
      expect(panel.ny).toBeCloseTo(layout.panels[index]!.ny, 6)
    })
  })

  it('rotates the polygons too, not just the centres', () => {
    const before = panelPolygon(layout.panels[0]!, layout.nSideLength)
    const rotated = rotateLayout(layout, 90)
    const after = panelPolygon(rotated.panels[0]!, rotated.nSideLength)

    // A vertex pointing up ends up pointing right.
    expect(before[0]!.y).toBeLessThan(layout.panels[0]!.ny)
    expect(after[0]!.x).toBeGreaterThan(rotated.panels[0]!.nx)
  })

  it('accepts a negative angle', () => {
    expect(rotateLayout(layout, -90).panels[0]!.nx).toBeCloseTo(
      rotateLayout(layout, 270).panels[0]!.nx,
      6,
    )
  })

  it('recomputes the aspect ratio from the rotated geometry', () => {
    const rotated = rotateLayout(layout, 90)

    // A quarter turn inverts the ratio, except that the rotated value
    // measures the real extent of the vertices where `normalizeLayout`
    // approximates from the centres alone: the two do not coincide exactly.
    expect(rotated.aspect).toBeGreaterThan(1)
    expect(Math.abs(rotated.aspect * layout.aspect - 1)).toBeLessThan(0.1)
  })
})
