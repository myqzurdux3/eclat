import { describe, expect, it } from 'vitest'
import { buildHaloMesh, buildOutlineMesh, buildPanelMesh } from './mesh'
import { normalizeLayout } from '../../main/device/layout'
import type { PanelLayout } from '../../shared/types'

const triangles = (count: number): PanelLayout =>
  normalizeLayout(
    Array.from({ length: count }, (_, index) => ({
      panelId: index + 1,
      x: index * 100,
      y: 0,
      o: 0,
      shapeType: 8,
    })),
    100,
  )

describe('buildPanelMesh', () => {
  it('triangulates each panel as a fan', () => {
    const mesh = buildPanelMesh(triangles(2))

    // Two triangles: (3 - 2) triangles per panel, three vertices each.
    expect(mesh.vertexCount).toBe(2 * 3)
    expect(mesh.positions).toHaveLength(2 * 3 * 2)
  })

  it('produces six vertices per hexagon', () => {
    const layout = normalizeLayout(
      [
        { panelId: 1, x: 0, y: 0, o: 0, shapeType: 7 },
        { panelId: 2, x: 200, y: 0, o: 0, shapeType: 7 },
      ],
      100,
    )

    // (6 - 2) triangles, three vertices each.
    expect(buildPanelMesh(layout).vertexCount).toBe(2 * 12)
  })

  it('tags every vertex with its panel index', () => {
    const mesh = buildPanelMesh(triangles(2))

    expect([...mesh.panelIndices]).toEqual([0, 0, 0, 1, 1, 1])
  })

  it('returns an empty mesh with no panels', () => {
    const mesh = buildPanelMesh(normalizeLayout([], 100))

    expect(mesh.vertexCount).toBe(0)
    expect(mesh.positions).toHaveLength(0)
  })

  it('keeps vertices inside the normalised square, margins included', () => {
    const mesh = buildPanelMesh(triangles(3))

    for (const value of mesh.positions) {
      expect(value).toBeGreaterThan(-1)
      expect(value).toBeLessThan(2)
    }
  })
})

describe('buildHaloMesh', () => {
  it('returns two triangles per panel', () => {
    const mesh = buildHaloMesh(triangles(2))

    expect(mesh.vertexCount).toBe(2 * 6)
  })

  it('carries a unit offset per vertex for the radial falloff', () => {
    const mesh = buildHaloMesh(triangles(1))

    expect(mesh.offsets).toHaveLength(6 * 2)
    for (const value of mesh.offsets) {
      expect(Math.abs(value)).toBeCloseTo(1, 6)
    }
  })

  it('overflows the panel in proportion to the spread', () => {
    const tight = buildHaloMesh(triangles(1), 1)
    const wide = buildHaloMesh(triangles(1), 3)
    const extent = (m: { positions: Float32Array }) =>
      Math.max(...m.positions) - Math.min(...m.positions)

    expect(extent(wide)).toBeGreaterThan(extent(tight))
  })
})

describe('buildOutlineMesh', () => {
  /**
   * A wall of unlit panels is near-black on a near-black stage. The outline
   * is the only thing that says where to click, so it has to close around
   * every panel: three sides, six vertices, for a triangle.
   */
  it('closes a segment loop around each panel', () => {
    const mesh = buildOutlineMesh(triangles(2))

    expect(mesh.vertexCount).toBe(2 * 3 * 2)
  })

  it('gives every vertex its own panel', () => {
    const mesh = buildOutlineMesh(triangles(2))

    expect([...mesh.panelIndices]).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1])
  })

  it('joins the last corner back to the first', () => {
    const mesh = buildOutlineMesh(triangles(1))
    const at = (index: number) => [mesh.positions[index * 2], mesh.positions[index * 2 + 1]]

    // The final segment ends where the first one started.
    expect(at(mesh.vertexCount - 1)).toEqual(at(0))
  })
})
