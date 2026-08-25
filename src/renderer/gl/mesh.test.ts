import { describe, expect, it } from 'vitest'
import { buildHaloMesh, buildPanelMesh } from './mesh'
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
  it('triangule chaque panneau en éventail', () => {
    const mesh = buildPanelMesh(triangles(2))

    // Deux triangles : (3 - 2) triangles par panneau, 3 sommets chacun.
    expect(mesh.vertexCount).toBe(2 * 3)
    expect(mesh.positions).toHaveLength(2 * 3 * 2)
  })

  it('produit six sommets par hexagone', () => {
    const layout = normalizeLayout(
      [
        { panelId: 1, x: 0, y: 0, o: 0, shapeType: 7 },
        { panelId: 2, x: 200, y: 0, o: 0, shapeType: 7 },
      ],
      100,
    )

    // (6 - 2) triangles, 3 sommets chacun.
    expect(buildPanelMesh(layout).vertexCount).toBe(2 * 12)
  })

  it('associe chaque sommet à l indice de son panneau', () => {
    const mesh = buildPanelMesh(triangles(2))

    expect([...mesh.panelIndices]).toEqual([0, 0, 0, 1, 1, 1])
  })

  it('rend un maillage vide sans panneau', () => {
    const mesh = buildPanelMesh(normalizeLayout([], 100))

    expect(mesh.vertexCount).toBe(0)
    expect(mesh.positions).toHaveLength(0)
  })

  it('garde les sommets dans le carré normalisé, marges comprises', () => {
    const mesh = buildPanelMesh(triangles(3))

    for (const value of mesh.positions) {
      expect(value).toBeGreaterThan(-1)
      expect(value).toBeLessThan(2)
    }
  })
})

describe('buildHaloMesh', () => {
  it('rend deux triangles par panneau', () => {
    const mesh = buildHaloMesh(triangles(2))

    expect(mesh.vertexCount).toBe(2 * 6)
  })

  it('porte un décalage unitaire par sommet pour la décroissance radiale', () => {
    const mesh = buildHaloMesh(triangles(1))

    expect(mesh.offsets).toHaveLength(6 * 2)
    for (const value of mesh.offsets) {
      expect(Math.abs(value)).toBeCloseTo(1, 6)
    }
  })

  it('déborde du panneau proportionnellement à l étalement', () => {
    const serre = buildHaloMesh(triangles(1), 1)
    const large = buildHaloMesh(triangles(1), 3)
    const etendue = (m: { positions: Float32Array }) =>
      Math.max(...m.positions) - Math.min(...m.positions)

    expect(etendue(large)).toBeGreaterThan(etendue(serre))
  })
})
