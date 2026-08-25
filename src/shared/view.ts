import { wallBounds, type Bounds, type Point } from './geometry'

export { wallBounds }
export type { Bounds }

export interface ViewTransform {
  /** Scale factors into clip space, X then Y. */
  scale: [number, number]
  /** The point of the wall brought to the centre of the canvas. */
  centre: [number, number]
}

/** Margin left around the wall, as a fraction of half of clip space. */
export const DEFAULT_MARGIN = 0.86

/**
 * Fits a box into clip space while preserving proportions.
 *
 * Clip space spans the whole canvas on both axes, so the same distance is
 * worth more pixels along X than along Y as soon as the canvas is not
 * square. `scale.x` is therefore divided by the canvas ratio; without that,
 * the triangles would come out stretched.
 */
export function fitTransform(
  bounds: Bounds,
  canvasAspect: number,
  margin = DEFAULT_MARGIN,
): ViewTransform {
  const width = Math.max(bounds.maxX - bounds.minX, Number.EPSILON)
  const height = Math.max(bounds.maxY - bounds.minY, Number.EPSILON)
  const aspect = canvasAspect > 0 && Number.isFinite(canvasAspect) ? canvasAspect : 1

  const scaleY = 2 * margin * Math.min(aspect / width, 1 / height)

  return {
    scale: [scaleY / aspect, scaleY],
    centre: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2],
  }
}

/**
 * The inverse of the fit: from a relative position inside the canvas, in
 * `[0,1]²` with the origin top-left, back to a point on the wall.
 */
export function unproject(transform: ViewTransform, u: number, v: number): Point {
  const ndcX = u * 2 - 1
  const ndcY = 1 - v * 2

  return {
    x: ndcX / transform.scale[0] + transform.centre[0],
    y: -ndcY / transform.scale[1] + transform.centre[1],
  }
}
