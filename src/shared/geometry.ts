import type { NormalizedPanel, PanelLayout } from './types'

export interface Point {
  x: number
  y: number
}

/**
 * Shapes the device knows about, indexed by `shapeType`.
 *
 * `baseAngleDeg` is the angle of the first vertex at zero orientation,
 * measured in screen space (Y pointing down), so -90° points up. Shapes
 * triangles have a vertex on top, hexagons are flat-topped, and squares keep
 * their edges parallel to the axes.
 */
export const SHAPE_GEOMETRY: Record<number, { sides: number; baseAngleDeg: number }> = {
  0: { sides: 3, baseAngleDeg: -90 }, // Aurora triangle
  1: { sides: 3, baseAngleDeg: -90 }, // Rhythm
  2: { sides: 4, baseAngleDeg: -45 }, // Canvas square
  3: { sides: 4, baseAngleDeg: -45 }, // Canvas control square
  4: { sides: 4, baseAngleDeg: -45 }, // passive control square
  7: { sides: 6, baseAngleDeg: 0 }, // Shapes hexagon
  8: { sides: 3, baseAngleDeg: -90 }, // Shapes triangle
  9: { sides: 3, baseAngleDeg: -90 }, // Shapes mini triangle
  14: { sides: 6, baseAngleDeg: 0 }, // Elements hexagon
  15: { sides: 6, baseAngleDeg: 0 },
  16: { sides: 6, baseAngleDeg: 0 },
}

const FALLBACK = { sides: 4, baseAngleDeg: -45 }

/** Circumradius of a regular polygon. */
export function circumradius(sides: number, sideLength: number): number {
  return sideLength / (2 * Math.sin(Math.PI / sides))
}

/**
 * A panel's vertices in normalised space, ready for rendering.
 *
 * The device measures `o` counter-clockwise with Y pointing up; since
 * `normalizeLayout` flips that axis, the rotation becomes clockwise here,
 * hence the negative sign.
 */
export function panelPolygon(panel: NormalizedPanel, nSideLength: number): Point[] {
  const shape = SHAPE_GEOMETRY[panel.shapeType] ?? FALLBACK
  const radius = circumradius(shape.sides, nSideLength)
  const step = 360 / shape.sides

  return Array.from({ length: shape.sides }, (_, index) => {
    const angle = ((shape.baseAngleDeg - panel.o + index * step) * Math.PI) / 180
    return {
      x: panel.nx + radius * Math.cos(angle),
      y: panel.ny + radius * Math.sin(angle),
    }
  })
}

/** Ray-casting containment test, valid for any simple polygon. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!
    const b = polygon[j]!
    const crosses = a.y > point.y !== b.y > point.y
    if (!crosses) continue
    const cut = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (point.x < cut) inside = !inside
  }
  return inside
}

/**
 * The panel under a point, in normalised space. The last panel in the list
 * wins any overlap: it is the one drawn on top.
 */
export function panelAt(layout: PanelLayout, point: Point): NormalizedPanel | null {
  for (let index = layout.panels.length - 1; index >= 0; index -= 1) {
    const panel = layout.panels[index]!
    if (pointInPolygon(point, panelPolygon(panel, layout.nSideLength))) return panel
  }
  return null
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * The real extent of the panels, vertices included.
 *
 * `normalizeLayout` only normalises the *centres*: a panel sticks out of the
 * unit square by its full circumradius. Framing on `[0,1]²` would therefore
 * clip the edges of the wall.
 */
export function wallBounds(layout: PanelLayout): Bounds {
  if (layout.panels.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }

  const points: Point[] = layout.panels.flatMap((panel) =>
    panelPolygon(panel, layout.nSideLength),
  )
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/**
 * Rotates the wall by an arbitrary clockwise angle, on screen.
 *
 * The device does not report how the panels are mounted, and nothing says a
 * wall has to hang square: only the user knows. Rotating the layout rather
 * than the rendering keeps the mesh, the click hit-testing and the spatial
 * mapping in agreement, since all three start from the same `nx`, `ny`
 * and `o`.
 *
 * `o` is measured in the device's frame, whose Y axis is flipped for
 * rendering: a clockwise rotation on screen is therefore subtracted from `o`.
 */
export function rotateLayout(layout: PanelLayout, degrees: number): PanelLayout {
  const angle = ((degrees % 360) + 360) % 360
  if (angle === 0) return layout

  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  const panels = layout.panels.map((panel) => {
    const dx = panel.nx - 0.5
    const dy = panel.ny - 0.5
    return {
      ...panel,
      nx: 0.5 + dx * cos - dy * sin,
      ny: 0.5 + dx * sin + dy * cos,
      o: panel.o - angle,
    }
  })

  const rotated: PanelLayout = { ...layout, panels }
  const bounds = wallBounds(rotated)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  return {
    ...rotated,
    aspect: height === 0 ? layout.aspect : width / height,
  }
}
