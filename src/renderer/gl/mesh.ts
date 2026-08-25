import { panelPolygon } from '../../shared/geometry'
import type { PanelLayout } from '../../shared/types'

/** Nombre maximal de panneaux adressables par le tableau d'uniformes. */
export const MAX_PANELS = 128

export interface WallMesh {
  /** Paires x,y en espace normalisé. */
  positions: Float32Array
  /** Indice du panneau, un par sommet. */
  panelIndices: Float32Array
  vertexCount: number
}

/**
 * Triangule chaque panneau en éventail depuis son premier sommet. Les formes
 * du device sont toutes convexes, l'éventail suffit donc et évite d'avoir à
 * indexer les sommets.
 */
export function buildPanelMesh(layout: PanelLayout): WallMesh {
  const positions: number[] = []
  const panelIndices: number[] = []

  layout.panels.forEach((panel, panelIndex) => {
    const points = panelPolygon(panel, layout.nSideLength)

    for (let corner = 1; corner < points.length - 1; corner += 1) {
      for (const point of [points[0]!, points[corner]!, points[corner + 1]!]) {
        positions.push(point.x, point.y)
        panelIndices.push(panelIndex)
      }
    }
  })

  return {
    positions: new Float32Array(positions),
    panelIndices: new Float32Array(panelIndices),
    vertexCount: panelIndices.length,
  }
}

/**
 * Un quad centré sur chaque panneau, plus large que lui, porteur du halo.
 * `offsets` donne à chaque sommet sa position dans le carré unité centré, ce
 * qui laisse le fragment shader calculer la décroissance radiale sans avoir
 * besoin du centre du panneau.
 */
export function buildHaloMesh(
  layout: PanelLayout,
  spread = 2.2,
): WallMesh & { offsets: Float32Array } {
  const positions: number[] = []
  const panelIndices: number[] = []
  const offsets: number[] = []

  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ]
  const reach = layout.nSideLength * spread

  layout.panels.forEach((panel, panelIndex) => {
    for (const [ox, oy] of corners) {
      positions.push(panel.nx + ox * reach, panel.ny + oy * reach)
      offsets.push(ox, oy)
      panelIndices.push(panelIndex)
    }
  })

  return {
    positions: new Float32Array(positions),
    panelIndices: new Float32Array(panelIndices),
    offsets: new Float32Array(offsets),
    vertexCount: panelIndices.length,
  }
}
