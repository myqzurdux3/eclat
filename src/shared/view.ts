import { panelPolygon, type Point } from './geometry'
import type { PanelLayout } from './types'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ViewTransform {
  /** Facteurs vers le repère de clip, X puis Y. */
  scale: [number, number]
  /** Point du mur amené au centre du canvas. */
  centre: [number, number]
}

/** Marge laissée autour du mur, en fraction du demi-repère de clip. */
export const DEFAULT_MARGIN = 0.86

/**
 * Étendue réelle des panneaux, sommets compris.
 *
 * `normalizeLayout` ne normalise que les *centres* : un panneau déborde du
 * carré unité de tout son rayon circonscrit. Cadrer sur `[0,1]²` couperait
 * donc les bords du mur.
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
 * Cadre une boîte dans le repère de clip en préservant les proportions.
 *
 * Le repère de clip couvre le canvas entier sur les deux axes : un même
 * écart y vaut plus de pixels en X qu'en Y dès que le canvas n'est pas
 * carré. `scale.x` est donc divisé par le rapport du canvas, sans quoi les
 * triangles sortiraient étirés.
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
 * Inverse du cadrage : d'une position relative dans le canvas, dans `[0,1]²`
 * avec l'origine en haut à gauche, vers un point du mur.
 */
export function unproject(transform: ViewTransform, u: number, v: number): Point {
  const ndcX = u * 2 - 1
  const ndcY = 1 - v * 2

  return {
    x: ndcX / transform.scale[0] + transform.centre[0],
    y: -ndcY / transform.scale[1] + transform.centre[1],
  }
}
