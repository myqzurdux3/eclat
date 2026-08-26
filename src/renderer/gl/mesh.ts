import { panelPolygon } from '../../shared/geometry'
import type { PanelLayout } from '../../shared/types'

/** The most panels the uniform array can address. */
export const MAX_PANELS = 128

/**
 * The panels a mesh may cover.
 *
 * The vertex shader reads `uColors[aPanelIndex]`, an array of `MAX_PANELS`.
 * Emitting vertices past that end asks the shader to read outside it, which
 * GLSL leaves undefined — the panels beyond come out in whatever colour the
 * driver felt like. Better to draw the wall we can colour.
 */
const drawable = (layout: PanelLayout): PanelLayout['panels'] =>
  layout.panels.slice(0, MAX_PANELS)

export interface WallMesh {
  /** x,y pairs in normalised space. */
  positions: Float32Array
  /** The panel index, one per vertex. */
  panelIndices: Float32Array
  vertexCount: number
}

/**
 * Triangulates each panel as a fan from its first vertex. Every shape the
 * device uses is convex, so a fan suffices and avoids having to index the
 * vertices.
 */
export function buildPanelMesh(layout: PanelLayout): WallMesh {
  const positions: number[] = []
  const panelIndices: number[] = []

  drawable(layout).forEach((panel, panelIndex) => {
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
 * One quad centred on each panel, wider than it, carrying the halo.
 * `offsets` gives each vertex its position within the centred unit square,
 * which lets the fragment shader compute the radial falloff without needing
 * the panel's centre.
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

  drawable(layout).forEach((panel, panelIndex) => {
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

/**
 * The edges of every panel, as line segments.
 *
 * A wall whose panels are all unlit is a wall drawn in near-black over a
 * near-black stage: nothing on screen says where to click. The fill carries
 * the state, the outline says where the panels are, whatever the state.
 */
export function buildOutlineMesh(layout: PanelLayout): WallMesh {
  const positions: number[] = []
  const panelIndices: number[] = []

  drawable(layout).forEach((panel, panelIndex) => {
    const points = panelPolygon(panel, layout.nSideLength)

    for (let corner = 0; corner < points.length; corner += 1) {
      const from = points[corner]!
      const to = points[(corner + 1) % points.length]!
      positions.push(from.x, from.y, to.x, to.y)
      panelIndices.push(panelIndex, panelIndex)
    }
  })

  return {
    positions: new Float32Array(positions),
    panelIndices: new Float32Array(panelIndices),
    vertexCount: panelIndices.length,
  }
}
